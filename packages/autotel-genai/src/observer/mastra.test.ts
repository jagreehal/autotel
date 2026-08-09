import { describe, expect, it } from 'vitest';
import { createMastraObserver, type MastraExportedSpan } from './mastra.js';
import type { GenAiObserverEvent } from './types.js';

function collect(options?: Parameters<typeof createMastraObserver>[1]): {
  events: GenAiObserverEvent[];
  started: (span: MastraExportedSpan) => Promise<void>;
  ended: (span: MastraExportedSpan) => Promise<void>;
} {
  const events: GenAiObserverEvent[] = [];
  const exporter = createMastraObserver((event) => events.push(event), options);
  return {
    events,
    started: (exportedSpan) =>
      exporter.exportTracingEvent({ type: 'span_started', exportedSpan }),
    ended: (exportedSpan) =>
      exporter.exportTracingEvent({ type: 'span_ended', exportedSpan }),
  };
}

const START = new Date('2026-01-01T00:00:00.000Z');
const END = new Date('2026-01-01T00:00:02.000Z');

function span(overrides: Partial<MastraExportedSpan>): MastraExportedSpan {
  return {
    id: 'span-1',
    name: 'span',
    type: 'generic',
    startTime: START,
    isEvent: false,
    ...overrides,
  };
}

