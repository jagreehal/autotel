import { tracingChannel } from 'node:diagnostics_channel';
import { type Tracer } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GEN_AI } from '../semconv.js';
import { subscribeAiTelemetry } from './ai-sdk-channel.js';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
let tracer: Tracer;
let unsubscribe: () => void;

const channel = tracingChannel<string, Record<string, unknown>>('ai:telemetry');

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  tracer = provider.getTracer('ai-sdk-channel-test');
});

afterEach(async () => {
  unsubscribe?.();
  await provider.shutdown();
});

const spans = () => exporter.getFinishedSpans();
const one = (name: string): ReadableSpan => {
  const matches = spans().filter((s) => s.name === name);
  if (matches.length !== 1) {
    throw new Error(`expected one span "${name}", got ${matches.length}`);
  }
  return matches[0]!;
};
const parentIdOf = (s: ReadableSpan) => s.parentSpanContext?.spanId;

/** Publish a start, mutate the same object with a result, publish asyncEnd. */
function trace(message: Record<string, unknown>, result?: unknown): void {
  channel.start.publish(message);
  if (result !== undefined) message.result = result;
  channel.asyncEnd.publish(message);
}

describe('subscribeAiTelemetry', () => {
  it('builds invoke_agent → chat with usage and cost from channel messages', () => {
    unsubscribe = subscribeAiTelemetry({ tracer });

    const gen: Record<string, unknown> = {
      type: 'generateText',
      event: { callId: 'c1', modelId: 'gpt-4o', provider: 'openai' },
    };
    channel.start.publish(gen);

    trace(
      {
        type: 'languageModelCall',
        event: { callId: 'c1', modelId: 'gpt-4o', provider: 'openai' },
      },
      {
        finishReason: 'stop',
        response: { id: 'r1', modelId: 'gpt-4o' },
        usage: { inputTokens: 1000, outputTokens: 500 },
      },
    );

    gen.result = { ok: true };
    channel.asyncEnd.publish(gen);

    const agent = one('invoke_agent gpt-4o');
    const chat = one('chat gpt-4o');
    expect(parentIdOf(chat)).toBe(agent.spanContext().spanId);
    expect(chat.attributes[GEN_AI.USAGE_INPUT_TOKENS]).toBe(1000);
    expect(chat.attributes[GEN_AI.USAGE_OUTPUT_TOKENS]).toBe(500);
    expect(chat.attributes[GEN_AI.USAGE_COST_USD]).toBeGreaterThan(0);
    expect(chat.attributes[GEN_AI.RESPONSE_ID]).toBe('r1');
  });

  it('builds a tool span nested under the agent root', () => {
    unsubscribe = subscribeAiTelemetry({ tracer });
    const gen: Record<string, unknown> = {
      type: 'streamText',
      event: { callId: 'c2', modelId: 'gpt-4o' },
    };
    channel.start.publish(gen);
    trace(
      {
        type: 'executeTool',
        event: { callId: 'c2', toolCall: { toolCallId: 't1', toolName: 'search' } },
      },
      { output: { hits: 3 } },
    );
    channel.asyncEnd.publish(gen);

    const agent = one('invoke_agent gpt-4o');
    const tool = one('execute_tool search');
    expect(parentIdOf(tool)).toBe(agent.spanContext().spanId);
    expect(tool.attributes[GEN_AI.TOOL_CALL_ID]).toBe('t1');
  });

  it('builds a standalone embeddings span with token usage', () => {
    unsubscribe = subscribeAiTelemetry({ tracer });
    trace(
      {
        type: 'embed',
        event: { callId: 'e1', modelId: 'text-embedding-3-small', provider: 'openai' },
      },
      { usage: { tokens: 42 } },
    );
    const embed = one('embeddings text-embedding-3-small');
    expect(embed.attributes[GEN_AI.OPERATION_NAME]).toBe('embeddings');
    expect(embed.attributes[GEN_AI.USAGE_INPUT_TOKENS]).toBe(42);
  });

  it('captures content when enabled', () => {
    unsubscribe = subscribeAiTelemetry({ tracer, captureContent: true });
    trace(
      {
        type: 'languageModelCall',
        event: {
          callId: 'c3',
          modelId: 'gpt-4o',
          messages: [{ role: 'user', content: 'hi' }],
        },
      },
      { finishReason: 'stop', content: [{ type: 'text', text: 'hello' }] },
    );
    const chat = one('chat gpt-4o');
    const input = JSON.parse(String(chat.attributes[GEN_AI.INPUT_MESSAGES]));
    expect(input).toEqual([{ role: 'user', parts: [{ type: 'text', content: 'hi' }] }]);
    const output = JSON.parse(String(chat.attributes[GEN_AI.OUTPUT_MESSAGES]));
    expect(output[0].parts).toEqual([{ type: 'text', content: 'hello' }]);
  });

  it('does not capture tool output when recordOutputs is false', () => {
    unsubscribe = subscribeAiTelemetry({ tracer, captureContent: true });
    const gen: Record<string, unknown> = {
      type: 'streamText',
      event: { callId: 'c4', modelId: 'gpt-4o' },
    };
    channel.start.publish(gen);
    trace(
      {
        type: 'executeTool',
        event: {
          callId: 'c4',
          toolCall: { toolCallId: 't2', toolName: 'search' },
          recordOutputs: false,
        },
      },
      { output: { secret: true } },
    );
    channel.asyncEnd.publish(gen);

    const tool = one('execute_tool search');
    expect(tool.attributes[GEN_AI.TOOL_CALL_RESULT]).toBeUndefined();
  });

  it('returns a callable unsubscribe', () => {
    const off = subscribeAiTelemetry({ tracer });
    expect(typeof off).toBe('function');
    off();
  });
});
