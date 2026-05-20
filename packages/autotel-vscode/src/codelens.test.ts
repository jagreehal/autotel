import { describe, it, expect, vi } from 'vitest'
import type { TraceData } from 'autotel-devtools/server'

// codelens.ts top-level-imports `vscode` (used by the provider classes).
// For these pure-logic tests we mock vscode with the minimum surface so the
// module loads.
vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose: () => {} })
    fire() {}
    dispose() {}
  },
  CodeLens: class {
    constructor(public range: unknown, public command?: unknown) {}
  },
  Range: class {
    constructor(...args: unknown[]) {
      void args
    }
  },
  MarkdownString: class {
    appendMarkdown() {
      return this
    }
    isTrusted = true
  },
  Hover: class {
    constructor(public contents: unknown) {}
  },
}))

const { aggregateBySource, formatStats } = await import('./codelens')

function span(over: Partial<TraceData['spans'][number]> = {}): TraceData['spans'][number] {
  return {
    traceId: 't',
    spanId: 's' + Math.random(),
    name: 'fn',
    kind: 'INTERNAL',
    startTime: 0,
    endTime: 0,
    duration: 1_000_000, // 1ms in ns
    attributes: {},
    status: { code: 'OK' },
    ...over,
  } as TraceData['spans'][number]
}

function trace(spans: TraceData['spans']): TraceData {
  return {
    traceId: 't',
    correlationId: 't',
    rootSpan: spans[0],
    spans,
    startTime: 0,
    endTime: 0,
    duration: 0,
    status: 'OK',
    service: 'svc',
  } as TraceData
}

describe('aggregateBySource', () => {
  it('groups spans by code.filepath:code.lineno', () => {
    const t = trace([
      span({ attributes: { 'code.filepath': '/a/b.ts', 'code.lineno': 10, 'code.function': 'foo' } }),
      span({ attributes: { 'code.filepath': '/a/b.ts', 'code.lineno': 10, 'code.function': 'foo' } }),
      span({ attributes: { 'code.filepath': '/a/c.ts', 'code.lineno': 5 } }),
      span({ attributes: { /* no code attrs — must be skipped */ } }),
    ])
    const result = aggregateBySource([t])
    expect(result.size).toBe(2)
    const fooStats = result.get('/a/b.ts:10')
    expect(fooStats?.count).toBe(2)
    expect(fooStats?.functionName).toBe('foo')
  })

  it('counts errors separately', () => {
    const t = trace([
      span({ attributes: { 'code.filepath': '/x.ts', 'code.lineno': 1 }, status: { code: 'OK' } }),
      span({ attributes: { 'code.filepath': '/x.ts', 'code.lineno': 1 }, status: { code: 'ERROR' } }),
      span({ attributes: { 'code.filepath': '/x.ts', 'code.lineno': 1 }, status: { code: 'ERROR' } }),
    ])
    const stats = aggregateBySource([t]).get('/x.ts:1')!
    expect(stats.count).toBe(3)
    expect(stats.errorCount).toBe(2)
  })
})

describe('formatStats', () => {
  it('renders count + p50 + p95 + error pct when there are errors', () => {
    const stats = {
      filepath: '/x.ts',
      lineno: 1,
      count: 10,
      errorCount: 1,
      durations: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
      spanIds: [],
    }
    const out = formatStats(stats)
    expect(out).toContain('10 traces')
    expect(out).toContain('p50')
    expect(out).toContain('p95')
    expect(out).toContain('errors')
  })

  it('omits error percentage at zero', () => {
    const stats = {
      filepath: '/x.ts',
      lineno: 1,
      count: 1,
      errorCount: 0,
      durations: [5],
      spanIds: [],
    }
    expect(formatStats(stats)).not.toContain('errors')
  })
})
