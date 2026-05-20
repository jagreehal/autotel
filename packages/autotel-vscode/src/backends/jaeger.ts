import type { TraceData } from 'autotel-devtools/server'
import type { QueryAdapter, QueryAdapterContext, TraceQuery } from './types'
import { registerAdapter } from './types'

// Minimal Jaeger query API adapter. Backend reference:
//   GET /api/services
//   GET /api/traces?service=X&limit=N&start=μs&end=μs
//   GET /api/traces/{id}
//
// Jaeger returns its own JSON shape (not OTLP). We translate the spans
// into our internal SpanData form (the same one the local OTLP receiver
// produces) so the rest of the extension treats them identically.

interface JaegerSpan {
  traceID: string
  spanID: string
  references?: Array<{ refType: 'CHILD_OF' | 'FOLLOWS_FROM'; spanID: string }>
  operationName: string
  startTime: number // microseconds since epoch
  duration: number // microseconds
  tags?: Array<{ key: string; type: string; value: unknown }>
  logs?: Array<{ timestamp: number; fields: Array<{ key: string; value: unknown }> }>
  processID: string
}

interface JaegerTrace {
  traceID: string
  spans: JaegerSpan[]
  processes: Record<string, { serviceName: string; tags?: Array<{ key: string; value: unknown }> }>
}

function tagsToAttrs(tags: JaegerSpan['tags']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const t of tags ?? []) out[t.key] = t.value
  return out
}

function microToNano(us: number): number {
  return us * 1000
}

function statusFromTags(tags: JaegerSpan['tags']): TraceData['rootSpan']['status'] {
  const errorTag = tags?.find((t) => t.key === 'error')
  if (errorTag && (errorTag.value === true || errorTag.value === 'true')) {
    const msg = tags?.find((t) => t.key === 'otel.status_description')?.value
    return { code: 'ERROR', message: typeof msg === 'string' ? msg : undefined }
  }
  return { code: 'OK' }
}

function jaegerTraceToTraceData(jt: JaegerTrace): TraceData {
  const spans = jt.spans.map((js) => {
    const parentRef = js.references?.find((r) => r.refType === 'CHILD_OF')
    return {
      traceId: js.traceID,
      spanId: js.spanID,
      parentSpanId: parentRef?.spanID,
      name: js.operationName,
      kind: 'INTERNAL' as const,
      startTime: microToNano(js.startTime),
      endTime: microToNano(js.startTime + js.duration),
      duration: microToNano(js.duration),
      attributes: tagsToAttrs(js.tags),
      status: statusFromTags(js.tags),
      events: js.logs?.map((l) => ({
        name: 'log',
        timestamp: microToNano(l.timestamp),
        attributes: Object.fromEntries(l.fields.map((f) => [f.key, f.value])),
      })),
    }
  })
  const rootSpan = spans.find((s) => !s.parentSpanId) ?? spans[0]
  const firstProcess = Object.values(jt.processes)[0]
  const startTime = Math.min(...spans.map((s) => s.startTime))
  const endTime = Math.max(...spans.map((s) => s.endTime))
  return {
    traceId: jt.traceID,
    correlationId: jt.traceID,
    rootSpan,
    spans,
    startTime,
    endTime,
    duration: endTime - startTime,
    status: spans.some((s) => s.status.code === 'ERROR') ? 'ERROR' : 'OK',
    service: firstProcess?.serviceName ?? 'unknown',
  }
}

async function fetchJSON<T>(ctx: QueryAdapterContext, path: string): Promise<T> {
  const url = new URL(path, ctx.baseUrl).toString()
  const timeoutId = ctx.timeoutMs
    ? setTimeout(() => {
        ;(ctx.abortSignal as unknown as { abort?: () => void }).abort?.()
      }, ctx.timeoutMs)
    : undefined
  try {
    const res = await fetch(url, { signal: ctx.abortSignal })
    if (!res.ok) throw new Error(`Jaeger ${res.status}: ${res.statusText}`)
    return (await res.json()) as T
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export const jaegerAdapter: QueryAdapter = {
  id: 'jaeger',
  label: 'Jaeger',

  async ping(ctx) {
    try {
      await fetchJSON<{ data: string[] }>(ctx, '/api/services')
      return true
    } catch {
      return false
    }
  },

  async listServices(ctx) {
    const body = await fetchJSON<{ data: string[] }>(ctx, '/api/services')
    return body.data
  },

  async searchTraces(ctx, query: TraceQuery): Promise<TraceData[]> {
    const params = new URLSearchParams()
    if (query.service) params.set('service', query.service)
    params.set('limit', String(query.limit ?? 100))
    if (query.startMs) params.set('start', String(query.startMs * 1000))
    if (query.endMs) params.set('end', String(query.endMs * 1000))
    if (query.errorsOnly) params.set('tags', '{"error":"true"}')
    const body = await fetchJSON<{ data: JaegerTrace[] }>(ctx, `/api/traces?${params}`)
    return body.data.map(jaegerTraceToTraceData)
  },

  async getTrace(ctx, traceId) {
    const body = await fetchJSON<{ data: JaegerTrace[] }>(ctx, `/api/traces/${encodeURIComponent(traceId)}`)
    return body.data[0] ? jaegerTraceToTraceData(body.data[0]) : undefined
  },
}

// Stubs for the rest — interface defined, implementations pending.
// Each is a self-contained file in this folder so it's clear what's done.
registerAdapter(jaegerAdapter)
