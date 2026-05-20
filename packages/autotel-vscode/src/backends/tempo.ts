import type { TraceData } from 'autotel-devtools/server'
import type { QueryAdapter, QueryAdapterContext, TraceQuery } from './types'
import { credentialKey, registerAdapter } from './types'

// Grafana Tempo query API (HTTP):
//   GET /api/search?tags=service.name=X&limit=N
//   GET /api/traces/{id}
//
// Auth: Bearer token in `Authorization` header when querying Grafana Cloud Tempo.
// Tempo's response shape uses OTLP-flavored JSON for individual traces but a
// lighter "trace meta" shape for search results.

interface TempoSearchMeta {
  traceID: string
  rootServiceName?: string
  rootTraceName?: string
  startTimeUnixNano?: string
  durationMs?: number
}

interface TempoSearchResponse {
  traces?: TempoSearchMeta[]
}

interface TempoBatchSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name?: string
  kind?: number
  startTimeUnixNano?: string
  endTimeUnixNano?: string
  attributes?: Array<{ key: string; value: Record<string, unknown> }>
  status?: { code?: number; message?: string }
  events?: Array<{ name?: string; timeUnixNano?: string; attributes?: Array<{ key: string; value: Record<string, unknown> }> }>
}

interface TempoOtlpTrace {
  batches?: Array<{
    resource?: { attributes?: Array<{ key: string; value: Record<string, unknown> }> }
    scopeSpans?: Array<{ spans?: TempoBatchSpan[] }>
    // legacy "instrumentationLibrarySpans"
    instrumentationLibrarySpans?: Array<{ spans?: TempoBatchSpan[] }>
  }>
}

const KIND_NAMES = ['INTERNAL', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'] as const

function unwrapOtelValue(v: Record<string, unknown> | undefined): unknown {
  if (!v) return undefined
  if ('stringValue' in v) return v.stringValue
  if ('intValue' in v) return Number(v.intValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('boolValue' in v) return v.boolValue
  if ('arrayValue' in v) {
    const arr = (v.arrayValue as { values?: Array<Record<string, unknown>> }).values
    return arr?.map((x) => unwrapOtelValue(x))
  }
  if ('kvlistValue' in v) {
    const kv = (v.kvlistValue as { values?: Array<{ key: string; value: Record<string, unknown> }> }).values
    const out: Record<string, unknown> = {}
    for (const item of kv ?? []) out[item.key] = unwrapOtelValue(item.value)
    return out
  }
  return undefined
}

function flattenAttrs(attrs: Array<{ key: string; value: Record<string, unknown> }> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const a of attrs ?? []) out[a.key] = unwrapOtelValue(a.value)
  return out
}

function nanoToNumber(ns: string | undefined): number {
  return ns ? Number(ns) : 0
}

function tempoTraceToTraceData(otlp: TempoOtlpTrace, fallbackId: string): TraceData {
  const allSpans: TraceData['spans'] = []
  let service = 'unknown'
  for (const batch of otlp.batches ?? []) {
    const resAttrs = flattenAttrs(batch.resource?.attributes)
    if (typeof resAttrs['service.name'] === 'string') service = resAttrs['service.name'] as string
    const scopes = batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? []
    for (const scope of scopes) {
      for (const s of scope.spans ?? []) {
        const startNs = nanoToNumber(s.startTimeUnixNano)
        const endNs = nanoToNumber(s.endTimeUnixNano)
        allSpans.push({
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId,
          name: s.name ?? '',
          kind: (KIND_NAMES[s.kind ?? 0] ?? 'INTERNAL') as TraceData['spans'][number]['kind'],
          startTime: startNs,
          endTime: endNs,
          duration: endNs - startNs,
          attributes: flattenAttrs(s.attributes),
          status: {
            code: s.status?.code === 2 ? 'ERROR' : s.status?.code === 1 ? 'OK' : 'UNSET',
            message: s.status?.message,
          },
          events: s.events?.map((e) => ({
            name: e.name ?? '',
            timestamp: nanoToNumber(e.timeUnixNano),
            attributes: flattenAttrs(e.attributes),
          })),
        })
      }
    }
  }
  const root = allSpans.find((s) => !s.parentSpanId) ?? allSpans[0]
  const startTime = allSpans.length > 0 ? Math.min(...allSpans.map((s) => s.startTime)) : 0
  const endTime = allSpans.length > 0 ? Math.max(...allSpans.map((s) => s.endTime)) : 0
  return {
    traceId: root?.traceId ?? fallbackId,
    correlationId: root?.traceId ?? fallbackId,
    rootSpan: root,
    spans: allSpans,
    startTime,
    endTime,
    duration: endTime - startTime,
    status: allSpans.some((s) => s.status.code === 'ERROR') ? 'ERROR' : 'OK',
    service,
  }
}

async function authedFetch<T>(ctx: QueryAdapterContext, path: string): Promise<T> {
  const url = new URL(path, ctx.baseUrl).toString()
  const token = await ctx.secrets.get(credentialKey('tempo'))
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { signal: ctx.abortSignal, headers })
  if (!res.ok) throw new Error(`Tempo ${res.status}: ${res.statusText}`)
  return (await res.json()) as T
}

export const tempoAdapter: QueryAdapter = {
  id: 'tempo',
  label: 'Grafana Tempo',

  async ping(ctx) {
    try {
      // Tempo health endpoint is /ready.
      const url = new URL('/ready', ctx.baseUrl).toString()
      const res = await fetch(url, { signal: ctx.abortSignal })
      return res.ok
    } catch {
      return false
    }
  },

  async listServices(ctx) {
    // Tempo exposes service names via /api/search/tag/service.name/values.
    const body = await authedFetch<{ tagValues?: string[] }>(
      ctx,
      '/api/search/tag/service.name/values',
    )
    return body.tagValues ?? []
  },

  async searchTraces(ctx, query: TraceQuery): Promise<TraceData[]> {
    const params = new URLSearchParams()
    if (query.service) params.set('tags', `service.name=${query.service}`)
    params.set('limit', String(query.limit ?? 100))
    if (query.startMs) params.set('start', String(Math.floor(query.startMs / 1000)))
    if (query.endMs) params.set('end', String(Math.floor(query.endMs / 1000)))
    const search = await authedFetch<TempoSearchResponse>(ctx, `/api/search?${params}`)
    const traceIds = (search.traces ?? []).map((t) => t.traceID).slice(0, query.limit ?? 100)
    const fetched: TraceData[] = []
    for (const id of traceIds) {
      try {
        const trace = await this.getTrace(ctx, id)
        if (trace) fetched.push(trace)
      } catch {
        // Skip individual fetch errors so partial results still surface.
      }
    }
    return fetched
  },

  async getTrace(ctx, traceId) {
    const body = await authedFetch<TempoOtlpTrace>(ctx, `/api/traces/${encodeURIComponent(traceId)}`)
    if (!body.batches || body.batches.length === 0) return undefined
    return tempoTraceToTraceData(body, traceId)
  },
}

registerAdapter(tempoAdapter)
