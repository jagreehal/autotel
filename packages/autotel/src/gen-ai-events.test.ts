import { describe, expect, it } from 'vitest';
import type { TraceContext } from './trace-context';
import {
  recordPromptSent,
  recordResponseReceived,
  recordRetry,
  recordStreamFirstToken,
  recordToolCall,
} from './gen-ai-events';

type CapturedEvent = { name: string; attrs?: Record<string, unknown> };

function captureCtx(): {
  ctx: TraceContext;
  events: CapturedEvent[];
} {
  const events: CapturedEvent[] = [];
  const ctx = {
    addEvent: (name: string, attrs?: Record<string, unknown>) => {
      events.push({ name, attrs });
    },
    setAttribute: () => {},
    setAttributes: () => {},
    setStatus: () => {},
    recordException: () => {},
    addLink: () => {},
    addLinks: () => {},
    updateName: () => {},
    isRecording: () => true,
    end: () => {},
  } as unknown as TraceContext;
  return { ctx, events };
}

describe('GenAI span event helpers', () => {
  it('recordPromptSent emits gen_ai.prompt.sent with canonical attrs', () => {
    const { ctx, events } = captureCtx();
    recordPromptSent(ctx, {
      model: 'gpt-4o',
      promptTokens: 1200,
      messageCount: 3,
      operation: 'chat',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      name: 'gen_ai.prompt.sent',
      attrs: {
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.usage.input_tokens': 1200,
        'gen_ai.request.message_count': 3,
        'gen_ai.operation.name': 'chat',
      },
    });
  });

  it('recordPromptSent omits unset fields rather than writing undefined', () => {
    const { ctx, events } = captureCtx();
    recordPromptSent(ctx);
    expect(events[0]?.attrs).toEqual({});
  });

  it('recordResponseReceived joins finish reasons into a CSV for attribute compat', () => {
    const { ctx, events } = captureCtx();
    recordResponseReceived(ctx, {
      model: 'gpt-4o-2024-11-20',
      promptTokens: 1200,
      completionTokens: 400,
      totalTokens: 1600,
      finishReasons: ['stop', 'tool_calls'],
    });
    expect(events[0]).toEqual({
      name: 'gen_ai.response.received',
      attrs: {
        'gen_ai.response.model': 'gpt-4o-2024-11-20',
        'gen_ai.usage.input_tokens': 1200,
        'gen_ai.usage.output_tokens': 400,
        'gen_ai.usage.total_tokens': 1600,
        'gen_ai.response.finish_reasons': 'stop,tool_calls',
      },
    });
  });

  it('recordResponseReceived omits finish_reasons when empty', () => {
    const { ctx, events } = captureCtx();
    recordResponseReceived(ctx, { model: 'claude-sonnet-4-6' });
    expect(events[0]?.attrs).not.toHaveProperty(
      'gen_ai.response.finish_reasons',
    );
  });

  it('recordRetry captures attempt, reason, delay, and status code', () => {
    const { ctx, events } = captureCtx();
    recordRetry(ctx, {
      attempt: 2,
      reason: 'rate_limit',
      delayMs: 1000,
      statusCode: 429,
    });
    expect(events[0]).toEqual({
      name: 'gen_ai.retry',
      attrs: {
        'retry.attempt': 2,
        'retry.reason': 'rate_limit',
        'retry.delay_ms': 1000,
        'http.response.status_code': 429,
      },
    });
  });

  it('recordToolCall writes canonical gen_ai.tool.* keys', () => {
    const { ctx, events } = captureCtx();
    recordToolCall(ctx, {
      toolName: 'search_traces',
      toolCallId: 'call-123',
      arguments: '{"serviceName":"api"}',
    });
    expect(events[0]).toEqual({
      name: 'gen_ai.tool.call',
      attrs: {
        'gen_ai.tool.name': 'search_traces',
        'gen_ai.tool.call.id': 'call-123',
        'gen_ai.tool.arguments': '{"serviceName":"api"}',
      },
    });
  });

  it('recordStreamFirstToken is the bare marker for TTFT', () => {
    const { ctx, events } = captureCtx();
    recordStreamFirstToken(ctx, { tokensSoFar: 1 });
    expect(events[0]).toEqual({
      name: 'gen_ai.stream.first_token',
      attrs: { 'gen_ai.stream.tokens_so_far': 1 },
    });
  });
});
