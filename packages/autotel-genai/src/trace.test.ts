import { beforeEach, describe, expect, it, vi } from 'vitest';

const traceCalls: { name: unknown; factory: (ctx: unknown) => unknown }[] = [];
const fakeCtx = { setAttributes: vi.fn(), setAttribute: vi.fn() };

// Capture how traceGenAI invokes the core `trace()`: span name + factory.
vi.mock('autotel', () => ({
  trace: vi.fn((name: unknown, factory: (ctx: unknown) => unknown) => {
    traceCalls.push({ name, factory });
    return (...args: unknown[]) =>
      (factory(fakeCtx) as (...a: unknown[]) => unknown)(...args);
  }),
}));

const { traceGenAI, recordGenAiResponse, recordGenAiUsage } = await import(
  './trace.js'
);

beforeEach(() => {
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
    recordGenAiResponse(ctx, { model: 'gpt-4o', id: 'r1', finishReasons: ['stop'] });
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
