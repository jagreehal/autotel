import { AsyncLocalStorage } from 'node:async_hooks';
import {
  context as otelContext,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  type Context,
  type ContextManager,
  type Tracer,
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GEN_AI } from '../semconv.js';
import { autotelTelemetry } from './ai-sdk-telemetry.js';

// The context runners rely on the ambient OpenTelemetry ContextManager — the
// same one a real Node app gets from NodeTracerProvider/sdk-node. BasicTracer
// registers none, so register a minimal AsyncLocalStorage-backed manager (set
// once globally) to exercise context propagation in tests.
class AlsContextManager implements ContextManager {
  private readonly als = new AsyncLocalStorage<Context>();
  active(): Context {
    return this.als.getStore() ?? ROOT_CONTEXT;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.als.run(context, () =>
      fn.apply(thisArg as ThisParameterType<F>, args),
    );
  }
  bind<T>(_context: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    return this;
  }
}
otelContext.setGlobalContextManager(new AlsContextManager());

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
let tracer: Tracer;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  tracer = provider.getTracer('ai-sdk-telemetry-test');
});

afterEach(async () => {
  await provider.shutdown();
});

const spans = () => exporter.getFinishedSpans();
const byName = (name: string): ReadableSpan[] =>
  spans().filter((s) => s.name === name);
