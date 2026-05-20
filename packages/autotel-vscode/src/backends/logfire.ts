import type { TraceData } from 'autotel-devtools/server'
import type { QueryAdapter, QueryAdapterContext, TraceQuery } from './types'
import { credentialKey, registerAdapter } from './types'

// Pydantic Logfire query API. Logfire spans live in a ClickHouse-backed
// store accessed via a SQL-like read API at `/v1/query`.
//
// Auth: `Authorization: Bearer <read-token>`. Read tokens are scoped to a
// single project — the project ID is derived from the token itself, so we
// don't require ctx.dataset.
//
// Logfire spans are already gen_ai-conventioned (we already exercise this
// from the workshop captures), so the translation here is minimal: just
// rebuild trace structure from a flat span list.

interface LogfireSpanRow {
  trace_id: string
  span_id: string
  parent_span_id?: string | null
  span_name: string
  start_timestamp: string // ISO
  end_timestamp: string // ISO
  service_name?: string | null
  is_exception?: boolean
  status_code?: string
  status_message?: string | null
  attributes?: Record<string, unknown>
  events?: Array<{ name: string; timestamp: string; attributes?: Record<string, unknown> }>
}

interface LogfireQueryResponse {
  rows?: LogfireSpanRow[]
}

async function logfireFetch<T>(ctx: QueryAdapterContext, sql: string): Promise<T> {
  const token = await ctx.secrets.get(credentialKey('logfire'))
  if (!token) throw new Error('Logfire read token missing. Run "Autotel: Set Remote Backend Credential" first.')
  const url = new URL('/v1/query', ctx.baseUrl).toString()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    signal: ctx.abortSignal,
    body: JSON.stringify({ sql }),
  })
  if (!res.ok) throw new Error(`Logfire ${res.status}: ${res.statusText}`)
  return (await res.json()) as T
}

function isoToNano(iso: string): number {
  // Best-effort; Logfire timestamps have μs precision encoded as ISO with 6
  // fractional digits. JS Date only preserves ms — pull fractional digits
  // manually to keep μs resolution.
  const ms = new Date(iso).getTime()
  const match = iso.match(/\.(\d+)Z?$/)
  const frac = match ? match[1] : ''
  const microsFromFrac = frac.length >= 6 ? Number(frac.slice(0, 6)) : Number(frac.padEnd(6, '0'))
  const usPart = microsFromFrac % 1000 // microseconds beyond the millisecond
  return ms * 1_000_000 + usPart * 1000
}

function rowsToTraces(rows: LogfireSpanRow[]): TraceData[] {
  const byTraceId = new Map<string, TraceData['spans']>()
  for (const r of rows) {
    const startNs = isoToNano(r.start_timestamp)
    const endNs = isoToNano(r.end_timestamp)
    const span: TraceData['spans'][number] = {
      traceId: r.trace_id,
      spanId: r.span_id,
      parentSpanId: r.parent_span_id ?? undefined,
      name: r.span_name,
      kind: 'INTERNAL',
      startTime: startNs,
      endTime: endNs,
      duration: endNs - startNs,
      attributes: r.attributes ?? {},
      status: {
        code: r.is_exception || r.status_code === 'ERROR' ? 'ERROR' : 'OK',
        message: r.status_message ?? undefined,
      },
      events: r.events?.map((e) => ({
        name: e.name,
        timestamp: isoToNano(e.timestamp),
        attributes: e.attributes,
      })),
    }
    const arr = byTraceId.get(r.trace_id) ?? []
    arr.push(span)
    byTraceId.set(r.trace_id, arr)
  }
  const out: TraceData[] = []
  for (const [traceId, spans] of byTraceId) {
    const root = spans.find((s) => !s.parentSpanId) ?? spans[0]
    const startTime = Math.min(...spans.map((s) => s.startTime))
    const endTime = Math.max(...spans.map((s) => s.endTime))
    const service = String(root?.attributes?.['service.name'] ?? rows.find((r) => r.trace_id === traceId)?.service_name ?? 'unknown')
    out.push({
      traceId,
      correlationId: traceId,
      rootSpan: root,
      spans,
      startTime,
      endTime,
      duration: endTime - startTime,
      status: spans.some((s) => s.status.code === 'ERROR') ? 'ERROR' : 'OK',
      service,
    })
  }
  return out
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

export const logfireAdapter: QueryAdapter = {
  id: 'logfire',
  label: 'Pydantic Logfire',

  async ping(ctx) {
    try {
      await logfireFetch<LogfireQueryResponse>(ctx, 'SELECT 1 LIMIT 1')
      return true
    } catch {
      return false
    }
  },

  async listServices(ctx) {
    const body = await logfireFetch<LogfireQueryResponse>(
      ctx,
      "SELECT DISTINCT service_name FROM records WHERE service_name IS NOT NULL LIMIT 200",
    )
    return (body.rows ?? [])
      .map((r) => (r as unknown as { service_name?: string }).service_name ?? '')
      .filter((n) => n.length > 0)
  },

  async searchTraces(ctx, query: TraceQuery): Promise<TraceData[]> {
    const where: string[] = []
    if (query.service) where.push(`service_name = '${escapeSqlString(query.service)}'`)
    if (query.errorsOnly) where.push('is_exception = TRUE')
    if (query.startMs) where.push(`start_timestamp >= toDateTime64(${Math.floor(query.startMs / 1000)}, 3)`)
    if (query.endMs) where.push(`start_timestamp <= toDateTime64(${Math.floor(query.endMs / 1000)}, 3)`)
    const whereClause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
    // Pull the most recent N traces' worth of spans by joining on distinct trace_ids.
    const limit = query.limit ?? 50
    const sql =
      `SELECT trace_id, span_id, parent_span_id, span_name, ` +
      `start_timestamp, end_timestamp, service_name, is_exception, status_code, ` +
      `status_message, attributes, events ` +
      `FROM records${whereClause} ` +
      `ORDER BY start_timestamp DESC ` +
      `LIMIT ${limit * 20}`
    const body = await logfireFetch<LogfireQueryResponse>(ctx, sql)
    const traces = rowsToTraces(body.rows ?? [])
    return traces.slice(0, limit)
  },

  async getTrace(ctx, traceId) {
    const sql =
      `SELECT trace_id, span_id, parent_span_id, span_name, ` +
      `start_timestamp, end_timestamp, service_name, is_exception, status_code, ` +
      `status_message, attributes, events ` +
      `FROM records WHERE trace_id = '${escapeSqlString(traceId)}' ` +
      `ORDER BY start_timestamp ASC LIMIT 1000`
    const body = await logfireFetch<LogfireQueryResponse>(ctx, sql)
    return rowsToTraces(body.rows ?? [])[0]
  },
}

registerAdapter(logfireAdapter)
