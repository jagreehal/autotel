import { describe, it, expect } from 'vitest'
import { buildRunTrace, flattenTrace, type TraceNode } from './trace'
import type { GenAiSpan } from './types'

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
  }
}

const kinds = (nodes: TraceNode[]): string[] =>
  flattenTrace(nodes).map((n) => `${'  '.repeat(n.depth)}${n.kind}:${n.label}`)

describe('buildRunTrace — Pydantic AI + Logfire shape', () => {
  // invoke_agent → [chat (decides tool), execute_tool, chat (answer)]
  const spans = [
    span({ spanId: 'agent', operation: 'invoke_agent', agent: { name: 'TripMate' }, startMs: 0, endMs: 500 }),
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
      messages: [{ role: 'assistant', parts: [{ kind: 'text', text: 'Buenas noches.' }] }],
    }),
  ]

  it('nests chats and the tool under the agent', () => {
    const trace = buildRunTrace(spans)
    expect(kinds(trace)).toEqual([
      'agent:Agent: TripMate',
      '  step:ollama/granite',
      '  tool:Tool: get_user_time',
      '  step:ollama/granite',
      '    text:Text',
    ])
  })

  it('does not synthesize a tool the execute_tool span already covers', () => {
    const trace = buildRunTrace(spans)
    const flat = flattenTrace(trace)
    // exactly one tool node (the execute_tool span), not a duplicate from chat1
    expect(flat.filter((n) => n.kind === 'tool')).toHaveLength(1)
    const tool = flat.find((n) => n.kind === 'tool')!
    expect(tool.sublabel).toBe('→ 23:59')
  })

  it('surfaces the answer text on the responding step', () => {
    const text = flattenTrace(buildRunTrace(spans)).find((n) => n.kind === 'text')!
    expect(text.sublabel).toBe('Buenas noches.')
  })
})

describe('buildRunTrace — wrapper-span shape', () => {
  // outer wrapper (wraps) → [child (tool call), child (answer)]
  const spans = [
    span({ spanId: 'root', startMs: 0, endMs: 500, usage: { inputTokens: 385, outputTokens: 96 } }),
    span({
      spanId: 'gen1',
      parentSpanId: 'root',
      startMs: 10,
      endMs: 200,
      toolCalls: [{ id: 'call_x', name: 'getUserTime', arguments: {}, result: '00:48' }],
    }),
    span({
      spanId: 'gen2',
      parentSpanId: 'root',
      startMs: 210,
      endMs: 480,
      messages: [{ role: 'assistant', parts: [{ kind: 'text', text: 'Buenas noches.' }] }],
    }),
  ]

  it('renders the wrapper as a group and synthesizes the inline tool call', () => {
    const trace = buildRunTrace(spans)
    expect(kinds(trace)).toEqual([
      'group:ollama/granite',
      '  step:ollama/granite',
      '    tool:Tool: getUserTime',
      '  step:ollama/granite',
      '    text:Text',
    ])
  })

  it('shows the synthesized tool args/result', () => {
    const tool = flattenTrace(buildRunTrace(spans)).find((n) => n.kind === 'tool')!
    expect(tool.sublabel).toBe('{} → 00:48')
  })

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
        messages: [{ role: 'assistant', parts: [{ kind: 'text', text: 'Done.' }] }],
      }),
    ]
    const flat = flattenTrace(buildRunTrace(replayed))
    expect(flat.filter((n) => n.kind === 'tool')).toHaveLength(1)
    // and it's under the first step (depth 2 below gen1)
    const tool = flat.find((n) => n.kind === 'tool')!
    expect(tool.depth).toBe(2)
  })
})

describe('buildRunTrace — extras', () => {
  it('emits a reasoning node when reasoning tokens are present', () => {
    const trace = buildRunTrace([
      span({ spanId: 'r', usage: { inputTokens: 10, outputTokens: 5, reasoningOutputTokens: 32 } }),
    ])
    const reasoning = flattenTrace(trace).find((n) => n.kind === 'reasoning')!
    expect(reasoning.sublabel).toBe('32 tokens')
  })

  it('renders a handoff node', () => {
    const trace = buildRunTrace([
      span({ spanId: 'h', operation: 'execute_handoff', handoff: { fromAgent: 'triage', toAgent: 'billing' } }),
    ])
    expect(trace[0].kind).toBe('handoff')
    expect(trace[0].label).toBe('triage → billing')
  })

  it('returns an empty trace for no spans', () => {
    expect(buildRunTrace([])).toEqual([])
  })

  it('orders roots and children chronologically', () => {
    const trace = buildRunTrace([
      span({ spanId: 'b', startMs: 200 }),
      span({ spanId: 'a', startMs: 100 }),
    ])
    expect(trace.map((n) => n.spanId)).toEqual(['a', 'b'])
  })
})
