import type { TraceData } from 'autotel-devtools/server'
import type { QueryAdapter, QueryAdapterContext, TraceQuery } from './types'
import { credentialKey, registerAdapter } from './types'

// Datadog APM query API (HTTPS):
//   POST /api/v2/spans/events/search   — main search endpoint
//   GET  /api/v2/services              — list APM services
//
// Auth: TWO headers — `DD-API-KEY` (the org API key) and
// `DD-APPLICATION-KEY` (a personal application key). We store them as a
// single composite secret `<api-key>:<app-key>` to keep the credentialKey()
// contract one-key-per-backend.
//
// Region: Datadog's base URL varies (US1, US3, US5, EU1, AP1). The user
// configures it via `autotel.backend.url` (e.g. https://api.datadoghq.com).

interface DatadogSpanAttrs {
  service?: string
  resource_name?: string
  start?: string
  duration?: number // nanoseconds
  trace_id?: string
  span_id?: string
  parent_id?: string
  type?: string
  status?: string
  tags?: Record<string, string>
  custom?: Record<string, unknown>
}

interface DatadogSpan {
  id?: string
  type?: string
  attributes?: DatadogSpanAttrs
}

interface DatadogSearchResponse {
  data?: DatadogSpan[]
  meta?: { request_id?: string }
}

interface DatadogServicesResponse {
  data?: Array<{ id?: string; attributes?: { name?: string } }>
}

async function splitCredential(token: string | undefined): Promise<{ api: string; app: string } | undefined> {
  if (!token) return undefined
  const colon = token.indexOf(':')
  if (colon <= 0 || colon === token.length - 1) return undefined
  return { api: token.slice(0, colon), app: token.slice(colon + 1) }
}

async function ddFetch<T>(
  ctx: QueryAdapterContext,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const composite = await ctx.secrets.get(credentialKey('datadog'))
  const creds = await splitCredential(composite)
  if (!creds) {
    throw new Error(
      'Datadog credentials missing or malformed. Set them as "<api-key>:<app-key>" via Autotel: Set Remote Backend Credential.',
    )
  }
  const url = new URL(path, ctx.baseUrl).toString()
  const headers: Record<string, string> = {
    'DD-API-KEY': creds.api,
    'DD-APPLICATION-KEY': creds.app,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method,
    headers,
    signal: ctx.abortSignal,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Datadog ${res.status}: ${res.statusText}`)
  return (await res.json()) as T
}

// Translate a flat list of Datadog spans (search returns spans, not traces)
// into TraceData[] grouped by trace_id.
function groupDatadogSpans(spans: DatadogSpan[]): TraceData[] {
  const byTraceId = new Map<string, TraceData['spans']>()
  for (const s of spans) {
    const a = s.attributes ?? {}
    const traceId = a.trace_id ?? s.id
    if (!traceId) continue
    const startNs = a.start ? Number(a.start) : 0
    const durNs = a.duration ?? 0
    const span: TraceData['spans'][number] = {
      traceId,
      spanId: a.span_id ?? s.id ?? `synth-${Math.random()}`,
      parentSpanId: a.parent_id,
      name: a.resource_name ?? 'span',
      kind: 'INTERNAL',
      startTime: startNs,
      endTime: startNs + durNs,
      duration: durNs,
      attributes: { ...(a.tags ?? {}), ...(a.custom ?? {}), 'datadog.service': a.service, 'datadog.type': a.type },
      status: { code: a.status === 'error' ? 'ERROR' : 'OK' },
    }
    const arr = byTraceId.get(traceId) ?? []
    arr.push(span)
    byTraceId.set(traceId, arr)
  }
  const out: TraceData[] = []
  for (const [traceId, traceSpans] of byTraceId) {
    const root = traceSpans.find((s) => !s.parentSpanId) ?? traceSpans[0]
    const startTime = Math.min(...traceSpans.map((s) => s.startTime))
    const endTime = Math.max(...traceSpans.map((s) => s.endTime))
    out.push({
      traceId,
      correlationId: traceId,
      rootSpan: root,
      spans: traceSpans,
      startTime,
      endTime,
      duration: endTime - startTime,
      status: traceSpans.some((s) => s.status.code === 'ERROR') ? 'ERROR' : 'OK',
      service: String(root?.attributes?.['datadog.service'] ?? 'unknown'),
    })
  }
  return out
}

export const datadogAdapter: QueryAdapter = {
  id: 'datadog',
  label: 'Datadog APM',

  async ping(ctx) {
    try {
      await ddFetch<DatadogServicesResponse>(ctx, 'GET', '/api/v2/services')
      return true
    } catch {
      return false
    }
  },

  async listServices(ctx) {
    const body = await ddFetch<DatadogServicesResponse>(ctx, 'GET', '/api/v2/services')
    return (body.data ?? [])
      .map((s) => s.attributes?.name ?? s.id ?? '')
      .filter((n) => n.length > 0)
  },

  async searchTraces(ctx, query: TraceQuery): Promise<TraceData[]> {
    const end = query.endMs ?? Date.now()
    const start = query.startMs ?? end - 60 * 60 * 1000
    const filter = [query.service ? `service:${query.service}` : '', query.errorsOnly ? 'status:error' : '']
      .filter((p) => p.length > 0)
      .join(' ')
    const body = {
      data: {
        type: 'search_request',
        attributes: {
          filter: { query: filter || '*', from: new Date(start).toISOString(), to: new Date(end).toISOString() },
          options: { timezone: 'UTC' },
          page: { limit: query.limit ?? 50 },
          sort: '-timestamp',
        },
      },
    }
    const result = await ddFetch<DatadogSearchResponse>(ctx, 'POST', '/api/v2/spans/events/search', body)
    return groupDatadogSpans(result.data ?? [])
  },

  async getTrace(ctx, traceId) {
    // Filter the search by trace_id. Datadog also has /api/v2/traces/{id} on
    // some tiers — use the broadly-available search endpoint for portability.
    const body = {
      data: {
        type: 'search_request',
        attributes: {
          filter: { query: `trace_id:${traceId}` },
          page: { limit: 1000 },
        },
      },
    }
    const result = await ddFetch<DatadogSearchResponse>(ctx, 'POST', '/api/v2/spans/events/search', body)
    const grouped = groupDatadogSpans(result.data ?? [])
    return grouped[0]
  },
}

registerAdapter(datadogAdapter)
