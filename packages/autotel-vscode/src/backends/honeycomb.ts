import type { TraceData } from 'autotel-devtools/server'
import type { QueryAdapter, QueryAdapterContext, TraceQuery } from './types'
import { credentialKey, registerAdapter } from './types'

// Honeycomb query API (HTTPS):
//   POST /1/queries/{dataset}     (create a query)
//   POST /1/query_results/{dataset}/{query_id}  (poll for results)
//   GET  /1/datasets              (list datasets)
//
// Auth: X-Honeycomb-Team header with API key.
// ctx.dataset must be set (Honeycomb scopes everything to a dataset).
//
// NOTE: This adapter is a foundation, not full-fidelity. Honeycomb's query
// model is column-oriented (events, not traces). We map "find recent traces
// by service" by querying for distinct `trace.trace_id` values + a single
// span per trace as a representative summary. Fetching the full trace shape
// requires a follow-up trace fetch via the /1/traces endpoint (not yet
// implemented here — see TODO below).

interface HoneycombEvent {
  Timestamp?: string
  data?: Record<string, unknown>
}

interface HoneycombQueryResult {
  data?: { events?: HoneycombEvent[] }
  complete?: boolean
}

interface HoneycombDataset {
  name: string
  slug?: string
}

async function honeycombFetch<T>(
  ctx: QueryAdapterContext,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await ctx.secrets.get(credentialKey('honeycomb'))
  if (!token) throw new Error('Honeycomb API key missing. Run "Autotel: Set Remote Backend Credential" first.')
  const url = new URL(path, ctx.baseUrl).toString()
  const headers: Record<string, string> = {
    'X-Honeycomb-Team': token,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method,
    headers,
    signal: ctx.abortSignal,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const errBody = await res.json()
      if (errBody && typeof errBody === 'object' && 'error' in errBody) {
        detail = String((errBody as { error: unknown }).error)
      }
    } catch {
      // ignore
    }
    throw new Error(`Honeycomb ${res.status}: ${detail}`)
  }
  return (await res.json()) as T
}

function eventToTrace(event: HoneycombEvent, dataset: string): TraceData {
  const d = event.data ?? {}
  const traceId = String(d['trace.trace_id'] ?? d['trace_id'] ?? `synth-${Math.random()}`)
  const spanId = String(d['trace.span_id'] ?? d['span_id'] ?? traceId)
  const startMs = event.Timestamp ? new Date(event.Timestamp).getTime() : 0
  const durMs = typeof d['duration_ms'] === 'number' ? (d['duration_ms'] as number) : 0
  // Compute duration in ns directly from ms to avoid float drift across the
  // subtract of two large values.
  const duration = durMs * 1_000_000
  const start = startMs * 1_000_000
  const end = start + duration
  const status = d['error'] === true || d['error'] === 'true' ? ('ERROR' as const) : ('OK' as const)
  const span: TraceData['spans'][number] = {
    traceId,
    spanId,
    parentSpanId: typeof d['trace.parent_id'] === 'string' ? (d['trace.parent_id'] as string) : undefined,
    name: String(d['name'] ?? 'event'),
    kind: 'INTERNAL',
    startTime: start,
    endTime: end,
    duration,
    attributes: d as Record<string, unknown>,
    status: { code: status },
  }
  return {
    traceId,
    correlationId: traceId,
    rootSpan: span,
    spans: [span],
    startTime: start,
    endTime: end,
    duration: end - start,
    status,
    service: String(d['service.name'] ?? dataset),
  }
}

export const honeycombAdapter: QueryAdapter = {
  id: 'honeycomb',
  label: 'Honeycomb',

  async ping(ctx) {
    try {
      await honeycombFetch<HoneycombDataset[]>(ctx, 'GET', '/1/datasets')
      return true
    } catch {
      return false
    }
  },

  async listServices(ctx) {
    // Datasets ≈ services in many Honeycomb setups.
    const datasets = await honeycombFetch<HoneycombDataset[]>(ctx, 'GET', '/1/datasets')
    return datasets.map((d) => d.name)
  },

  async searchTraces(ctx, query: TraceQuery): Promise<TraceData[]> {
    const dataset = ctx.dataset ?? query.service
    if (!dataset) throw new Error('Honeycomb requires a dataset. Set autotel.backend.dataset.')
    const now = Date.now()
    const end = query.endMs ?? now
    const start = query.startMs ?? now - 60 * 60 * 1000
    const queryBody = {
      time_range: Math.max(60, Math.floor((end - start) / 1000)),
      end_time: Math.floor(end / 1000),
      breakdowns: ['trace.trace_id'],
      calculations: [{ op: 'COUNT' }, { op: 'P95', column: 'duration_ms' }],
      orders: [{ column: 'COUNT', order: 'descending' }],
      limit: query.limit ?? 50,
      filters: query.errorsOnly ? [{ column: 'error', op: 'exists' }] : [],
    }
    // Two-step: create query, then fetch results. Implementation defers the
    // poll loop — Honeycomb returns results within a single round-trip for
    // small windows but may need polling for large ones. TODO: poll loop.
    const created = await honeycombFetch<{ id: string }>(ctx, 'POST', `/1/queries/${dataset}`, queryBody)
    const results = await honeycombFetch<HoneycombQueryResult>(
      ctx,
      'POST',
      `/1/query_results/${dataset}/${created.id}`,
    )
    const events = results.data?.events ?? []
    return events.map((e) => eventToTrace(e, dataset))
  },

  async getTrace(ctx, traceId) {
    // Honeycomb's full-trace fetch endpoint depends on the team's account
    // tier (`/1/traces/{dataset}/{trace_id}` on Pro+ plans). For now return
    // a single-span summary derived from a filtered query.
    const dataset = ctx.dataset
    if (!dataset) return undefined
    const body = {
      time_range: 24 * 60 * 60,
      breakdowns: ['name', 'trace.span_id', 'trace.parent_id', 'service.name'],
      filters: [{ column: 'trace.trace_id', op: '=', value: traceId }],
      limit: 1000,
    }
    const created = await honeycombFetch<{ id: string }>(ctx, 'POST', `/1/queries/${dataset}`, body)
    const results = await honeycombFetch<HoneycombQueryResult>(
      ctx,
      'POST',
      `/1/query_results/${dataset}/${created.id}`,
    )
    const events = results.data?.events ?? []
    if (events.length === 0) return undefined
    // Merge all events into a single TraceData with multiple spans.
    const spans = events.map((e) => eventToTrace(e, dataset).spans[0])
    const root = spans.find((s) => !s.parentSpanId) ?? spans[0]
    const startTime = Math.min(...spans.map((s) => s.startTime))
    const endTime = Math.max(...spans.map((s) => s.endTime))
    return {
      traceId,
      correlationId: traceId,
      rootSpan: root,
      spans,
      startTime,
      endTime,
      duration: endTime - startTime,
      status: spans.some((s) => s.status.code === 'ERROR') ? 'ERROR' : 'OK',
      service: String(events[0]?.data?.['service.name'] ?? dataset),
    }
  },
}

registerAdapter(honeycombAdapter)
