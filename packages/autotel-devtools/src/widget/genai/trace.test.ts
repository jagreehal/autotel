import { describe, it, expect } from 'vitest';
import {
  buildRunTrace,
  flattenTrace,
  missingParentIds,
  type TraceNode,
} from './trace';
import type { GenAiCost, GenAiSpan } from './types';

function span(overrides: Partial<GenAiSpan> = {}): GenAiSpan {
  return {
    traceId: 't',
    spanId: 's',
    name: 'chat',
    startMs: 0,
    endMs: 100,
    status: 'ok',
    provider: 'ollama',
    operation: 'chat',
    requestModel: 'granite',
    params: {},
    messages: [],
    toolCalls: [],
    usage: {},
    extras: { raw: {} },
    ...overrides,
  };
}

const kinds = (nodes: TraceNode[]): string[] =>
  flattenTrace(nodes).map((n) => `${'  '.repeat(n.depth)}${n.kind}:${n.label}`);

describe('buildRunTrace — Pydantic AI + Logfire shape', () => {
  // invoke_agent → [chat (decides tool), execute_tool, chat (answer)]
  const spans = [
    span({
      spanId: 'agent',
      operation: 'invoke_agent',
      agent: { name: 'TripMate' },
      startMs: 0,
      endMs: 500,
    }),
    span({
      spanId: 'chat1',
      parentSpanId: 'agent',
      startMs: 10,
      endMs: 200,
      finishReasons: ['tool_call'],
      toolCalls: [{ id: 'call_1', name: 'get_user_time', arguments: {} }],
    }),
    span({
      spanId: 'tool',
      parentSpanId: 'agent',
      operation: 'execute_tool',
      startMs: 210,
      endMs: 215,
      tool: { name: 'get_user_time', callId: 'call_1' },
      extras: { raw: { tool_response: '23:59' } },
    }),
    span({
      spanId: 'chat2',
      parentSpanId: 'agent',
      startMs: 220,
      endMs: 400,
      messages: [
        {
          role: 'assistant',
          parts: [{ kind: 'text', text: 'Buenas noches.' }],
        },
      ],
    }),
  ];

  it('nests chats and the tool under the agent', () => {
    const trace = buildRunTrace(spans);
    expect(kinds(trace)).toEqual([
      'agent:Agent: TripMate',
      '  step:ollama/granite',
      '  tool:Tool: get_user_time',
      '  step:ollama/granite',
      '    text:Text',
    ]);
  });

  it('does not synthesize a tool the execute_tool span already covers', () => {
    const trace = buildRunTrace(spans);
    const flat = flattenTrace(trace);
    // exactly one tool node (the execute_tool span), not a duplicate from chat1
    expect(flat.filter((n) => n.kind === 'tool')).toHaveLength(1);
    const tool = flat.find((n) => n.kind === 'tool')!;
    expect(tool.sublabel).toBe('→ 23:59');
  });

  it('surfaces the answer text on the responding step', () => {
    const text = flattenTrace(buildRunTrace(spans)).find(
      (n) => n.kind === 'text',
    )!;
    expect(text.sublabel).toBe('Buenas noches.');
  });
});

describe('buildRunTrace — wrapper-span shape', () => {
  // outer wrapper (wraps) → [child (tool call), child (answer)]
  const spans = [
    span({
      spanId: 'root',
      startMs: 0,
      endMs: 500,
      usage: { inputTokens: 385, outputTokens: 96 },
    }),
    span({
      spanId: 'gen1',
      parentSpanId: 'root',
      startMs: 10,
      endMs: 200,
      toolCalls: [
        { id: 'call_x', name: 'getUserTime', arguments: {}, result: '00:48' },
      ],
    }),
    span({
      spanId: 'gen2',
      parentSpanId: 'root',
      startMs: 210,
      endMs: 480,
      messages: [
        {
          role: 'assistant',
          parts: [{ kind: 'text', text: 'Buenas noches.' }],
        },
      ],
    }),
  ];

  it('renders the wrapper as a group and synthesizes the inline tool call', () => {
    const trace = buildRunTrace(spans);
    expect(kinds(trace)).toEqual([
      'group:ollama/granite',
      '  step:ollama/granite',
      '    tool:Tool: getUserTime',
      '  step:ollama/granite',
      '    text:Text',
    ]);
  });

  it('shows the synthesized tool args/result', () => {
    const tool = flattenTrace(buildRunTrace(spans)).find(
      (n) => n.kind === 'tool',
    )!;
    expect(tool.sublabel).toBe('{} → 00:48');
  });

  it('emits a replayed tool call once, on the earliest step that made it', () => {
    // Both steps carry call_x (the second replays it in its input history).
    // It must appear once, under the first step.
    const replayed = [
      span({ spanId: 'root', startMs: 0, endMs: 500 }),
      span({
        spanId: 'gen1',
        parentSpanId: 'root',
        startMs: 10,
        endMs: 200,
        toolCalls: [{ id: 'call_x', name: 'getUserTime', arguments: {} }],
      }),
      span({
        spanId: 'gen2',
        parentSpanId: 'root',
        startMs: 210,
        endMs: 480,
        toolCalls: [{ id: 'call_x', name: 'getUserTime', arguments: {} }],
        messages: [
          { role: 'assistant', parts: [{ kind: 'text', text: 'Done.' }] },
        ],
      }),
    ];
    const flat = flattenTrace(buildRunTrace(replayed));
    expect(flat.filter((n) => n.kind === 'tool')).toHaveLength(1);
    // and it's under the first step (depth 2 below gen1)
    const tool = flat.find((n) => n.kind === 'tool')!;
    expect(tool.depth).toBe(2);
  });
});

