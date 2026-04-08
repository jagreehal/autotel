// src/server/otlp.ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SpanData, TraceData, LogData } from './types'
import { getResourceName } from './resource-utils'

type OtlpAnyValue = {
  stringValue?: string
  boolValue?: boolean
  intValue?: string | number
  doubleValue?: number
  bytesValue?: string
  arrayValue?: { values?: OtlpAnyValue[] }
  kvlistValue?: { values?: OtlpKeyValue[] }
}

type OtlpKeyValue = { key: string; value?: OtlpAnyValue }

function resolveOtlpValue(v?: OtlpAnyValue): unknown {
  if (!v) return undefined
  if (v.stringValue !== undefined) return v.stringValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.intValue !== undefined) return typeof v.intValue === 'string' ? Number(v.intValue) : v.intValue
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.bytesValue !== undefined) return v.bytesValue
  if (v.arrayValue?.values) return v.arrayValue.values.map(resolveOtlpValue)
  if (v.kvlistValue?.values) return flattenAttributes(v.kvlistValue.values)
  return undefined
}

function flattenAttributes(attrs?: OtlpKeyValue[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!attrs) return out
  for (const { key, value } of attrs) {
    out[key] = resolveOtlpValue(value)
  }
  return out
}

function nanoToMs(nano?: string): number {
  if (!nano) return 0
  return Number(BigInt(nano) / 1_000_000n)
}

const SPAN_KIND_MAP: Record<number | string, SpanData['kind']> = {
  0: 'INTERNAL', 1: 'INTERNAL', 2: 'SERVER', 3: 'CLIENT', 4: 'PRODUCER', 5: 'CONSUMER',
  SPAN_KIND_INTERNAL: 'INTERNAL', SPAN_KIND_SERVER: 'SERVER',
  SPAN_KIND_CLIENT: 'CLIENT', SPAN_KIND_PRODUCER: 'PRODUCER', SPAN_KIND_CONSUMER: 'CONSUMER',
}

function normalizeHexId(id?: string): string {
  if (!id) return ''
  // Only attempt base64 decode for strings that look like base64-encoded binary IDs
  // (length 24 or 28 chars for 16/32-byte IDs, valid base64 chars, not plain hex)
  const isBase64Like = /^[A-Za-z0-9+/=]+$/.test(id) && !(/^[0-9a-f]+$/i.test(id))
  const isLikelyBase64Id = isBase64Like && (id.length === 24 || id.length === 28 || id.length === 44 || id.length === 48)
  if (isLikelyBase64Id) {
    try {
      const bytes = Buffer.from(id, 'base64')
      return bytes.toString('hex')
    } catch { /* fall through */ }
  }
  return id
}

export function parseOtlpTraces(payload: unknown): TraceData[] {
  if (!payload || typeof payload !== 'object') return []
  const { resourceSpans } = payload as any
  if (!Array.isArray(resourceSpans) || resourceSpans.length === 0) return []

  const traceMap = new Map<string, { spans: SpanData[]; service: string }>()

  for (const rs of resourceSpans) {
    const resourceAttrs = flattenAttributes(rs.resource?.attributes)
    const service = String(resourceAttrs['service.name'] || 'unknown')
    const scopeSpans = rs.scopeSpans || []

    for (const ss of scopeSpans) {
      for (const span of ss.spans || []) {
        const traceId = normalizeHexId(span.traceId)
        if (!traceId) continue

        const startMs = nanoToMs(span.startTimeUnixNano)
        const endMs = nanoToMs(span.endTimeUnixNano)
        const statusCode = span.status?.code
        let status: SpanData['status']['code'] = 'UNSET'
        if (statusCode === 1 || statusCode === 'STATUS_CODE_OK') status = 'OK'
        if (statusCode === 2 || statusCode === 'STATUS_CODE_ERROR') status = 'ERROR'

        const spanData: SpanData = {
          traceId,
          spanId: normalizeHexId(span.spanId),
          parentSpanId: normalizeHexId(span.parentSpanId) || undefined,
          name: span.name || 'unknown',
          kind: SPAN_KIND_MAP[span.kind ?? 0] || 'INTERNAL',
          startTime: startMs,
          endTime: endMs,
          duration: endMs - startMs,
          attributes: { ...resourceAttrs, ...flattenAttributes(span.attributes) } as Record<string, any>,
          status: { code: status, message: span.status?.message },
          events: (span.events || []).map((e: any) => ({
            name: e.name || '',
            timestamp: nanoToMs(e.timeUnixNano),
            attributes: flattenAttributes(e.attributes) as Record<string, any>,
          })),
        }

        const existing = traceMap.get(traceId)
        if (existing) {
          existing.spans.push(spanData)
        } else {
          traceMap.set(traceId, { spans: [spanData], service })
        }
      }
    }
  }

  const traces: TraceData[] = []
  for (const [traceId, { spans, service }] of traceMap) {
    const sorted = spans.sort((a, b) => a.startTime - b.startTime)
    const rootSpan = sorted.find(s => !s.parentSpanId) || sorted[0]
    const startTime = Math.min(...sorted.map(s => s.startTime))
    const endTime = Math.max(...sorted.map(s => s.endTime))
    const hasError = sorted.some(s => s.status.code === 'ERROR')

    traces.push({
      traceId,
      correlationId: traceId.slice(0, 16),
      rootSpan,
      spans: sorted,
      startTime,
      endTime,
      duration: endTime - startTime,
      status: hasError ? 'ERROR' : 'OK',
      service,
    })
  }

  return traces
}

export function parseOtlpLogs(payload: unknown): LogData[] {
  if (!payload || typeof payload !== 'object') return []
  const { resourceLogs } = payload as any
  if (!Array.isArray(resourceLogs)) return []

  const logs: LogData[] = []
  for (const rl of resourceLogs) {
    const resourceAttrs = flattenAttributes(rl.resource?.attributes)
    for (const sl of rl.scopeLogs || []) {
      for (const rec of sl.logRecords || []) {
        const timestamp = nanoToMs(rec.timeUnixNano || rec.observedTimeUnixNano)
        const traceId = normalizeHexId(rec.traceId) || undefined
        const spanId = normalizeHexId(rec.spanId) || undefined
        const body = rec.body ? resolveOtlpValue(rec.body) : ''

        logs.push({
          id: `${traceId || 'no-trace'}:${spanId || 'no-span'}:${timestamp}:${rec.severityNumber || 0}`,
          traceId,
          spanId,
          resourceName: getResourceName(resourceAttrs as Record<string, unknown>),
          severityText: rec.severityText,
          severityNumber: rec.severityNumber,
          body: typeof body === 'string' ? body : (body as Record<string, unknown>),
          timestamp,
          attributes: flattenAttributes(rec.attributes) as Record<string, unknown>,
          resource: resourceAttrs as Record<string, unknown>,
        })
      }
    }
  }

  return logs
}

export function countOtlpMetrics(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0
  const { resourceMetrics } = payload as any
  if (!Array.isArray(resourceMetrics)) return 0
  let count = 0
  for (const rm of resourceMetrics) {
    for (const sm of rm.scopeMetrics || []) {
      count += (sm.metrics || []).length
    }
  }
  return count
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

export function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}
