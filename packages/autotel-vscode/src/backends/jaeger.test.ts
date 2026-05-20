import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { jaegerAdapter } from './jaeger'
import type { QueryAdapterContext } from './types'

const ctx = (over: Partial<QueryAdapterContext> = {}): QueryAdapterContext => ({
  baseUrl: 'http://localhost:16686',
  secrets: { get: async () => undefined },
  abortSignal: new AbortController().signal,
  ...over,
})

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('jaegerAdapter', () => {
  it('lists services from /api/services', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: ['svc-a', 'svc-b'] }),
    }) as unknown as typeof fetch
    const services = await jaegerAdapter.listServices(ctx())
    expect(services).toEqual(['svc-a', 'svc-b'])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:16686/api/services',
      expect.any(Object),
    )
  })

  it('translates a Jaeger trace into our SpanData shape (μs → ns, refs → parent)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            traceID: 'abc',
            spans: [
              {
                traceID: 'abc',
                spanID: 'root',
                operationName: 'GET /api',
                startTime: 1_000_000, // 1 second epoch
                duration: 50_000, // 50ms
                tags: [
                  { key: 'http.method', type: 'string', value: 'GET' },
                  { key: 'code.filepath', type: 'string', value: '/src/api.ts' },
                  { key: 'code.lineno', type: 'int64', value: 42 },
                ],
                processID: 'p1',
                references: [],
              },
              {
                traceID: 'abc',
                spanID: 'child',
                operationName: 'db.query',
                startTime: 1_010_000,
                duration: 30_000,
                tags: [{ key: 'error', type: 'bool', value: true }],
                processID: 'p1',
                references: [{ refType: 'CHILD_OF', spanID: 'root' }],
              },
            ],
            processes: { p1: { serviceName: 'demo' } },
          },
        ],
      }),
    }) as unknown as typeof fetch

    const traces = await jaegerAdapter.searchTraces(ctx(), { service: 'demo' })
    expect(traces).toHaveLength(1)
    const t = traces[0]
    expect(t.service).toBe('demo')
    expect(t.spans).toHaveLength(2)

    const root = t.spans.find((s) => s.name === 'GET /api')!
    expect(root.startTime).toBe(1_000_000_000) // μs → ns
    expect(root.endTime).toBe(1_050_000_000)
    expect(root.duration).toBe(50_000_000)
    expect(root.attributes['http.method']).toBe('GET')

    const child = t.spans.find((s) => s.name === 'db.query')!
    expect(child.parentSpanId).toBe('root')
    expect(child.status.code).toBe('ERROR')

    // Trace status is ERROR because at least one span errored.
    expect(t.status).toBe('ERROR')
  })

  it('ping returns false when the backend is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    expect(await jaegerAdapter.ping(ctx())).toBe(false)
  })
})
