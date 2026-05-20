import { describe, it, expect, vi, afterEach } from 'vitest'
import { honeycombAdapter } from './honeycomb'
import type { QueryAdapterContext } from './types'

const ctx = (over: Partial<QueryAdapterContext> = {}): QueryAdapterContext => ({
  baseUrl: 'https://api.honeycomb.io',
  dataset: 'web',
  secrets: { get: async () => 'hc-api-key' },
  abortSignal: new AbortController().signal,
  ...over,
})

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('honeycombAdapter', () => {
  it('refuses to call without an API key', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
    await expect(
      honeycombAdapter.listServices(ctx({ secrets: { get: async () => undefined } })),
    ).rejects.toThrow(/API key missing/)
  })

  it('sends X-Honeycomb-Team header and lists datasets as services', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ name: 'web' }, { name: 'api' }],
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const services = await honeycombAdapter.listServices(ctx())
    expect(services).toEqual(['web', 'api'])
    const [, init] = fetchSpy.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ 'X-Honeycomb-Team': 'hc-api-key' })
  })

  it('builds a query and translates events into TraceData', async () => {
    const fetchMock = vi.fn()
    // POST /1/queries/web → { id }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'q-1' }),
    })
    // POST /1/query_results/web/q-1 → events
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          events: [
            {
              Timestamp: '2026-05-20T12:00:00Z',
              data: {
                'trace.trace_id': 'tr1',
                'trace.span_id': 'sp1',
                name: 'GET /',
                'service.name': 'web',
                duration_ms: 25,
                error: false,
              },
            },
          ],
        },
        complete: true,
      }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await honeycombAdapter.searchTraces(ctx(), { limit: 10 })
    expect(result).toHaveLength(1)
    expect(result[0].traceId).toBe('tr1')
    expect(result[0].service).toBe('web')
    expect(result[0].spans[0].duration).toBe(25_000_000)
  })
})