describe('buildRunTrace — extras', () => {
  it('emits a reasoning node when reasoning tokens are present', () => {
    const trace = buildRunTrace([
      span({
        spanId: 'r',
        usage: { inputTokens: 10, outputTokens: 5, reasoningOutputTokens: 32 },
      }),
    ]);
    const reasoning = flattenTrace(trace).find((n) => n.kind === 'reasoning')!;
    expect(reasoning.sublabel).toBe('32 tokens');
  });

  it('renders a handoff node', () => {
    const trace = buildRunTrace([
      span({
        spanId: 'h',
        operation: 'execute_handoff',
        handoff: { fromAgent: 'triage', toAgent: 'billing' },
      }),
    ]);
    expect(trace[0].kind).toBe('handoff');
    expect(trace[0].label).toBe('triage → billing');
  });

  it('returns an empty trace for no spans', () => {
    expect(buildRunTrace([])).toEqual([]);
  });

  it('orders roots and children chronologically', () => {
    const trace = buildRunTrace([
      span({ spanId: 'b', startMs: 200 }),
      span({ spanId: 'a', startMs: 100 }),
    ]);
    expect(trace.map((n) => n.spanId)).toEqual(['a', 'b']);
  });
});

describe('buildRunTrace — cost, errors and identity', () => {
  const cost = (
    total: number,
    source: GenAiCost['source'] = 'table',
  ): GenAiCost => ({
    currency: 'USD',
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total,
    source,
  });

  it('puts a model call its own cost and rolls children up into the agent', () => {
    const trace = buildRunTrace([
      span({ spanId: 'agent', operation: 'invoke_agent', endMs: 300 }),
      span({ spanId: 'c1', parentSpanId: 'agent', cost: cost(0.02) }),
      span({
        spanId: 'c2',
        parentSpanId: 'agent',
        startMs: 150,
        cost: cost(0.03),
      }),
    ]);
    expect(trace[0].costUsd).toBeCloseTo(0.05);
    expect(trace[0].children.map((c) => c.costUsd)).toEqual([0.02, 0.03]);
  });

  it('leaves cost absent when nothing was priced', () => {
    const trace = buildRunTrace([
      span({ spanId: 'c', cost: cost(0, 'unknown') }),
    ]);
    expect(trace[0].costUsd).toBeUndefined();
  });

  it('flags errored spans', () => {
    const trace = buildRunTrace([span({ spanId: 'e', status: 'error' })]);
    expect(trace[0].error).toBe(true);
  });

  it('keeps node ids stable when the run grows', () => {
    const first = buildRunTrace([span({ spanId: 'a' })]);
    const later = buildRunTrace([
      span({ spanId: 'z', startMs: -50 }),
      span({ spanId: 'a' }),
    ]);
    const idOf = (nodes: TraceNode[], spanId: string) =>
      flattenTrace(nodes).find((n) => n.spanId === spanId)!.id;
    expect(idOf(later, 'a')).toBe(idOf(first, 'a'));
  });
});

describe('buildRunTrace — running parents', () => {
  const children = [
    span({ spanId: 'plan', parentSpanId: 'orch', startMs: 900, endMs: 5000 }),
    span({
      spanId: 'tool',
      parentSpanId: 'orch',
      startMs: 5100,
      endMs: 5200,
      operation: 'execute_tool',
    }),
  ];

  it('finds the parents children point at that have not arrived', () => {
    expect(missingParentIds(children)).toEqual(new Set(['orch']));
    expect(missingParentIds([...children, span({ spanId: 'orch' })]).size).toBe(
      0,
    );
  });

  it('groups the children under a running stand-in that starts with the first', () => {
    const trace = buildRunTrace(children, {
      runningParentIds: new Set(['orch']),
    });
    expect(kinds(trace)).toEqual([
      'running:Running',
      '  step:ollama/granite',
      '  tool:Tool: chat',
    ]);
    expect(trace[0].startMs).toBe(900);
    expect(trace[0].durationMs).toBeUndefined();
  });

  it('leaves orphans as roots when their parent is not believed running', () => {
    const trace = buildRunTrace(children);
    expect(trace.map((n) => n.kind)).toEqual(['step', 'tool']);
  });
});