describe('createMastraObserver', () => {
  it('maps an agent run to an agent span keyed by id/parentSpanId', async () => {
    const { events, started, ended } = collect();
    const agent = span({
      id: 'a1',
      type: 'agent_run',
      name: "agent run: 'ragAgent'",
      entityName: 'ragAgent',
    });
    await started(agent);
    await ended({ ...agent, endTime: END });

    expect(events).toEqual([
      {
        type: 'agent.start',
        id: 'a1',
        parentId: undefined,
        startTime: START,
        agent: { name: 'ragAgent' },
      },
      { type: 'agent.end', id: 'a1', endTime: END, error: undefined },
    ]);
  });

  it('maps a model generation to a chat span with usage, cost model and TTFC', async () => {
    const { events, started, ended } = collect();
    const request = {
      model: 'gpt-4o',
      provider: 'openai.chat',
      streaming: true,
      parameters: { temperature: 0.2, maxOutputTokens: 512 },
    };
    const generation = span({
      id: 'g1',
      parentSpanId: 'a1',
      type: 'model_generation',
      name: 'llm',
      attributes: request,
    });
    await started(generation);
    await ended({
      ...generation,
      endTime: END,
      attributes: {
        ...request,
        responseModel: 'gpt-4o-2024-08-06',
        responseId: 'resp_1',
        finishReason: 'stop',
        completionStartTime: new Date(START.getTime() + 250),
        usage: {
          inputTokens: 120,
          outputTokens: 40,
          inputDetails: { cacheRead: 100 },
          outputDetails: { reasoning: 8 },
        },
      },
    });

    expect(events[0]).toMatchObject({
      type: 'chat.start',
      id: 'g1',
      parentId: 'a1',
      request: {
        operation: 'chat',
        provider: 'openai',
        model: 'gpt-4o',
        stream: true,
        temperature: 0.2,
        maxTokens: 512,
      },
    });
    expect(events[1]).toMatchObject({
      type: 'chat.end',
      id: 'g1',
      response: {
        model: 'gpt-4o-2024-08-06',
        id: 'resp_1',
        finishReasons: ['stop'],
        timeToFirstChunk: 0.25,
      },
      usage: {
        inputTokens: 120,
        outputTokens: 40,
        cacheReadInputTokens: 100,
        reasoningOutputTokens: 8,
      },
      costModel: 'gpt-4o-2024-08-06',
    });
  });

  it('maps a RAG embedding to an embeddings span', async () => {
    const { events, started, ended } = collect();
    const model = { model: 'text-embedding-3-small', provider: 'openai' };
    const embed = span({
      id: 'e1',
      type: 'rag_embedding',
      name: 'embed',
      attributes: model,
    });
    await started(embed);
    await ended({
      ...embed,
      endTime: END,
      attributes: { ...model, usage: { inputTokens: 32 } },
    });

    expect(events[0]).toMatchObject({
      type: 'chat.start',
      request: { operation: 'embeddings', model: 'text-embedding-3-small' },
    });
    expect(events[1]).toMatchObject({ usage: { inputTokens: 32 } });
  });

  it('maps tool calls, tagging MCP tools as extensions', async () => {
    const { events, started, ended } = collect();
    const tool = span({
      id: 't1',
      parentSpanId: 'g1',
      type: 'mcp_tool_call',
      // Mastra's display name wraps the identity; `gen_ai.tool.name` wants the
      // identity, which is `entityName`.
      name: "mcp_tool: 'search_docs' on 'docs'",
      entityName: 'search_docs',
      input: { query: 'refunds' },
      attributes: { toolCallId: 'call_1', toolDescription: 'Search the docs' },
    });
    await started(tool);
    await ended({ ...tool, endTime: END, output: { hits: 3 } });

    expect(events[0]).toMatchObject({
      type: 'tool.start',
      id: 't1',
      parentId: 'g1',
      tool: {
        name: 'search_docs',
        type: 'extension',
        callId: 'call_1',
        description: 'Search the docs',
      },
      callArguments: { query: 'refunds' },
    });
    expect(events[1]).toMatchObject({
      type: 'tool.end',
      callResult: { hits: 3 },
    });
  });

  it('drops plumbing spans and reparents their children to the kept ancestor', async () => {
    const { events, started, ended } = collect();
    await started(span({ id: 'a1', type: 'agent_run', entityName: 'agent' }));
    // A model step is plumbing: its usage is already summed on the generation.
    await started(
      span({ id: 's1', parentSpanId: 'a1', type: 'model_step', name: 'step' }),
    );
    await started(
      span({
        id: 'g1',
        parentSpanId: 's1',
        type: 'model_generation',
        name: 'llm',
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'agent.start',
      'chat.start',
    ]);
    expect(events[1]).toMatchObject({ id: 'g1', parentId: 'a1' });

    // The skipped span's own end emits nothing.
    await ended(
      span({ id: 's1', parentSpanId: 'a1', type: 'model_step', name: 'step' }),
    );
    expect(events).toHaveLength(2);
  });

  it('opens a span whose start event never arrived', async () => {
    const { events, ended } = collect();
    await ended(
      span({ id: 'g1', type: 'model_generation', name: 'llm', endTime: END }),
    );
    expect(events.map((event) => event.type)).toEqual([
      'chat.start',
      'chat.end',
    ]);
  });

  it('opens and closes an event span from its single event', async () => {
    const { events, ended } = collect();
    await ended(
      span({ id: 't1', type: 'tool_call', name: 'now', isEvent: true }),
    );
    expect(events.map((event) => event.type)).toEqual([
      'tool.start',
      'tool.end',
    ]);
  });

  it('carries errorInfo through as the terminal error', async () => {
    const { events, started, ended } = collect();
    const tool = span({ id: 't1', type: 'tool_call', name: 'lookup' });
    await started(tool);
    await ended({ ...tool, endTime: END, errorInfo: { message: 'boom' } });
    expect(events[1]).toMatchObject({ type: 'tool.end', error: 'boom' });
  });

  it('honours a custom skipSpan', async () => {
    const { events, started } = collect({
      skipSpan: (candidate) => candidate.type === 'agent_run',
    });
    await started(span({ id: 'a1', type: 'agent_run', entityName: 'agent' }));
    await started(span({ id: 's1', parentSpanId: 'a1', type: 'model_step' }));
    await started(
      span({ id: 'g1', parentSpanId: 's1', type: 'model_generation' }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'g1', parentId: undefined });
  });
});
