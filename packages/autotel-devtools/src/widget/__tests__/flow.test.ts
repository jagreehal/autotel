import { describe, it, expect } from 'vitest'
import {
  buildFlowGraph,
  classifySpan,
  extractIO,
  layoutFlow,
  sumFlowMetrics,
  START_ID,
  END_ID,
} from '../flow/flow'
import type { SpanData } from '../types'
import fixture from '../flow/__fixtures__/financial-calculator.json'

const spans = fixture as unknown as SpanData[]

function span(partial: Partial<SpanData>): SpanData {
  return {
    traceId: 't',
    spanId: 's',
    name: 'x',
    kind: 'INTERNAL',
    startTime: 0,
    endTime: 1,
    duration: 1,
    attributes: {},
    status: { code: 'OK' },
    ...partial,
  }
}

describe('classifySpan', () => {
  it('detects AI tool calls by ai.toolCall.name', () => {
    const r = classifySpan(
      span({ name: 'ai.toolCall', attributes: { 'ai.toolCall.name': 'calculate' } }),
    )
    expect(r).toEqual({ role: 'tool', label: 'calculate' })
  })

  it('detects LLM spans and strips the functionId prefix', () => {
    const r = classifySpan(
      span({
        name: 'complex-financial-calculator:ai.streamText',
        attributes: { 'ai.model.provider': 'ollama' },
      }),
    )
    expect(r).toEqual({ role: 'llm', label: 'ai.streamText' })
  })

  it('treats SERVER spans as entry points', () => {
    expect(classifySpan(span({ kind: 'SERVER', name: 'POST /x' })).role).toBe('entry')
  })

  it('falls back to function for plain internal spans', () => {
    expect(classifySpan(span({ name: 'loadPortfolio' }))).toEqual({
      role: 'function',
      label: 'loadPortfolio',
    })
  })

  it('detects db spans', () => {
    expect(
      classifySpan(span({ name: 'q', attributes: { 'db.system': 'postgres' } })).role,
    ).toBe('db')
  })
})

describe('extractIO', () => {
  it('reads tool args/result', () => {
    const io = extractIO(
      span({
        attributes: {
          'ai.toolCall.args': '{"expression":"1+1"}',
          'ai.toolCall.result': '{"result":2}',
        },
      }),
      'tool',
    )
    expect(io.input).toEqual({ expression: '1+1' })
    expect(io.output).toEqual({ result: 2 })
  })

  it('reads function autotel.input/output convention', () => {
    const io = extractIO(
      span({
        attributes: {
          'autotel.input': '{"userId":"anon"}',
          'autotel.output': '{"holdings":3}',
        },
      }),
      'function',
    )
    expect(io.input).toEqual({ userId: 'anon' })
    expect(io.output).toEqual({ holdings: 3 })
  })
})

describe('buildFlowGraph', () => {
  it('collapses repeated tool invocations into one node with a count', () => {
    const { nodes } = buildFlowGraph(spans)
    const calc = nodes.find((n) => n.id === 'tool|calculate')
    expect(calc).toBeDefined()
    expect(calc!.count).toBe(5)
    expect(calc!.errorCount).toBe(1)
  })

  it('keeps distinct tools as distinct nodes', () => {
    const { nodes } = buildFlowGraph(spans)
    expect(nodes.find((n) => n.id === 'tool|formatCurrency')?.count).toBe(1)
    expect(nodes.find((n) => n.id === 'tool|compare')?.count).toBe(1)
  })

  it('surfaces plain functions alongside tools', () => {
    const { nodes } = buildFlowGraph(spans)
    expect(nodes.find((n) => n.id === 'function|loadPortfolio')).toBeDefined()
    expect(nodes.find((n) => n.id === 'function|validateScenario')).toBeDefined()
  })

  it('adds start/end bookends and wires roots/leaves to them', () => {
    const { nodes, edges } = buildFlowGraph(spans)
    expect(nodes.find((n) => n.id === START_ID)).toBeDefined()
    expect(nodes.find((n) => n.id === END_ID)).toBeDefined()
    expect(edges.some((e) => e.source === START_ID)).toBe(true)
    expect(edges.some((e) => e.target === END_ID)).toBe(true)
  })

  it('captures a representative IO sample per node', () => {
    const { nodes } = buildFlowGraph(spans)
    const calc = nodes.find((n) => n.id === 'tool|calculate')!
    expect(calc.sample.input).toMatchObject({ expression: expect.any(String) })
  })

  it('omits bookends when disabled', () => {
    const { nodes } = buildFlowGraph(spans, { bookends: false })
    expect(nodes.find((n) => n.id === START_ID)).toBeUndefined()
  })

  it('sums per-span LLM metrics onto the collapsed node', () => {
    const metricsBySpanId = new Map([
      ['5000000000000001', { inputTokens: 10, outputTokens: 1, costUsd: 0.001 }],
      ['5000000000000002', { inputTokens: 20, outputTokens: 2, costUsd: 0.002 }],
    ])
    const { nodes } = buildFlowGraph(spans, { metricsBySpanId })
    // Both belong to the collapsed `calculate` node.
    const calc = nodes.find((n) => n.id === 'tool|calculate')!
    expect(calc.metrics).toEqual({
      inputTokens: 30,
      outputTokens: 3,
      costUsd: 0.003,
    })
  })

  it('leaves metrics undefined for nodes with no supplied metrics', () => {
    const { nodes } = buildFlowGraph(spans)
    expect(nodes.find((n) => n.id === 'tool|calculate')!.metrics).toBeUndefined()
  })
})

describe('sumFlowMetrics', () => {
  it('totals tokens and cost across nodes, ignoring nodes without metrics', () => {
    const metricsBySpanId = new Map([
      ['5000000000000001', { inputTokens: 10, outputTokens: 1, costUsd: 0.001 }],
      ['5000000000000007', { outputTokens: 5 }],
    ])
    const { nodes } = buildFlowGraph(spans, { metricsBySpanId })
    expect(sumFlowMetrics(nodes)).toEqual({
      inputTokens: 10,
      outputTokens: 6,
      costUsd: 0.001,
    })
  })

  it('returns an empty object when nothing is priced', () => {
    expect(sumFlowMetrics(buildFlowGraph(spans).nodes)).toEqual({})
  })
})

describe('layoutFlow', () => {
  it('positions every node with non-negative coordinates and a size', () => {
    const layout = layoutFlow(buildFlowGraph(spans))
    expect(layout.nodes.length).toBeGreaterThan(0)
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.width).toBeGreaterThan(0)
    }
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('puts __start__ above __end__', () => {
    const layout = layoutFlow(buildFlowGraph(spans))
    const start = layout.nodes.find((n) => n.id === START_ID)!
    const end = layout.nodes.find((n) => n.id === END_ID)!
    expect(start.y).toBeLessThan(end.y)
  })

  it('handles an empty trace', () => {
    expect(layoutFlow(buildFlowGraph([]))).toMatchObject({ nodes: [], edges: [] })
  })
})
