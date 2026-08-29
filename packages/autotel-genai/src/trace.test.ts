import { beforeEach, describe, expect, it, vi } from 'vitest';

const traceCalls: { name: unknown; factory: (ctx: unknown) => unknown }[] = [];
const fakeCtx = { setAttributes: vi.fn(), setAttribute: vi.fn() };

// Capture how traceGenAI invokes the core tracing wrapper.
vi.mock('autotel', () => ({
  withTracing:
    (options: { name: unknown }) => (factory: (ctx: unknown) => unknown) => {
      traceCalls.push({ name: options.name, factory });
      return (...args: unknown[]) =>
        (factory(fakeCtx) as (...a: unknown[]) => unknown)(...args);
    },
}));

const recordedMetrics: unknown[] = [];
vi.mock('./metrics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./metrics.js')>()),
  recordGenAiMetrics: (input: unknown) => recordedMetrics.push(input),
}));

const { traceGenAI, recordGenAiResponse, recordGenAiUsage } =
  await import('./trace.js');

beforeEach(() => {
  recordedMetrics.length = 0;
  traceCalls.length = 0;
  fakeCtx.setAttributes.mockClear();
  fakeCtx.setAttribute.mockClear();
});

describe('traceGenAI', () => {
  it('names the span `{operation} {model}` and sets request attributes', async () => {
    const chat = traceGenAI({
      provider: 'openai',
      model: 'gpt-4o',
      operation: 'chat',
      temperature: 0.2,
    })(() => async (p: string) => p.toUpperCase());

    await chat('hi');

    expect(traceCalls[0].name).toBe('chat gpt-4o');
    expect(fakeCtx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'openai',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.request.temperature': 0.2,
      }),
    );
  });

  it('defaults the operation to chat and supports a custom span name', async () => {
    const run = traceGenAI({ model: 'm', spanName: 'custom span' })(
      () => async () => 1,
    );
    await run();
    expect(traceCalls[0].name).toBe('custom span');
    expect(fakeCtx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ 'gen_ai.operation.name': 'chat' }),
    );
  });

  it('records error.type when the operation throws, and rethrows', async () => {
    class RateLimitError extends Error {
      override name = 'RateLimitError';
    }
    const run = traceGenAI({ model: 'gpt-4o' })(() => async () => {
      throw new RateLimitError('429');
    });

    await expect(run()).rejects.toThrow('429');
    expect(fakeCtx.setAttribute).toHaveBeenCalledWith(
      'error.type',
      'RateLimitError',
    );
  });

  it('falls back to Error for a thrown non-Error', async () => {
    const run = traceGenAI({ model: 'gpt-4o' })(() => async () => {
      throw 'string failure';
    });

    await expect(run()).rejects.toBe('string failure');
    expect(fakeCtx.setAttribute).toHaveBeenCalledWith('error.type', 'Error');
  });

  it('records the canonical metrics from what the handler wrote', async () => {
    const chat = traceGenAI({
      provider: 'openai',
      model: 'gpt-4o',
      operation: 'chat',
    })((ctx) => async () => {
      ctx.setAttributes({
        'gen_ai.usage.input_tokens': 900,
        'gen_ai.usage.output_tokens': 120,
      });
      ctx.setAttribute('gen_ai.usage.cost.usd', 0.0033);
      ctx.setAttribute('gen_ai.response.time_to_first_chunk', 0.42);
      return 'ok';
    });

    await chat();

    expect(recordedMetrics).toHaveLength(1);
    expect(recordedMetrics[0]).toMatchObject({
      inputTokens: 900,
      outputTokens: 120,
      costUsd: 0.0033,
      timeToFirstChunk: 0.42,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'openai',
        'gen_ai.request.model': 'gpt-4o',
      },
    });
  });

  it('carries error.type onto the metrics when the call fails', async () => {
    const chat = traceGenAI({ model: 'gpt-4o' })(() => async () => {
      throw new TypeError('bad tool schema');
    });

    await expect(chat()).rejects.toThrow('bad tool schema');
    expect(recordedMetrics[0]).toMatchObject({
      attributes: { 'error.type': 'TypeError' },
    });
  });

  it('keeps the receiver so a traced method still sees its object', async () => {
    // Core `withTracing` invokes the factory's function as `fn.call(this, ...)`
    // precisely so methods keep working; an arrow wrapper would drop that.
    traceGenAI({ model: 'gpt-4o' })(
      () =>
        async function (this: { model: string }) {
          return this.model;
        },
    );
    const handler = traceCalls[0]!.factory(fakeCtx) as (
      this: unknown,
    ) => Promise<string>;

    await expect(handler.call({ model: 'gpt-4o' })).resolves.toBe('gpt-4o');
  });

  it('leaves the context spreadable', async () => {
    // `logger.info({ ...ctx }, 'llm call')` is the documented way to correlate
    // a log line; watching attributes must not cost the handler its traceId.
    const ctxWithIds = { ...fakeCtx, traceId: 'abc', spanId: 'def' };
    traceGenAI({ model: 'gpt-4o' })((ctx) => async () => ctx);
    traceCalls[0]!.factory(ctxWithIds);

    expect({ ...ctxWithIds }).toMatchObject({ traceId: 'abc', spanId: 'def' });
  });

  it('records nothing when metrics are switched off', async () => {
    const chat = traceGenAI({ model: 'gpt-4o', metrics: false })(
      () => async () => 'ok',
    );

    await chat();
    expect(recordedMetrics).toHaveLength(0);
  });

  it('uses tool name for execute_tool spans', async () => {
    const run = traceGenAI({
      operation: 'execute_tool',
      tool: { name: 'get_weather', type: 'function' },
    })(() => async () => 1);

    await run();

    expect(traceCalls[0].name).toBe('execute_tool get_weather');
    expect(fakeCtx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'get_weather',
      }),
    );
  });

  it('uses data_source.id for retrieval spans', async () => {
    const run = traceGenAI({
      operation: 'retrieval',
      dataSourceId: 'vector-store-1',
    })(() => async () => 1);

    await run();

    expect(traceCalls[0].name).toBe('retrieval vector-store-1');
  });

  it('uses agent and workflow names for agentic spans', async () => {
    const invokeAgent = traceGenAI({
      operation: 'invoke_agent',
      provider: 'openai',
      agent: { name: 'planner' },
    })(() => async () => 1);
    await invokeAgent();
    expect(traceCalls[0].name).toBe('invoke_agent planner');

    const invokeWorkflow = traceGenAI({
      operation: 'invoke_workflow',
      workflow: { workflowName: 'support_triage' },
    })(() => async () => 1);
    await invokeWorkflow();
    expect(traceCalls[1].name).toBe('invoke_workflow support_triage');
  });

  it('drops gen_ai.agent.id on internal invoke_agent/plan spans (#242), even with a provider', async () => {
    const invokeAgent = traceGenAI({
      operation: 'invoke_agent',
      provider: 'openai',
      agent: { id: 'agent-xyz', name: 'planner' },
    })(() => async () => 1);
    await invokeAgent();
    const attrs = fakeCtx.setAttributes.mock.calls[0][0];
    expect(attrs).not.toHaveProperty('gen_ai.agent.id');
    expect(attrs['gen_ai.agent.name']).toBe('planner');
  });

  it('keeps gen_ai.agent.id on create_agent spans', async () => {
    const createAgent = traceGenAI({
      operation: 'create_agent',
      agent: { id: 'agent-xyz', name: 'planner' },
    })(() => async () => 1);
    await createAgent();
    const attrs = fakeCtx.setAttributes.mock.calls[0][0];
    expect(attrs['gen_ai.agent.id']).toBe('agent-xyz');
  });
});

