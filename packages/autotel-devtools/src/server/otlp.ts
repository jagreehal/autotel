// src/server/otlp.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { SpanData, TraceData, LogData } from './types';
import type {
  OtelMetricRecord,
  OtelDataPoint,
  AgentRawEvent,
  Attributes,
  MetricTemporality,
} from 'autotel-agents';
import { getResourceName } from './resource-utils';
import { pickRoot } from './trace-root';
import type { AttributeValue, SpanAttributes } from '../widget/types.js';
import type {
  OtlpAnyValue,
  OtlpKeyValue,
  OtlpLogsRequest,
  OtlpMetric,
  OtlpMetricsRequest,
  OtlpTraceRequest,
} from './otlp-types.js';
import { otlpEnvelope } from './otlp-types.js';
import { asString } from '../widget/attrs.js';
import { asObject } from '../widget/utils/json-fields.js';

function resolveOtlpValue(v?: OtlpAnyValue): AttributeValue {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return v.boolValue;
  // intValue is a string in OTLP/JSON (int64 does not survive JSON) and a
  // number once protobuf is decoded; Number() takes either.
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.bytesValue !== undefined) return v.bytesValue;
  if (v.arrayValue?.values) return v.arrayValue.values.map(resolveOtlpValue);
  if (v.kvlistValue?.values) return flattenAttributes(v.kvlistValue.values);
  return undefined;
}

export function flattenAttributes(attrs?: OtlpKeyValue[]): SpanAttributes {
  const out: SpanAttributes = {};
  if (!attrs) return out;
  for (const { key, value } of attrs) {
    out[key] = resolveOtlpValue(value);
  }
  return out;
}

/**
 * A log record's body: the text it carried, or the structure it carried when
 * the sender used an OTLP kvlist or array rather than a string.
 */
function logBody(body: AttributeValue): string | SpanAttributes {
  const text = asString(body);
  if (text !== undefined) return text;
  if (body === undefined || body === null) return '';
  const structured = asObject(body);
  if (!structured) return String(body);
  // SAFETY: resolveOtlpValue returns a nested map for kvlist and array bodies,
  // which is what SpanAttributes describes.
  return structured as SpanAttributes;
}

/**
 * Attributes handed to the agent layer, whose `Attributes` is OTel's own -
 * scalars and arrays of scalars, nothing nested.
 *
 * SAFETY: a coding agent's metrics and events carry scalar attributes only,
 * so the two shapes agree in practice. A sender that nests one anyway is
 * rendered by the Agents tab as whatever it is rather than being dropped.
 */
function agentAttributes(attributes: SpanAttributes): Attributes {
  // SAFETY: see the note above.
  return attributes as Attributes;
}

export function nanoToMs(nano?: string): number {
  if (!nano) return 0;
  // Split into integer ms (kept in BigInt to stay exact at epoch magnitude,
  // which exceeds Number.MAX_SAFE_INTEGER in nanoseconds) plus the sub-ms
  // remainder, so fast spans (<1ms) keep microsecond precision instead of
  // collapsing to 0ms.
  const ns = BigInt(nano);
  const ms = ns / 1_000_000n;
  const remNs = ns % 1_000_000n;
  return Number(ms) + Number(remNs) / 1_000_000;
}

// A Map rather than an object: the key is whatever the exporter sent, which
// is a number in protobuf and the enum name in some JSON clients.
const SPAN_KIND_MAP = new Map<number | string, SpanData['kind']>([
  [0, 'INTERNAL'],
  [1, 'INTERNAL'],
  [2, 'SERVER'],
  [3, 'CLIENT'],
  [4, 'PRODUCER'],
  [5, 'CONSUMER'],
  ['SPAN_KIND_INTERNAL', 'INTERNAL'],
  ['SPAN_KIND_SERVER', 'SERVER'],
  ['SPAN_KIND_CLIENT', 'CLIENT'],
  ['SPAN_KIND_PRODUCER', 'PRODUCER'],
  ['SPAN_KIND_CONSUMER', 'CONSUMER'],
]);

