import type { TraceData } from 'autotel-devtools/server'
import type { QueryAdapter, QueryAdapterContext, TraceQuery } from './types'
import { credentialKey, registerAdapter } from './types'

// SigNoz query API (HTTP, ClickHouse-backed):
//   POST /api/v3/query_range   — generic trace+metric query
//   GET  /api/v1/services      — list APM services
//   GET  /api/v1/traces/{id}   — fetch a single trace
//
// Auth: `SIGNOZ-API-KEY` header for SigNoz Cloud; self-hosted instances
// often run unauthenticated on the local network.

interface SignozService {
  serviceName?: string
  p99?: number
  errorRate?: number
  numCalls?: number
}

interface SignozTraceSpan {
  traceID?: string
  spanID?: string
  parentSpanID?: string
  name?: string
  serviceName?: string
  startTime?: number // nanoseconds
  durationNano?: number
  statusCode?: number
  statusMessage?: string
  attributes?: Record<string, unknown>
  events?: Array<{ name?: string; timestamp?: number; attributes?: Record<string, unknown> }>
}

interface SignozTraceResponse {
  data?: SignozTraceSpan[]
}

interface SignozServicesResponse {
  data?: SignozService[]
}

async function signozFetch<T>(
  ctx: QueryAdapterContext,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await ctx.secrets.get(credentialKey('signoz'))
  const url = new URL(path, ctx.baseUrl).toString()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers['SIGNOZ-API-KEY'] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method,
    headers,
    signal: ctx.abortSignal,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`SigNoz ${res.status}: ${res.statusText}`)
  return (await res.json()) as T
}

function signozSpansToTrace(spans: SignozTraceSpan[]): TraceData | undefined {
  if (spans.length === 0) return undefined
  const traceId = spans[0].traceID ?? `synth-${Math.random()}`
  const translated: TraceData['spans'] = spans.map((s) => {
    const startNs = s.startTime ?? 0
    const durNs = s.durationNano ?? 0
    return {
      traceId,
      spanId: s.spanID ?? `synth-${Math.random()}`,
      parentSpanId: s.parentSpanID || undefined,
      name: s.name ?? 'span',
      kind: 'INTERNAL',
      startTime: startNs,
      endTime: startNs + durNs,
      duration: durNs,
      attributes: { ...(s.attributes ?? {}), 'service.name': s.serviceName },
      status: { code: (s.statusCode ?? 0) >= 2 ? 'ERROR' : 'OK', message: s.statusMessage },
      events: s.events?.map((e) => ({
        name: e.name ?? '',
        timestamp: e.timestamp ?? 0,
        attributes: e.attributes,
      })),
    }
  })
  const root = translated.find((s) => !s.parentSpanId) ?? translated[0]
  const startTime = Math.min(...translated.map((s) => s.startTime))
  const endTime = Math.max(...translated.map((s) => s.endTime))
  return {
    traceId,
    correlationId: traceId,
    rootSpan: root,
    spans: translated,
    startTime,
    endTime,
    duration: endTime - startTime,
    status: translated.some((s) => s.status.code === 'ERROR') ? 'ERROR' : 'OK',
    service: String(root?.attributes?.['service.name'] ?? spans[0].serviceName ?? 'unknown'),
  }
}

export const signozAdapter: QueryAdapter = {
  id: 'signoz',
  label: 'SigNoz',

  async ping(ctx) {
    try {
      await signozFetch<SignozServicesResponse>(ctx, 'GET', '/api/v1/services')
      return true
    } catch {
      return false
    }
  },

  async listServices(ctx) {
    const body = await signozFetch<SignozServicesResponse>(ctx, 'GET', '/api/v1/services')
    return (body.data ?? []).map((s) => s.serviceName ?? '').filter((n) => n.length > 0)
  },

  async searchTraces(ctx, query: TraceQuery): Promise<TraceData[]> {
    const end = query.endMs ?? Date.now()
    const start = query.startMs ?? end - 60 * 60 * 1000
    const filterItems: Array<{ key: string; op: string; value: unknown }> = []
    if (query.service) filterItems.push({ key: 'serviceName', op: '=', value: query.service })
    if (query.errorsOnly) filterItems.push({ key: 'hasError', op: '=', value: true })
    const body = {
      start: start * 1_000_000, // SigNoz uses ns
      end: end * 1_000_000,
      compositeQuery: {
        queryType: 'builder',
        panelType: 'trace',
        builderQueries: {
          A: {
            dataSource: 'traces',
            queryName: 'A',
            filters: { op: 'AND', items: filterItems },
            limit: query.limit ?? 50,
            orderBy: [{ columnName: 'timestamp', order: 'desc' }],
          },
        },
      },
    }
    const result = await signozFetch<{ data?: { result?: Array<{ list?: SignozTraceSpan[] }> } }>(
      ctx,
      'POST',
      '/api/v3/query_range',
      body,
    )
    const items = result.data?.result?.[0]?.list ?? []
    // Group flat spans into traces.
    const byTraceId = new Map<string, SignozTraceSpan[]>()
    for (const item of items) {
      const id = item.traceID ?? ''
      if (!id) continue
      const arr = byTraceId.get(id) ?? []
      arr.push(item)
      byTraceId.set(id, arr)
    }
    const out: TraceData[] = []
    for (const [, spans] of byTraceId) {
      const trace = signozSpansToTrace(spans)
      if (trace) out.push(trace)
    }
    return out
  },

  async getTrace(ctx, traceId) {
    const body = await signozFetch<SignozTraceResponse>(
      ctx,
      'GET',
      `/api/v1/traces/${encodeURIComponent(traceId)}`,
    )
    return signozSpansToTrace(body.data ?? [])
  },
}

registerAdapter(signozAdapter)