const one = (name: string): ReadableSpan => {
  const matches = byName(name);
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one span named "${name}", got ${matches.length}`,
    );
  }
  return matches[0]!;
};
const parentIdOf = (span: ReadableSpan) => span.parentSpanContext?.spanId;

describe('autotelTelemetry — single text generation', () => {
  it('emits invoke_agent → chat with usage, cost, and streaming timing', () => {
    const t = autotelTelemetry({ tracer });

    t.onStart({
      callId: 'c1',
      operationId: 'ai.generateText',
      provider: 'openai',
      modelId: 'gpt-4o',
      functionId: 'story-agent',
    });
    t.onLanguageModelCallStart({
      callId: 'c1',
      provider: 'openai',
      modelId: 'gpt-4o',
      temperature: 0.7,
      maxOutputTokens: 256,
    });
    t.onLanguageModelCallEnd({
      callId: 'c1',
      modelId: 'gpt-4o',
      responseId: 'resp_1',
      finishReason: 'stop',
      usage: { inputTokens: 1000, outputTokens: 500 },
      performance: {
        responseTimeMs: 2000,
        effectiveOutputTokensPerSecond: 250,
        timeToFirstOutputMs: 400,
      },
    });
    t.onEnd({ callId: 'c1' });

    const agent = one('invoke_agent story-agent');
    expect(agent.kind).toBe(SpanKind.INTERNAL);
    expect(agent.attributes[GEN_AI.OPERATION_NAME]).toBe('invoke_agent');
    expect(agent.attributes[GEN_AI.PROVIDER_NAME]).toBe('openai');

    const chat = one('chat gpt-4o');
    expect(chat.kind).toBe(SpanKind.CLIENT);
    expect(parentIdOf(chat)).toBe(agent.spanContext().spanId);
    expect(chat.attributes[GEN_AI.REQUEST_TEMPERATURE]).toBe(0.7);
    expect(chat.attributes[GEN_AI.REQUEST_MAX_TOKENS]).toBe(256);
    expect(chat.attributes[GEN_AI.REQUEST_STREAM]).toBe(false);
    expect(chat.attributes[GEN_AI.USAGE_INPUT_TOKENS]).toBe(1000);
    expect(chat.attributes[GEN_AI.USAGE_OUTPUT_TOKENS]).toBe(500);
    expect(chat.attributes[GEN_AI.RESPONSE_ID]).toBe('resp_1');
    expect(chat.attributes[GEN_AI.RESPONSE_FINISH_REASONS]).toEqual(['stop']);

    // Cost is priced from MODEL_PRICING — a differentiator over @ai-sdk/otel.
    expect(chat.attributes[GEN_AI.USAGE_COST_USD]).toBeGreaterThan(0);

    // Streaming timing (autotel extensions + spec time_to_first_chunk).
    expect(chat.attributes[GEN_AI.RESPONSE_TIME_TO_FIRST_CHUNK]).toBeCloseTo(
      0.4,
    );
    expect(chat.attributes[GEN_AI.RESPONSE_TIME_TO_FINISH]).toBeCloseTo(2);
    expect(chat.attributes[GEN_AI.RESPONSE_OUTPUT_TOKENS_PER_SECOND]).toBe(250);
  });
});

describe('autotelTelemetry — tool loop', () => {
  it('nests tool spans and a second chat under the same invoke_agent root', () => {
    const t = autotelTelemetry({ tracer });

    t.onStart({
      callId: 'c2',
      operationId: 'ai.generateText',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
    // Step 1: model asks for a tool call.
    t.onLanguageModelCallStart({ callId: 'c2', modelId: 'claude-sonnet-4-5' });
    t.onLanguageModelCallEnd({
      callId: 'c2',
      modelId: 'claude-sonnet-4-5',
      finishReason: 'tool-calls',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    t.onToolExecutionStart({
      callId: 'c2',
      toolCall: {
        toolCallId: 'tc1',
        toolName: 'getWeather',
        input: { city: 'SF' },
      },
      recordInputs: true,
    });
    t.onToolExecutionEnd({
      callId: 'c2',
      toolCall: { toolCallId: 'tc1', toolName: 'getWeather' },
      toolOutput: { type: 'tool-result', output: { tempC: 18 } },
      recordOutputs: true,
    });
    // Step 2: model produces the final answer.
    t.onLanguageModelCallStart({ callId: 'c2', modelId: 'claude-sonnet-4-5' });
    t.onLanguageModelCallEnd({
      callId: 'c2',
      modelId: 'claude-sonnet-4-5',
      finishReason: 'stop',
      usage: { inputTokens: 130, outputTokens: 40 },
    });
    t.onEnd({ callId: 'c2' });

    const agent = one('invoke_agent claude-sonnet-4-5');
    const chats = byName('chat claude-sonnet-4-5');
    const tool = one('execute_tool getWeather');

    expect(chats).toHaveLength(2);
    for (const chat of chats) {
      expect(parentIdOf(chat)).toBe(agent.spanContext().spanId);
    }
    expect(parentIdOf(tool)).toBe(agent.spanContext().spanId);
    expect(tool.attributes[GEN_AI.TOOL_NAME]).toBe('getWeather');
    expect(tool.attributes[GEN_AI.TOOL_CALL_ID]).toBe('tc1');
    expect(tool.attributes[GEN_AI.TOOL_TYPE]).toBe('function');
  });

  it('marks a tool span errored when the tool execution fails', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'c3',
      operationId: 'ai.generateText',
      modelId: 'gpt-4o',
    });
    t.onToolExecutionStart({
      callId: 'c3',
      toolCall: { toolCallId: 'tc9', toolName: 'flaky' },
    });
    t.onToolExecutionEnd({
      callId: 'c3',
      toolCall: { toolCallId: 'tc9', toolName: 'flaky' },
      toolOutput: { type: 'tool-error', error: new Error('boom') },
    });
    t.onEnd({ callId: 'c3' });

    const tool = one('execute_tool flaky');
    expect(tool.status.code).toBe(SpanStatusCode.ERROR);
    expect(tool.status.message).toBe('boom');
  });

  it('assigns distinct spans to anonymous tool executions', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'c2a',
      operationId: 'ai.generateText',
      modelId: 'gpt-4o',
    });

    t.onToolExecutionStart({
      callId: 'c2a',
      toolCall: { toolName: 'first' },
    });
    t.onToolExecutionStart({
      callId: 'c2a',
      toolCall: { toolName: 'second' },
    });
    t.onToolExecutionEnd({
      callId: 'c2a',
      toolCall: { toolName: 'first' },
      toolOutput: { type: 'tool-result', output: { ok: 1 } },
    });
    t.onToolExecutionEnd({
      callId: 'c2a',
      toolCall: { toolName: 'second' },
      toolOutput: { type: 'tool-result', output: { ok: 2 } },
    });
    t.onEnd({ callId: 'c2a' });

    expect(byName('execute_tool first')).toHaveLength(1);
    expect(byName('execute_tool second')).toHaveLength(1);
  });
});

describe('autotelTelemetry — concurrency', () => {
  it('keeps interleaved concurrent generations on separate trees', () => {
    const t = autotelTelemetry({ tracer });

    t.onStart({
      callId: 'A',
      operationId: 'ai.streamText',
      modelId: 'gpt-4o',
      functionId: 'a',
    });
    t.onStart({
      callId: 'B',
      operationId: 'ai.streamText',
      modelId: 'gpt-4o',
      functionId: 'b',
    });
    t.onLanguageModelCallStart({ callId: 'B', modelId: 'gpt-4o' });
    t.onLanguageModelCallStart({ callId: 'A', modelId: 'gpt-4o' });
    t.onLanguageModelCallEnd({
      callId: 'A',
      modelId: 'gpt-4o',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    t.onLanguageModelCallEnd({
      callId: 'B',
      modelId: 'gpt-4o',
      usage: { inputTokens: 20, outputTokens: 7 },
    });
    t.onEnd({ callId: 'A' });
    t.onEnd({ callId: 'B' });

    const agentA = one('invoke_agent a');
    const agentB = one('invoke_agent b');
    const chats = byName('chat gpt-4o');
    expect(chats).toHaveLength(2);

    const parents = new Set(chats.map((s) => parentIdOf(s)));
    expect(parents).toEqual(
      new Set([agentA.spanContext().spanId, agentB.spanContext().spanId]),
    );
  });

  it('marks streamText language-model calls as streaming', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({ callId: 'S', operationId: 'ai.streamText', modelId: 'gpt-4o' });
    t.onLanguageModelCallStart({ callId: 'S', modelId: 'gpt-4o' });
    t.onLanguageModelCallEnd({ callId: 'S', modelId: 'gpt-4o' });
    t.onEnd({ callId: 'S' });

    const chat = one('chat gpt-4o');
    expect(chat.attributes[GEN_AI.REQUEST_STREAM]).toBe(true);
  });
});

describe('autotelTelemetry — abort & embeddings', () => {
  it('force-closes an aborted run and marks the root errored', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'c4',
      operationId: 'ai.streamText',
      modelId: 'gpt-4o',
    });
    t.onLanguageModelCallStart({ callId: 'c4', modelId: 'gpt-4o' });
    // No matching end — the stream is aborted mid-flight.
    t.onAbort({ callId: 'c4', reason: 'user cancelled' });

    const agent = one('invoke_agent gpt-4o');
    expect(agent.status.code).toBe(SpanStatusCode.ERROR);
    // The open chat child is reaped, not leaked.
    expect(byName('chat gpt-4o')).toHaveLength(1);
  });

  it('records embeddings duration from onEmbedStart through onEmbedEnd', async () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'e2',
      operationId: 'ai.embed',
      modelId: 'text-embedding-3-small',
    });
    t.onEmbedStart({
      callId: 'e2',
      embedCallId: 'ec1',
      provider: 'openai',
      modelId: 'text-embedding-3-small',
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    t.onEmbedEnd({
      callId: 'e2',
      embedCallId: 'ec1',
      provider: 'openai',
      modelId: 'text-embedding-3-small',
      usage: { tokens: 42 },
    });
    t.onEnd({ callId: 'e2' });

    const embed = one('embeddings text-embedding-3-small');
    expect(embed.attributes[GEN_AI.OPERATION_NAME]).toBe('embeddings');
    const [startS, startNs] = embed.startTime;
    const [endS, endNs] = embed.endTime;
    const durationMs = (endS - startS) * 1000 + (endNs - startNs) / 1e6;
    expect(durationMs).toBeGreaterThan(40);
  });

  it('emits a standalone embeddings span with token usage and cost', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'e1',
      operationId: 'ai.embed',
      modelId: 'text-embedding-3-small',
    });
    t.onEmbedEnd({
      callId: 'e1',
      embedCallId: 'ec1',
      provider: 'openai',
      modelId: 'text-embedding-3-small',
      usage: { tokens: 42 },
    });
    t.onEnd({ callId: 'e1' });

    // No invoke_agent root for embeddings.
    expect(byName('invoke_agent text-embedding-3-small')).toHaveLength(0);
    const embed = one('embeddings text-embedding-3-small');
    expect(embed.attributes[GEN_AI.OPERATION_NAME]).toBe('embeddings');
    expect(embed.attributes[GEN_AI.USAGE_INPUT_TOKENS]).toBe(42);
    expect(parentIdOf(embed)).toBeUndefined();
  });

  it('marks an in-flight embeddings span errored when the call throws', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'e3',
      operationId: 'ai.embed',
      modelId: 'text-embedding-3-small',
    });
    t.onEmbedStart({
      callId: 'e3',
      embedCallId: 'ec1',
      provider: 'openai',
      modelId: 'text-embedding-3-small',
    });
    t.onError({ callId: 'e3', error: new Error('boom') });

    const embed = one('embeddings text-embedding-3-small');
    expect(embed.status.code).toBe(SpanStatusCode.ERROR);
    expect(embed.status.message).toBe('boom');
  });
});

describe('autotelTelemetry — structured output', () => {
  it('nests a json chat span under invoke_agent for generateObject', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'o1',
      operationId: 'ai.generateObject',
      provider: 'openai',
      modelId: 'gpt-4o',
      functionId: 'extract-incident',
    });
    t.onObjectStepStart({
      callId: 'o1',
      provider: 'openai',
      modelId: 'gpt-4o',
    });
    t.onObjectStepEnd({
      callId: 'o1',
      finishReason: 'stop',
      response: { id: 'resp_obj', modelId: 'gpt-4o' },
      usage: { inputTokens: 1000, outputTokens: 500 },
      objectText: '{"ok":true}',
      msToFirstChunk: 400,
    });
    t.onEnd({ callId: 'o1' });

    const agent = one('invoke_agent extract-incident');
    expect(agent.attributes[GEN_AI.OPERATION_NAME]).toBe('invoke_agent');

    const chat = one('chat gpt-4o');
    expect(parentIdOf(chat)).toBe(agent.spanContext().spanId);
    expect(chat.attributes[GEN_AI.OUTPUT_TYPE]).toBe('json');
    expect(chat.attributes[GEN_AI.USAGE_INPUT_TOKENS]).toBe(1000);
    expect(chat.attributes[GEN_AI.USAGE_OUTPUT_TOKENS]).toBe(500);
    expect(chat.attributes[GEN_AI.USAGE_COST_USD]).toBeGreaterThan(0);
    expect(chat.attributes[GEN_AI.RESPONSE_TIME_TO_FIRST_CHUNK]).toBeCloseTo(
      0.4,
    );
    expect(chat.attributes[GEN_AI.RESPONSE_ID]).toBe('resp_obj');
    expect(Object.keys(chat.attributes)).not.toContain(
      'gen_ai.usage.total_tokens',
    );
  });

  it('reaps an in-flight json chat span when generateObject throws', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'o2',
      operationId: 'ai.generateObject',
      modelId: 'gpt-4o',
      functionId: 'extract-incident',
    });
    t.onObjectStepStart({
      callId: 'o2',
      provider: 'openai',
      modelId: 'gpt-4o',
    });
    t.onError({ callId: 'o2', error: new Error('schema mismatch') });

    const agent = one('invoke_agent extract-incident');
    expect(agent.status.code).toBe(SpanStatusCode.ERROR);
    const chat = one('chat gpt-4o');
    expect(parentIdOf(chat)).toBe(agent.spanContext().spanId);
    expect(chat.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('autotelTelemetry — runtimeContext', () => {
  it('stamps user.id and conversation id from runtimeContext and drops leftover keys', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'c8',
      operationId: 'ai.generateText',
      provider: 'openai',
      modelId: 'gpt-4o',
      functionId: 'support-agent',
      runtimeContext: {
        userId: 'u_123',
        sessionId: 's_456',
        tenant: 'acme',
      },
    });
    t.onLanguageModelCallStart({ callId: 'c8', modelId: 'gpt-4o' });
    t.onLanguageModelCallEnd({
      callId: 'c8',
      modelId: 'gpt-4o',
      usage: { inputTokens: 10, outputTokens: 4 },
    });
    t.onEnd({ callId: 'c8' });

    const agent = one('invoke_agent support-agent');
    expect(agent.attributes['user.id']).toBe('u_123');
    expect(agent.attributes[GEN_AI.CONVERSATION_ID]).toBe('s_456');
    expect(agent.attributes.tenant).toBeUndefined();

    const chat = one('chat gpt-4o');
    expect(chat.attributes['user.id']).toBe('u_123');
    expect(chat.attributes[GEN_AI.CONVERSATION_ID]).toBe('s_456');
    expect(chat.attributes.tenant).toBeUndefined();
  });

  // The SDK withholds runtimeContext from telemetry unless the call names each
  // key in `telemetry.includeRuntimeContext`. When it does, `onStart` simply
  // arrives without the field — and no conversation id can be stamped. Pinned
  // so the mapping is never mistaken for something that works unconditionally.
  it('records no conversation id when the SDK withheld runtimeContext', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'c8b',
      operationId: 'ai.generateText',
      provider: 'openai',
      modelId: 'gpt-4o',
      functionId: 'support-agent',
    });
    t.onLanguageModelCallStart({ callId: 'c8b', modelId: 'gpt-4o' });
    t.onLanguageModelCallEnd({ callId: 'c8b', modelId: 'gpt-4o' });
    t.onEnd({ callId: 'c8b' });

    const agent = one('invoke_agent support-agent');
    expect(agent.attributes[GEN_AI.CONVERSATION_ID]).toBeUndefined();
    expect(agent.attributes['user.id']).toBeUndefined();
  });

  // Every optional field explicitly `undefined` — the shape an SDK event has
  // under `exactOptionalPropertyTypes`. Must type-check and must not stamp
  // empty attributes.
  it('tolerates optional fields explicitly set to undefined', () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'c8c',
      operationId: 'ai.generateText',
      provider: 'openai',
      modelId: 'gpt-4o',
      functionId: 'undef-agent',
      runtimeContext: undefined,
    });
    t.onLanguageModelCallStart({
      callId: 'c8c',
      modelId: 'gpt-4o',
      temperature: undefined,
      messages: undefined,
      recordInputs: undefined,
    });
    t.onLanguageModelCallEnd({
      callId: 'c8c',
      modelId: 'gpt-4o',
      responseId: undefined,
      finishReason: undefined,
      usage: { inputTokens: 3, outputTokens: undefined },
      performance: undefined,
    });
    t.onEnd({ callId: 'c8c' });

    const chat = one('chat gpt-4o');
    expect(chat.attributes[GEN_AI.USAGE_INPUT_TOKENS]).toBe(3);
    expect(chat.attributes[GEN_AI.USAGE_OUTPUT_TOKENS]).toBeUndefined();
    expect(chat.attributes[GEN_AI.RESPONSE_FINISH_REASONS]).toBeUndefined();
  });
});

describe('autotelTelemetry — context runners', () => {
  it('nests a span created inside executeTool under the tool span', async () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'c5',
      operationId: 'ai.generateText',
      modelId: 'gpt-4o',
    });
    t.onToolExecutionStart({
      callId: 'c5',
      toolCall: { toolCallId: 'tc1', toolName: 'search' },
    });

    // A nested generateText (here: a raw child span) created inside the tool's
    // execute must become a child of the execute_tool span.
    let childParent: string | undefined;
    await t.executeTool({
      callId: 'c5',
      toolCallId: 'tc1',
      execute: async () => {
        const child = tracer.startSpan('nested.generateText');
        childParent = child.spanContext().spanId;
        child.end();
        return 'ok';
      },
    });

    t.onToolExecutionEnd({
      callId: 'c5',
      toolCall: { toolCallId: 'tc1', toolName: 'search' },
      toolOutput: { type: 'tool-result', output: {} },
    });
    t.onEnd({ callId: 'c5' });

    const tool = one('execute_tool search');
    const nested = one('nested.generateText');
    expect(parentIdOf(nested)).toBe(tool.spanContext().spanId);
    expect(nested.spanContext().traceId).toBe(tool.spanContext().traceId);
    void childParent;
  });

  it('nests a span created inside executeLanguageModelCall under the chat span', async () => {
    const t = autotelTelemetry({ tracer });
    t.onStart({
      callId: 'c6',
      operationId: 'ai.generateText',
      modelId: 'gpt-4o',
    });
    t.onLanguageModelCallStart({ callId: 'c6', modelId: 'gpt-4o' });

    await t.executeLanguageModelCall({
      callId: 'c6',
      execute: async () => {
        tracer.startSpan('provider.http').end();
        return 'ok';
      },
    });

    t.onLanguageModelCallEnd({ callId: 'c6', modelId: 'gpt-4o' });
    t.onEnd({ callId: 'c6' });

    const chat = one('chat gpt-4o');
    const http = one('provider.http');
    expect(parentIdOf(http)).toBe(chat.spanContext().spanId);
  });
});

describe('autotelTelemetry — content capture', () => {
  const run = (t: ReturnType<typeof autotelTelemetry>) => {
    t.onStart({
      callId: 'c7',
      operationId: 'ai.generateText',
      modelId: 'gpt-4o',
    });
    t.onLanguageModelCallStart({
      callId: 'c7',
      modelId: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Capital of France?' },
      ],
    });
    t.onLanguageModelCallEnd({
      callId: 'c7',
      modelId: 'gpt-4o',
      finishReason: 'stop',
      content: [{ type: 'text', text: 'Paris.' }],
    });
    t.onEnd({ callId: 'c7' });
  };

  it('omits content by default (privacy)', () => {
    run(autotelTelemetry({ tracer }));
    const chat = one('chat gpt-4o');
    expect(chat.attributes[GEN_AI.INPUT_MESSAGES]).toBeUndefined();
    expect(chat.attributes[GEN_AI.OUTPUT_MESSAGES]).toBeUndefined();
    expect(chat.attributes[GEN_AI.SYSTEM_INSTRUCTIONS]).toBeUndefined();
  });

  it('captures input/output/system content in GenAI message format when enabled', () => {
    run(autotelTelemetry({ tracer, captureContent: true }));
    const chat = one('chat gpt-4o');

    const input = JSON.parse(String(chat.attributes[GEN_AI.INPUT_MESSAGES]));
    expect(input).toEqual([
      {
        role: 'user',
        parts: [{ type: 'text', content: 'Capital of France?' }],
      },
    ]);

    const system = JSON.parse(
      String(chat.attributes[GEN_AI.SYSTEM_INSTRUCTIONS]),
    );
    expect(system).toEqual([{ type: 'text', content: 'Be terse.' }]);

    const output = JSON.parse(String(chat.attributes[GEN_AI.OUTPUT_MESSAGES]));
    expect(output).toEqual([
      {
        role: 'assistant',
        parts: [{ type: 'text', content: 'Paris.' }],
        finish_reason: 'stop',
      },
    ]);
  });

  it('redacts via exportContent when provided', () => {
    const t = autotelTelemetry({
      tracer,
      captureContent: true,
      exportContent: (event) => {
        if (event.type === 'chat.start')
          return { ...event, inputMessages: '[redacted]' };
        return; // drop output content entirely
      },
    });
    run(t);
    const chat = one('chat gpt-4o');
    expect(chat.attributes[GEN_AI.INPUT_MESSAGES]).toBe('[redacted]');
    expect(chat.attributes[GEN_AI.OUTPUT_MESSAGES]).toBeUndefined();
  });
});

describe('autotelTelemetry — per-call output recording', () => {
  it('withholds structured output when recordOutputs is false', () => {
    // `captureContent` is the global permission; `recordOutputs` is the
    // caller's decision for this one call, and the caller wins. Structured
    // output is exactly where the sensitive fields are — an extracted address,
    // a parsed invoice — so honouring it everywhere except here leaks the
    // shape most worth withholding.
    const t = autotelTelemetry({ tracer, captureContent: true });

    t.onStart({
      callId: 'obj1',
      operationId: 'ai.generateObject',
      provider: 'openai',
      modelId: 'gpt-4o',
    });
    t.onObjectStepStart({
      callId: 'obj1',
      provider: 'openai',
      modelId: 'gpt-4o',
    });
    t.onObjectStepEnd({
      callId: 'obj1',
      finishReason: 'stop',
      objectText: '{"cardNumber":"4111111111111111"}',
      recordOutputs: false,
    });
    t.onEnd({ callId: 'obj1' });

    const chat = one('chat gpt-4o');
    expect(chat.attributes[GEN_AI.OUTPUT_MESSAGES]).toBeUndefined();
  });

  it('still records structured output when the caller allows it', () => {
    const t = autotelTelemetry({ tracer, captureContent: true });

    t.onStart({
      callId: 'obj2',
      operationId: 'ai.generateObject',
      provider: 'openai',
      modelId: 'gpt-4o',
    });
    t.onObjectStepStart({
      callId: 'obj2',
      provider: 'openai',
      modelId: 'gpt-4o',
    });
    t.onObjectStepEnd({
      callId: 'obj2',
      finishReason: 'stop',
      objectText: '{"city":"SF"}',
      recordOutputs: true,
    });
    t.onEnd({ callId: 'obj2' });

    const chat = one('chat gpt-4o');
    expect(String(chat.attributes[GEN_AI.OUTPUT_MESSAGES])).toContain('SF');
  });
});