export function normalizeHexId(id?: string): string {
  if (!id) return '';
  // Only attempt base64 decode for strings that look like base64-encoded binary IDs
  // (length 12 for 8-byte span IDs, 24/28 for 16-byte trace IDs, etc; valid base64
  // chars, not plain hex). Protobuf clients emit IDs as base64 (8-byte span IDs ->
  // 12 chars, 16-byte trace IDs -> 24 chars), so length 12 must be recognised too.
  const isBase64Like = /^[A-Za-z0-9+/=]+$/.test(id) && !/^[0-9a-f]+$/i.test(id);
  const isLikelyBase64Id =
    isBase64Like &&
    (id.length === 12 ||
      id.length === 24 ||
      id.length === 28 ||
      id.length === 44 ||
      id.length === 48);
  if (isLikelyBase64Id) {
    try {
      const bytes = Buffer.from(id, 'base64');
      return bytes.toString('hex');
    } catch {
      /* fall through */
    }
  }
  return id;
}

export function parseOtlpTraces(payload: unknown): TraceData[] {
  const resourceSpans = otlpEnvelope<OtlpTraceRequest>(payload)?.resourceSpans;
  if (!resourceSpans || resourceSpans.length === 0) return [];

  const traceMap = new Map<string, { spans: SpanData[]; service: string }>();

  for (const rs of resourceSpans) {
    const resourceAttrs = flattenAttributes(rs.resource?.attributes);
    const service = String(resourceAttrs['service.name'] || 'unknown');
    for (const ss of rs.scopeSpans ?? []) {
      const scope = ss.scope?.name
        ? { name: ss.scope.name, version: ss.scope.version || undefined }
        : undefined;
      for (const span of ss.spans || []) {
        const traceId = normalizeHexId(span.traceId);
        if (!traceId) continue;

        const startMs = nanoToMs(span.startTimeUnixNano);
        const endMs = nanoToMs(span.endTimeUnixNano);
        const statusCode = span.status?.code;
        let status: SpanData['status']['code'] = 'UNSET';
        if (statusCode === 1 || statusCode === 'STATUS_CODE_OK') status = 'OK';
        if (statusCode === 2 || statusCode === 'STATUS_CODE_ERROR')
          status = 'ERROR';

        const spanData: SpanData = {
          traceId,
          spanId: normalizeHexId(span.spanId),
          parentSpanId: normalizeHexId(span.parentSpanId) || undefined,
          name: span.name || 'unknown',
          kind: SPAN_KIND_MAP.get(span.kind ?? 0) ?? 'INTERNAL',
          startTime: startMs,
          endTime: endMs,
          duration: endMs - startMs,
          attributes: {
            ...resourceAttrs,
            ...flattenAttributes(span.attributes),
          },
          status: { code: status, message: span.status?.message },
          events: (span.events ?? []).map((e) => ({
            name: e.name || '',
            timestamp: nanoToMs(e.timeUnixNano),
            attributes: flattenAttributes(e.attributes),
          })),
          links: (span.links ?? []).map((l) => ({
            traceId: normalizeHexId(l.traceId),
            spanId: normalizeHexId(l.spanId),
            attributes: flattenAttributes(l.attributes),
          })),
          scope,
        };

        const existing = traceMap.get(traceId);
        if (existing) {
          existing.spans.push(spanData);
        } else {
          traceMap.set(traceId, { spans: [spanData], service });
        }
      }
    }
  }

  const traces: TraceData[] = [];
  for (const [traceId, { spans, service }] of traceMap) {
    const sorted = spans.sort((a, b) => a.startTime - b.startTime);
    const { rootSpan, partial } = pickRoot(sorted);

    const startTime = Math.min(...sorted.map((s) => s.startTime));
    const endTime = Math.max(...sorted.map((s) => s.endTime));
    const hasError = sorted.some((s) => s.status.code === 'ERROR');

    const trace: TraceData = {
      traceId,
      correlationId: traceId.slice(0, 16),
      rootSpan,
      spans: sorted,
      startTime,
      endTime,
      duration: endTime - startTime,
      status: hasError ? 'ERROR' : 'OK',
      service,
    };
    if (partial) trace.partial = true;
    traces.push(trace);
  }

  return traces;
}

