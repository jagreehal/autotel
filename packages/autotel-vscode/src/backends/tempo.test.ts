import { describe, it, expect, vi, afterEach } from 'vitest'
import { tempoAdapter } from './tempo'
import type { QueryAdapterContext } from './types'

const ctx = (over: Partial<QueryAdapterContext> = {}): QueryAdapterContext => ({
  baseUrl: 'http://tempo:3200',
  secrets: { get: async () => undefined },
  abortSignal: new AbortController().signal,
  ...over,
})

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('tempoAdapter', () => {
  it('attaches Authorization header when a token is in secrets', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tagValues: ['svc-1', 'svc-2'] }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const c = ctx({ secrets: { get: async () => 'top-secret' } })
    const services = await tempoAdapter.listServices(c)
    expect(services).toEqual(['svc-1', 'svc-2'])
    const [, init] = fetchSpy.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer top-secret' })
  })

  it('parses Tempo OTLP-shaped trace into our SpanData', async () => {
    const fetchMock = vi.fn()
    // First call: search by service.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ traces: [{ traceID: 'aaaa' }] }),
    })
    // Second call: GET /api/traces/aaaa
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        batches: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'demo' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'aaaa',
                    spanId: 'bbbb',
                    name: 'GET /api',
                    kind: 2,
                    startTimeUnixNano: '1000000000',
                    endTimeUnixNano: '1050000000',
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'GET' } },
                      { key: 'http.status_code', value: { intValue: '200' } },
                    ],
                    status: { code: 1 },
                  },
                ],
              },
            ],
          },
        ],
      }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await tempoAdapter.searchTraces(ctx(), { service: 'demo' })
    expect(result).toHaveLength(1)
    expect(result[0].service).toBe('demo')
    expect(result[0].spans[0]).toMatchObject({
      spanId: 'bbbb',
      name: 'GET /api',
      kind: 'SERVER',
      duration: 50_000_000,
      attributes: { 'http.method': 'GET', 'http.status_code': 200 },
    })
  })
})