describe('recordGenAiResponse', () => {
  it('sets canonical response attributes', () => {
    const ctx = { setAttributes: vi.fn() };
    recordGenAiResponse(ctx, {
      model: 'gpt-4o',
      id: 'r1',
      finishReasons: ['stop'],
    });
    expect(ctx.setAttributes).toHaveBeenCalledWith({
      'gen_ai.response.model': 'gpt-4o',
      'gen_ai.response.id': 'r1',
      'gen_ai.response.finish_reasons': ['stop'],
    });
  });
});

describe('recordGenAiUsage', () => {
  it('sets usage attributes and estimated cost', () => {
    const ctx = { setAttributes: vi.fn() };
    const cost = recordGenAiUsage(ctx, 'gpt-4o', {
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(cost).toBe(0.0075);
    expect(ctx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'gen_ai.usage.input_tokens': 1000,
        'gen_ai.usage.output_tokens': 500,
        'gen_ai.usage.cost.usd': 0.0075,
      }),
    );
  });

  it('names an unpriced model instead of leaving the cost silently absent', () => {
    // A model with no pricing entry costs nothing to a cost ceiling and reads
    // as zero on a dashboard. The span has to say the price is unknown.
    const ctx = { setAttributes: vi.fn() };
    const cost = recordGenAiUsage(ctx, 'some-unreleased-model-9', {
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(cost).toBeUndefined();
    const attrs = ctx.setAttributes.mock.calls[0][0];
    expect(attrs).not.toHaveProperty('gen_ai.usage.cost.usd');
    expect(attrs['gen_ai.usage.cost.unpriced_model']).toBe(
      'some-unreleased-model-9',
    );
  });

  it('does not claim an unpriced model when cost recording was declined', () => {
    const ctx = { setAttributes: vi.fn() };
    recordGenAiUsage(
      ctx,
      'some-unreleased-model-9',
      { inputTokens: 10 },
      { recordCost: false },
    );
    const attrs = ctx.setAttributes.mock.calls[0][0];
    expect(attrs).not.toHaveProperty('gen_ai.usage.cost.unpriced_model');
  });

  it('skips cost when recordCost is false', () => {
    const ctx = { setAttributes: vi.fn() };
    const cost = recordGenAiUsage(
      ctx,
      'gpt-4o',
      { inputTokens: 10 },
      { recordCost: false },
    );
    expect(cost).toBeUndefined();
    const attrs = ctx.setAttributes.mock.calls[0][0];
    expect(attrs).not.toHaveProperty('gen_ai.usage.cost.usd');
  });
});