export function parseOtlpLogs(payload: unknown): LogData[] {
  const resourceLogs = otlpEnvelope<OtlpLogsRequest>(payload)?.resourceLogs;
  if (!resourceLogs) return [];

  const logs: LogData[] = [];
  for (const rl of resourceLogs) {
    const resourceAttrs = flattenAttributes(rl.resource?.attributes);
    for (const sl of rl.scopeLogs ?? []) {
      for (const rec of sl.logRecords ?? []) {
        const timestamp = nanoToMs(
          rec.timeUnixNano || rec.observedTimeUnixNano,
        );
        const traceId = normalizeHexId(rec.traceId) || undefined;
        const spanId = normalizeHexId(rec.spanId) || undefined;
        const body = rec.body ? resolveOtlpValue(rec.body) : '';

        logs.push({
          id: `${traceId || 'no-trace'}:${spanId || 'no-span'}:${timestamp}:${rec.severityNumber || 0}`,
          traceId,
          spanId,
          resourceName: getResourceName(resourceAttrs),
          severityText: rec.severityText,
          severityNumber: rec.severityNumber,
          body: logBody(body),
          timestamp,
          attributes: flattenAttributes(rec.attributes),
          resource: resourceAttrs,
        });
      }
    }
  }

  return logs;
}

export function countOtlpMetrics(payload: unknown): number {
  const resourceMetrics =
    otlpEnvelope<OtlpMetricsRequest>(payload)?.resourceMetrics;
  if (!resourceMetrics) return 0;
  let count = 0;
  for (const rm of resourceMetrics) {
    for (const sm of rm.scopeMetrics ?? []) {
      count += (sm.metrics ?? []).length;
    }
  }
  return count;
}

// Pull numeric data points out of a Metric. OTLP wraps points in a per-type
// oneof (`gauge`/`sum` carry NumberDataPoints; `histogram` carries
// HistogramDataPoints). Coding-agent instruments are all counters (Sum) so the
// NumberDataPoint path covers token/cost/lines/etc.; histograms (e.g. request
// duration) fall back to their `count`.
function extractDataPoints(metric: OtlpMetric): OtelDataPoint[] {
  const points: OtelDataPoint[] = [];
  const numberPoints = metric.sum?.dataPoints ?? metric.gauge?.dataPoints;
  if (Array.isArray(numberPoints)) {
    for (const dp of numberPoints) {
      const value =
        dp.asDouble !== undefined
          ? Number(dp.asDouble)
          : dp.asInt !== undefined
            ? Number(dp.asInt)
            : 0;
      points.push({
        value,
        attributes: agentAttributes(flattenAttributes(dp.attributes)),
        timestamp: nanoToMs(dp.timeUnixNano || dp.startTimeUnixNano),
      });
    }
  }
  const histPoints = metric.histogram?.dataPoints;
  if (Array.isArray(histPoints)) {
    for (const dp of histPoints) {
      points.push({
        value: dp.count !== undefined ? Number(dp.count) : 0,
        attributes: agentAttributes(flattenAttributes(dp.attributes)),
        timestamp: nanoToMs(dp.timeUnixNano || dp.startTimeUnixNano),
      });
    }
  }
  return points;
}

/**
 * Parse OTLP metrics into structured records with data points + attributes,
 * for the agent layer (and richer metric views). Works for both OTLP/JSON and
 * decoded OTLP/protobuf — they share the same camelCase shape.
 */
// OTLP aggregation temporality: 1 = DELTA, 2 = CUMULATIVE (numeric in protobuf
// and most JSON; the string enum is handled too). Only Sum/Histogram carry it.
function readTemporality(metric: OtlpMetric): MetricTemporality | undefined {
  const raw =
    metric.sum?.aggregationTemporality ??
    metric.histogram?.aggregationTemporality;
  if (raw === 2 || raw === 'AGGREGATION_TEMPORALITY_CUMULATIVE')
    return 'cumulative';
  if (raw === 1 || raw === 'AGGREGATION_TEMPORALITY_DELTA') return 'delta';
  return undefined;
}

