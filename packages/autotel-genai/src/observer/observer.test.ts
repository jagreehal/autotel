import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
  type Tracer,
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGenAiObserver } from './observer.js';
import type { GenAiObserverEvent } from './types.js';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
let tracer: Tracer;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  tracer = provider.getTracer('observer-test');
});

afterEach(async () => {
  await provider.shutdown();
});

const spans = () => exporter.getFinishedSpans();
const one = (name: string): ReadableSpan => {
  const matches = spans().filter((s) => s.name === name);
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one span named "${name}", got ${matches.length}`,
    );
  }
  return matches[0]!;
};
const parentIdOf = (span: ReadableSpan) => span.parentSpanContext?.spanId;

describe('createGenAiObserver — hierarchy', () => {
  it('reconstructs a workflow → agent → chat / tool tree from flat events', () => {
    const observe = createGenAiObserver({ tracer });
    const events: GenAiObserverEvent[] = [
      { type: 'workflow.start', id: 'w', workflow: { workflowName: 'triage' } },
      {
        type: 'agent.start',
        id: 'a',
        parentId: 'w',
        agent: { name: 'planner' },
      },
      {
        type: 'chat.start',
        id: 'c',
        parentId: 'a',
        request: { provider: 'openai', model: 'gpt-4o' },
      },
      { type: 'chat.end', id: 'c' },
      { type: 'tool.start', id: 't', parentId: 'a', tool: { name: 'search' } },
      { type: 'tool.end', id: 't' },
      { type: 'agent.end', id: 'a' },
      { type: 'workflow.end', id: 'w' },
    ];
    for (const event of events) observe(event);

    const workflow = one('invoke_workflow triage');
    const agent = one('invoke_agent planner');
    const chat = one('chat gpt-4o');
    const tool = one('execute_tool search');

    expect(parentIdOf(workflow)).toBeUndefined();
    expect(parentIdOf(agent)).toBe(workflow.spanContext().spanId);
    expect(parentIdOf(chat)).toBe(agent.spanContext().spanId);
    expect(parentIdOf(tool)).toBe(agent.spanContext().spanId);

    expect(chat.kind).toBe(SpanKind.CLIENT);
    expect(agent.kind).toBe(SpanKind.INTERNAL);
    expect(tool.kind).toBe(SpanKind.INTERNAL);
    expect(chat.attributes['gen_ai.operation.name']).toBe('chat');
    expect(tool.attributes['gen_ai.tool.name']).toBe('search');
  });

  it('attaches an otherwise-root span to a resolved parent context', () => {
    const appSpan = tracer.startSpan('app.request');
    const observe = createGenAiObserver({
      tracer,
      resolveParentContext: () =>
        otelTrace.setSpan(otelContext.active(), appSpan),
    });

    observe({ type: 'chat.start', id: 'c', request: { model: 'gpt-4o' } });
    observe({ type: 'chat.end', id: 'c' });
    appSpan.end();

    expect(parentIdOf(one('chat gpt-4o'))).toBe(appSpan.spanContext().spanId);
  });

  it('roots a span when there is no tracked or resolved parent', () => {
    const observe = createGenAiObserver({ tracer });
    observe({ type: 'chat.start', id: 'c', request: { model: 'gpt-4o' } });
    observe({ type: 'chat.end', id: 'c' });
    expect(parentIdOf(one('chat gpt-4o'))).toBeUndefined();
  });

  it('passes span links through to the started span', () => {
    const linked = tracer.startSpan('prior.run');
    linked.end();
    const observe = createGenAiObserver({ tracer });
    observe({
      type: 'agent.start',
      id: 'a',
      agent: { name: 'planner' },
      links: [{ context: linked.spanContext() }],
    });
    observe({ type: 'agent.end', id: 'a' });

    expect(one('invoke_agent planner').links[0]?.context.spanId).toBe(
      linked.spanContext().spanId,
    );
  });
});

describe('createGenAiObserver — usage and cost', () => {
  it('records leaf token usage and estimated cost on chat spans only', () => {
    const observe = createGenAiObserver({ tracer });
    observe({ type: 'agent.start', id: 'a', agent: { name: 'planner' } });
    observe({
      type: 'chat.start',
      id: 'c',
      parentId: 'a',
      request: { model: 'gpt-4o' },
    });
    observe({
      type: 'chat.end',
      id: 'c',
      response: { model: 'gpt-4o' },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    observe({ type: 'agent.end', id: 'a' });

    const chat = one('chat gpt-4o');
    expect(chat.attributes['gen_ai.usage.input_tokens']).toBe(1000);
    expect(chat.attributes['gen_ai.usage.output_tokens']).toBe(500);
    expect(chat.attributes['gen_ai.usage.cost.usd']).toBe(0.0075);

    // Aggregate (agent) spans never carry token usage — so summing
    // gen_ai.usage.* across a trace counts each leaf exactly once.
    const agent = one('invoke_agent planner');
    expect(agent.attributes['gen_ai.usage.input_tokens']).toBeUndefined();
  });

  it('uses costModel override when the request model is absent', () => {
    const observe = createGenAiObserver({ tracer });
    observe({ type: 'chat.start', id: 'c', request: {} });
    observe({
      type: 'chat.end',
      id: 'c',
      costModel: 'gpt-4o',
      response: { model: 'gpt-4o-2024' },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    expect(one('chat').attributes['gen_ai.usage.cost.usd']).toBe(0.0075);
  });
});

describe('createGenAiObserver — content privacy', () => {
  const withContent = (extra?: {
    exportContent?: (e: GenAiObserverEvent) => GenAiObserverEvent | undefined;
  }) => {
    const observe = createGenAiObserver({ tracer, ...extra });
    observe({
      type: 'chat.start',
      id: 'c',
      request: { model: 'gpt-4o' },
      inputMessages: 'hello secret',
    });
    observe({ type: 'chat.end', id: 'c' });
    return one('chat gpt-4o');
  };

  it('omits content by default', () => {
    expect(withContent().attributes['gen_ai.input.messages']).toBeUndefined();
  });

  it('exports content when the gate returns the event', () => {
    const chat = withContent({ exportContent: (e) => e });
    expect(chat.attributes['gen_ai.input.messages']).toBe('hello secret');
  });

  it('exports redacted content the gate returns', () => {
    const chat = withContent({
      exportContent: (e) =>
        e.type === 'chat.start' ? { ...e, inputMessages: '[redacted]' } : e,
    });
    expect(chat.attributes['gen_ai.input.messages']).toBe('[redacted]');
  });

  it('omits content when the gate returns undefined', () => {
    // Returning `undefined` is the documented "omit content" signal.
    // eslint-disable-next-line unicorn/no-useless-undefined
    const chat = withContent({ exportContent: () => undefined });
    expect(chat.attributes['gen_ai.input.messages']).toBeUndefined();
  });

  it('omits content (and keeps tracing) when the gate throws', () => {
    const chat = withContent({
      exportContent: () => {
        throw new Error('gate boom');
      },
    });
    expect(chat.attributes['gen_ai.input.messages']).toBeUndefined();
  });

  it('serializes tool arguments and results only when gated open', () => {
    const observe = createGenAiObserver({ tracer, exportContent: (e) => e });
    observe({
      type: 'tool.start',
      id: 't',
      tool: { name: 'search' },
      callArguments: { q: 'otel' },
    });
    observe({ type: 'tool.end', id: 't', callResult: { hits: 3 } });
    const tool = one('execute_tool search');
    expect(tool.attributes['gen_ai.tool.call.arguments']).toBe('{"q":"otel"}');
    expect(tool.attributes['gen_ai.tool.call.result']).toBe('{"hits":3}');
  });
});

describe('createGenAiObserver — lifecycle and errors', () => {
  it('force-closes abandoned children as ERROR when the parent ends', () => {
    const observe = createGenAiObserver({ tracer });
    observe({ type: 'agent.start', id: 'a', agent: { name: 'planner' } });
    observe({
      type: 'chat.start',
      id: 'c',
      parentId: 'a',
      request: { model: 'gpt-4o' },
    });
    // No chat.end — the agent ends while the chat is still open.
    observe({ type: 'agent.end', id: 'a' });

    const chat = one('chat gpt-4o');
    expect(chat.status.code).toBe(SpanStatusCode.ERROR);
    expect(chat.status.message).toMatch(/terminal event/);
    expect(one('invoke_agent planner').status.code).not.toBe(
      SpanStatusCode.ERROR,
    );
  });

  it('marks a span ERROR and records the exception on an error end', () => {
    const observe = createGenAiObserver({ tracer });
    observe({ type: 'chat.start', id: 'c', request: { model: 'gpt-4o' } });
    observe({
      type: 'chat.end',
      id: 'c',
      error: new Error('rate limited'),
    });
    const chat = one('chat gpt-4o');
    expect(chat.status.code).toBe(SpanStatusCode.ERROR);
    expect(chat.status.message).toBe('rate limited');
    expect(chat.events[0]?.name).toBe('exception');
  });

  it('ignores an end for an unknown id', () => {
    const observe = createGenAiObserver({ tracer });
    expect(() => observe({ type: 'chat.end', id: 'nope' })).not.toThrow();
    expect(spans()).toHaveLength(0);
  });

  it('honors explicit start and end times', () => {
    const observe = createGenAiObserver({ tracer });
    observe({
      type: 'chat.start',
      id: 'c',
      startTime: new Date(1000),
      request: { model: 'gpt-4o' },
    });
    observe({ type: 'chat.end', id: 'c', endTime: new Date(3000) });
    const chat = one('chat gpt-4o');
    const seconds = chat.startTime[0] + chat.startTime[1] / 1e9;
    expect(seconds).toBeCloseTo(1, 5);
    expect(chat.duration[0]).toBe(2);
  });

  it('stamps agent security attrs for plan, memory, provenance, and render events', () => {
    const observe = createGenAiObserver({ tracer });
    observe({ type: 'agent.start', id: 'a', agent: { name: 'planner' } });
    observe({
      type: 'input.provenance',
      parentId: 'a',
      provenance: 'external_untrusted',
    });
    observe({
      type: 'plan.step',
      parentId: 'a',
      stepIndex: 1,
      toolIntents: ['search'],
      summary: 'Find docs',
    });
    observe({
      type: 'memory.access',
      parentId: 'a',
      operation: 'read',
      isolationKey: 'user:7',
      contentHash: 'abc',
    });
    observe({
      type: 'render.output',
      parentId: 'a',
      format: 'markdown',
      containsUrl: true,
      urlCount: 2,
    });
    observe({ type: 'agent.end', id: 'a' });

    const agent = one('invoke_agent planner');
    expect(agent.attributes).toMatchObject({
      'agent.input.provenance': 'external_untrusted',
      'agent.plan.step_index': 1,
      'agent.plan.tool_intents': ['search'],
      'agent.memory.operation': 'read',
      'agent.memory.isolation_key': 'user:7',
      'agent.output.format': 'markdown',
      'agent.output.contains_url': true,
      'agent.output.url_count': 2,
    });
  });
});

describe('createGenAiObserver — agent id (#242)', () => {
  it('drops gen_ai.agent.id on internal agents and keeps it on remote ones', () => {
    const observe = createGenAiObserver({ tracer });
    observe({
      type: 'agent.start',
      id: 'internal',
      agent: { id: 'agent-1', name: 'local' },
    });
    observe({ type: 'agent.end', id: 'internal' });
    observe({
      type: 'agent.start',
      id: 'remote',
      remote: true,
      agent: { id: 'agent-2', name: 'remote' },
    });
    observe({ type: 'agent.end', id: 'remote' });

    expect(
      one('invoke_agent local').attributes['gen_ai.agent.id'],
    ).toBeUndefined();
    const remote = one('invoke_agent remote');
    expect(remote.attributes['gen_ai.agent.id']).toBe('agent-2');
    expect(remote.kind).toBe(SpanKind.CLIENT);
  });
});
