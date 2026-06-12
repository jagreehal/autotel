import { describe, it, expect } from 'vitest'
import { summarizeRun, groupRuns } from './summary'
import type { GenAiSpan } from './types'

function span(overrides: Partial<GenAiSpan> = {}): GenAiSpan {
  return {
    traceId: 't',
    spanId: 's',
    name: 'chat',
    startMs: 0,
    endMs: 1_000_000,
    status: 'ok',
    provider: 'openai',
    operation: 'chat',
    requestModel: 'gpt-4o',
    params: {},
    messages: [],
    toolCalls: [],
    usage: {},
    ...overrides,
  }
}

describe('summarizeRun', () => {
  it('returns an empty summary for no spans', () => {
    const s = summarizeRun([])
    expect(s.spanCount).toBe(0)
    expect(s.modelCalls).toBe(0)
    expect(s.costKnown).toBe(false)
    expect(s.costComplete).toBe(false)
    expect(s.durationMs).toBe(0)
  })

  it('aggregates tokens across model calls', () => {
    const s = summarizeRun([
      span({ usage: { inputTokens: 100, outputTokens: 20, reasoningOutputTokens: 5 } }),
      span({ usage: { inputTokens: 50, outputTokens: 10, cacheReadInputTokens: 30 } }),
    ])
    expect(s.modelCalls).toBe(2)
    expect(s.inputTokens).toBe(150)
    expect(s.outputTokens).toBe(30)
    expect(s.totalTokens).toBe(180)
    expect(s.reasoningTokens).toBe(5)
    expect(s.cachedTokens).toBe(30)
  })

  it('sums table-priced cost and tracks completeness', () => {
    const priced = (total: number): GenAiSpan['cost'] => ({
      currency: 'USD',
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total,
      source: 'table',
    })
    const complete = summarizeRun([
      span({ cost: priced(0.01) }),
      span({ cost: priced(0.02) }),
    ])
    expect(complete.totalCostUsd).toBeCloseTo(0.03)
    expect(complete.costKnown).toBe(true)
    expect(complete.costComplete).toBe(true)

    const partial = summarizeRun([
      span({ cost: priced(0.01) }),
      span({ cost: undefined }),
    ])
    expect(partial.totalCostUsd).toBeCloseTo(0.01)
    expect(partial.costKnown).toBe(true)
    expect(partial.costComplete).toBe(false)
  })

  it('ignores unknown-source cost', () => {
    const s = summarizeRun([
      span({
        cost: {
          currency: 'USD',
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 99,
          source: 'unknown',
        },
      }),
    ])
    expect(s.totalCostUsd).toBe(0)
    expect(s.costKnown).toBe(false)
    expect(s.costComplete).toBe(false)
  })

  it('counts execute_tool spans as tool calls', () => {
    const s = summarizeRun([
      span(),
      span({ operation: 'execute_tool', name: 'get_weather' }),
      span({ operation: 'execute_tool', name: 'search' }),
    ])
    expect(s.toolCalls).toBe(2)
    expect(s.modelCalls).toBe(1)
  })

  it('falls back to inlined tool calls when no execute_tool spans exist', () => {
    const s = summarizeRun([
      span({
        toolCalls: [
          { name: 'a', arguments: {} },
          { name: 'b', arguments: {} },
        ],
      }),
    ])
    expect(s.toolCalls).toBe(2)
  })

  it('counts agent invocations and handoffs', () => {
    const s = summarizeRun([
      span({ operation: 'invoke_agent', agent: { name: 'planner' } }),
      span({ operation: 'invoke_agent', agent: { name: 'researcher' } }),
      span({ operation: 'execute_handoff', handoff: { fromAgent: 'a', toAgent: 'b' } }),
    ])
    expect(s.agentInvocations).toBe(2)
    expect(s.handoffs).toBe(1)
  })

  it('counts errors', () => {
    const s = summarizeRun([span({ status: 'error' }), span({ status: 'ok' })])
    expect(s.errors).toBe(1)
  })

  it('computes duration as the run envelope', () => {
    const s = summarizeRun([
      span({ startMs: 100, endMs: 200 }),
      span({ startMs: 150, endMs: 500 }),
    ])
    expect(s.durationMs).toBe(400)
  })

  it('excludes aggregate/wrapper spans (Vercel AI SDK) from model & token counts', () => {
    // ai.generateText (parent) time-contains its two ai.generateText.doGenerate
    // children and carries aggregate tokens + the inlined tool call. Counting it
    // would double the totals.
    const s = summarizeRun([
      span({
        spanId: 'root',
        startMs: 0,
        endMs: 5510,
        usage: { inputTokens: 385, outputTokens: 106 },
        toolCalls: [{ id: 'call_1', name: 'getUserTime', arguments: {} }],
      }),
      span({
        spanId: 'gen1',
        startMs: 10,
        endMs: 3450,
        usage: { inputTokens: 176, outputTokens: 16 },
        toolCalls: [{ id: 'call_1', name: 'getUserTime', arguments: {} }],
      }),
      span({ spanId: 'gen2', startMs: 3460, endMs: 5500, usage: { inputTokens: 209, outputTokens: 90 } }),
    ])
    expect(s.modelCalls).toBe(2)
    expect(s.inputTokens).toBe(385)
    expect(s.outputTokens).toBe(106)
    expect(s.toolCalls).toBe(1)
    expect(s.durationMs).toBe(5510)
  })

  it('dedups the same tool-call id replayed across turns (AI SDK history)', () => {
    // The AI SDK passes prior tool calls in each turn's input history, so the
    // same call id surfaces on multiple sibling spans — count it once.
    const s = summarizeRun([
      span({
        spanId: 'gen1',
        startMs: 0,
        endMs: 100,
        toolCalls: [{ id: 'call_abc', name: 'getUserTime', arguments: {} }],
      }),
      span({
        spanId: 'gen2',
        startMs: 110,
        endMs: 200,
        toolCalls: [{ id: 'call_abc', name: 'getUserTime', arguments: {} }],
      }),
    ])
    expect(s.toolCalls).toBe(1)
  })

  it('collects distinct models and providers, skipping unknowns', () => {
    const s = summarizeRun([
      span({ provider: 'openai', responseModel: 'gpt-4o' }),
      span({ provider: 'openai', responseModel: 'gpt-4o' }),
      span({ provider: 'anthropic', responseModel: 'claude-sonnet-4' }),
      span({ provider: 'unknown', requestModel: 'unknown' }),
    ])
    expect(s.models).toEqual(['gpt-4o', 'claude-sonnet-4'])
    expect(s.providers).toEqual(['openai', 'anthropic'])
  })
})

describe('groupRuns', () => {
  const row = (spanId: string, startMs: number, conversationId?: string, traceId = 'tr') => ({
    normalized: span({ spanId, startMs, conversationId }),
    traceId,
  })

  it('groups by conversation id', () => {
    const runs = groupRuns([
      row('a', 10, 'conv1'),
      row('b', 20, 'conv1'),
      row('c', 30, 'conv2'),
    ])
    expect(runs).toHaveLength(2)
    const conv1 = runs.find((r) => r.conversationId === 'conv1')!
    expect(conv1.rows).toHaveLength(2)
  })

  it('falls back to trace id when no conversation id', () => {
    const runs = groupRuns([row('a', 10, undefined, 'trX'), row('b', 20, undefined, 'trX')])
    expect(runs).toHaveLength(1)
    expect(runs[0].key).toBe('trace:trX')
    expect(runs[0].conversationId).toBeUndefined()
  })

  it('orders runs newest first by latest span', () => {
    const runs = groupRuns([
      row('a', 10, 'old'),
      row('b', 100, 'new'),
    ])
    expect(runs[0].conversationId).toBe('new')
    expect(runs[1].conversationId).toBe('old')
  })
})