export function parseOtlpMetrics(payload: unknown): OtelMetricRecord[] {
  const resourceMetrics =
    otlpEnvelope<OtlpMetricsRequest>(payload)?.resourceMetrics;
  if (!resourceMetrics) return [];

  const records: OtelMetricRecord[] = [];
  for (const rm of resourceMetrics) {
    const resource = agentAttributes(
      flattenAttributes(rm.resource?.attributes),
    );
    for (const sm of rm.scopeMetrics ?? []) {
      const scope = sm.scope?.name
        ? { name: sm.scope.name, version: sm.scope.version || undefined }
        : undefined;
      for (const metric of sm.metrics ?? []) {
        records.push({
          name: metric.name ?? '',
          unit: metric.unit || undefined,
          description: metric.description || undefined,
          temporality: readTemporality(metric),
          dataPoints: extractDataPoints(metric),
          resource,
          scope,
        });
      }
    }
  }
  return records;
}

/**
 * Parse OTLP logs into `AgentRawEvent`s for the agent layer. Keeps the
 * instrumentation scope and event name (Claude Code emits its events as logs,
 * with the unprefixed name in the `event.name` attribute). Distinct from
 * `parseOtlpLogs`, which feeds the generic Logs tab.
 */
export function parseOtlpAgentEvents(payload: unknown): AgentRawEvent[] {
  const resourceLogs = otlpEnvelope<OtlpLogsRequest>(payload)?.resourceLogs;
  if (!resourceLogs) return [];

  const events: AgentRawEvent[] = [];
  for (const rl of resourceLogs) {
    const resource = agentAttributes(
      flattenAttributes(rl.resource?.attributes),
    );
    for (const sl of rl.scopeLogs ?? []) {
      const scope = sl.scope?.name
        ? { name: sl.scope.name, version: sl.scope.version || undefined }
        : undefined;
      for (const rec of sl.logRecords ?? []) {
        const attributes = agentAttributes(flattenAttributes(rec.attributes));
        const eventName =
          rec.eventName || String(attributes['event.name'] ?? '');
        events.push({
          eventName,
          timestamp: nanoToMs(rec.timeUnixNano || rec.observedTimeUnixNano),
          body: rec.body ? resolveOtlpValue(rec.body) : undefined,
          attributes,
          resource,
          scope,
        });
      }
    }
  }
  return events;
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * True for OTLP/protobuf bodies. The OpenTelemetry Python/Java/Go SDKs default to
 * `http/protobuf` over OTLP HTTP, sending `application/x-protobuf`; some clients use
 * `application/protobuf`. Anything else (JSON, unset) is treated as OTLP/JSON.
 */
export function isProtobufContentType(contentType?: string): boolean {
  if (!contentType) return false;
  const value = contentType.toLowerCase();
  return (
    value.includes('application/x-protobuf') ||
    value.includes('application/protobuf')
  );
}

/**
 * Below this, gzip costs more than it saves: the header alone is 18 bytes and
 * a small body already fits one segment.
 */
const GZIP_MIN_BYTES = 1024;

/**
 * Send JSON, gzipped when the client accepts it and the body is big enough.
 *
 * A trace payload is mostly repeated keys and near-identical ids and strings,
 * which is the shape deflate handles best: a 4,891-span trace measures 2,078
 * KiB raw against 41 KiB gzipped. Reshaping the payload to dedupe scopes and
 * drop the repeated trace id was measured against this and is not worth doing,
 * since deflate already removes what such a dedupe removes.
 *
 * `res.req` is Node's own back-reference to the request, so the negotiation
 * needs nothing threaded through the twenty-odd call sites.
 */
export function sendJson<TBody>(
  res: ServerResponse,
  status: number,
  data: TBody,
): void {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const accepted = String(res.req?.headers['accept-encoding'] ?? '');

  if (accepted.includes('gzip') && body.byteLength >= GZIP_MIN_BYTES) {
    // Synchronous, like the rest of the read path. A multi-megabyte
    // response blocks the loop for tens of ms; move to the async gzip if a
    // local dev tool ever has more than one impatient client.
    const packed = gzipSync(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      Vary: 'Accept-Encoding',
      'Content-Length': packed.byteLength,
    });
    res.end(packed);
    return;
  }

  res.writeHead(status, {
    'Content-Type': 'application/json',
    Vary: 'Accept-Encoding',
    'Content-Length': body.byteLength,
  });
  res.end(body);
}
