import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CollectorStore } from './store';
import {
  exceptionTags,
  normalizeTagValue,
  normalizeTags,
  spanKindTag,
} from '../span-mapping';
import {
  decodeOtlpLogsRequest,
  decodeOtlpMetricsRequest,
  decodeOtlpTraceRequest,
  decompressOtlpBody,
  encodeOtlpError,
  isProtobufContentType,
} from 'autotel-devtools/otlp-proto';
import type { SourceMapResolver } from 'autotel-devtools/sourcemaps';
import type {
  SpanRecord,
  MetricSeries,
  LogRecord,
  TagValue,
} from '../../types';

// ---------------------------------------------------------------------------
// OTLP attribute helpers
// ---------------------------------------------------------------------------

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpAnyValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
}

interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

/** An OTLP AnyValue as plain JS: a kvlist is an object, an array a list. */
function anyValueToJs(v: OtlpAnyValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(anyValueToJs);
  if (v.kvlistValue) return kvsToObject(v.kvlistValue.values);
  return '';
}

function kvsToObject(kvs: OtlpKeyValue[] | undefined): Record<string, unknown> {
  return Object.fromEntries(
    (kvs ?? []).map((kv) => [kv.key, anyValueToJs(kv.value)]),
  );
}

function decodeAnyValue(v: OtlpAnyValue): TagValue {
  return normalizeTagValue(anyValueToJs(v));
}

/** Attributes as flat tags; a kvlist attribute becomes dotted keys. */
function attrsToRecord(kvs: OtlpKeyValue[] | undefined) {
  return normalizeTags(kvsToObject(kvs));
}

function getServiceName(kvs: OtlpKeyValue[] | undefined): string {
  if (!kvs) return 'unknown';
  const sn = kvs.find((kv) => kv.key === 'service.name');
  return sn ? String(decodeAnyValue(sn.value)) : 'unknown';
}

// ---------------------------------------------------------------------------
// ID conversion helpers
// ---------------------------------------------------------------------------

/**
 * OTLP IDs can arrive as either:
 *   - A hex string (32 chars for traceId, 16 for spanId)
 *   - A base64-encoded binary value
 *
 * We always store as lowercase hex.
 */
function toHex(
  id: string | undefined | null,
  expectedHexLen: number,
): string | null {
  if (!id) return null;
  // Already looks like hex (only 0-9a-fA-F, right length)
  if (id.length === expectedHexLen && /^[0-9a-fA-F]+$/.test(id)) {
    return id.toLowerCase();
  }
  // Try base64 decode
  try {
    const buf = Buffer.from(id, 'base64');
    return buf.toString('hex');
  } catch {
    return id.toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Timestamp helper
// ---------------------------------------------------------------------------

function nanoStringToMs(ns: string | number | undefined): number {
  if (ns === undefined || ns === null) return Date.now();
  const nanos = BigInt(String(ns));
  return Number(nanos / 1_000_000n) + Number(nanos % 1_000_000n) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Status code mapping
// ---------------------------------------------------------------------------

function mapStatusCode(code: number | undefined): 'UNSET' | 'OK' | 'ERROR' {
  if (code === 1) return 'OK';
  if (code === 2) return 'ERROR';
  return 'UNSET';
}

// ---------------------------------------------------------------------------
// OTLP payload parsers
// ---------------------------------------------------------------------------

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number | string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  status?: { code?: number; message?: string };
  attributes?: OtlpKeyValue[];
  events?: Array<{ name?: string; attributes?: OtlpKeyValue[] }>;
}

/**
 * Span tags: the span's attributes, plus the recorded `exception` event
 * (type, message, stacktrace) and the resource's `service.version`, which
 * issue grouping needs and which otherwise never reach a SpanRecord.
 */
function spanTags(
  s: OtlpSpan,
  resource: OtlpKeyValue[] | undefined,
  resolver: SourceMapResolver | undefined,
): Record<string, TagValue> {
  const version = resource?.find((kv) => kv.key === 'service.version');
  const tags: Record<string, TagValue> = {
    ...(version ? { 'service.version': decodeAnyValue(version.value) } : {}),
    ...exceptionTags(
      s.events?.map((e) => ({
        name: e.name,
        attributes: attrsToRecord(e.attributes),
      })),
      s.status?.message,
    ),
    ...spanKindTag(s.kind),
    ...attrsToRecord(s.attributes),
  };
  // Map bundle frames back to source before anything groups or shows them.
  const stack = tags['exception.stacktrace'];
  if (resolver && typeof stack === 'string') {
    tags['exception.stacktrace'] = resolver.resolveStack(stack);
  }
  return tags;
}

interface OtlpScopeSpans {
  spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpTracesPayload {
  resourceSpans?: OtlpResourceSpans[];
}

export function parseTraces(
  body: OtlpTracesPayload,
  resolver?: SourceMapResolver,
): SpanRecord[] {
  const spans: SpanRecord[] = [];
  for (const rs of body.resourceSpans ?? []) {
    const serviceName = getServiceName(rs.resource?.attributes);
    for (const ss of rs.scopeSpans ?? []) {
      for (const s of ss.spans ?? []) {
        const traceId = toHex(s.traceId, 32);
        const spanId = toHex(s.spanId, 16);
        if (!traceId || !spanId) continue;

        const startMs = nanoStringToMs(s.startTimeUnixNano);
        const endMs = nanoStringToMs(s.endTimeUnixNano);
        // Subtract before converting: epoch nanoseconds exceed Number's exact
        // range, and truncating each endpoint loses sub-millisecond durations.
        const durationMs =
          s.startTimeUnixNano != null && s.endTimeUnixNano != null
            ? Number(
                BigInt(String(s.endTimeUnixNano)) -
                  BigInt(String(s.startTimeUnixNano)),
              ) / 1_000_000
            : endMs - startMs;
        const statusCode = mapStatusCode(s.status?.code);

        spans.push({
          traceId,
          spanId,
          parentSpanId: toHex(s.parentSpanId, 16),
          operationName: s.name ?? 'unknown',
          serviceName,
          startTimeUnixMs: startMs,
          durationMs,
          statusCode,
          tags: spanTags(s, rs.resource?.attributes, resolver),
          hasError: statusCode === 'ERROR',
        });
      }
    }
  }
  return spans;
}

// ---------------------------------------------------------------------------

interface OtlpDataPoint {
  timeUnixNano?: string | number;
  asDouble?: number;
  asInt?: string | number;
  /** Histogram and summary points carry these instead of a value. */
  sum?: number;
  count?: string | number;
  attributes?: OtlpKeyValue[];
}

interface OtlpMetric {
  name?: string;
  unit?: string;
  gauge?: { dataPoints?: OtlpDataPoint[] };
  sum?: { dataPoints?: OtlpDataPoint[] };
  histogram?: { dataPoints?: OtlpDataPoint[] };
  exponentialHistogram?: { dataPoints?: OtlpDataPoint[] };
  summary?: { dataPoints?: OtlpDataPoint[] };
}

interface OtlpScopeMetrics {
  metrics?: OtlpMetric[];
}

interface OtlpResourceMetrics {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeMetrics?: OtlpScopeMetrics[];
}

interface OtlpMetricsPayload {
  resourceMetrics?: OtlpResourceMetrics[];
}

function dataPointValue(dp: OtlpDataPoint): number {
  if (dp.asDouble !== undefined) return dp.asDouble;
  if (dp.asInt !== undefined) return Number(dp.asInt);
  // A histogram or summary has no single value, so report the mean. Under
  // cumulative temporality that is the mean since the process started.
  const count = Number(dp.count ?? 0);
  return dp.sum !== undefined && count > 0 ? dp.sum / count : 0;
}

/** Stable identity for an attribute set, independent of OTLP key order. */
function attributeKey(attributes: Record<string, TagValue>): string {
  return JSON.stringify(
    Object.entries(attributes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function parseMetrics(body: OtlpMetricsPayload): MetricSeries[] {
  const series: MetricSeries[] = [];
  for (const rm of body.resourceMetrics ?? []) {
    const resourceAttrs = attrsToRecord(rm.resource?.attributes);
    for (const sm of rm.scopeMetrics ?? []) {
      for (const m of sm.metrics ?? []) {
        const dataPoints =
          m.gauge?.dataPoints ??
          m.sum?.dataPoints ??
          m.histogram?.dataPoints ??
          m.exponentialHistogram?.dataPoints ??
          m.summary?.dataPoints ??
          [];

        if (dataPoints.length === 0) continue;

        // OTel puts a metric's dimensions on the data point, not the resource:
        // one `http.server.requests` metric arrives as a data point per route.
        // Folding them into one series by resource alone sums unrelated label
        // sets into a single untyped timeline, so split by attribute set.
        const byAttributes = new Map<string, MetricSeries>();
        for (const dp of dataPoints) {
          const attributes = {
            ...resourceAttrs,
            ...attrsToRecord(dp.attributes),
          };
          const key = attributeKey(attributes);
          let entry = byAttributes.get(key);
          if (!entry) {
            entry = {
              metricName: m.name ?? 'unknown',
              unit: m.unit,
              attributes,
              points: [],
            };
            byAttributes.set(key, entry);
          }
          entry.points.push({
            timestampUnixMs: nanoStringToMs(dp.timeUnixNano),
            value: dataPointValue(dp),
          });
        }
        series.push(...byAttributes.values());
      }
    }
  }
  return series;
}

// ---------------------------------------------------------------------------

interface OtlpLogRecord {
  timeUnixNano?: string | number;
  severityText?: string;
  body?: OtlpAnyValue;
  traceId?: string;
  spanId?: string;
  eventName?: string;
  attributes?: OtlpKeyValue[];
}

interface OtlpScopeLogs {
  logRecords?: OtlpLogRecord[];
}

interface OtlpResourceLogs {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeLogs?: OtlpScopeLogs[];
}

interface OtlpLogsPayload {
  resourceLogs?: OtlpResourceLogs[];
}

function parseLogs(body: OtlpLogsPayload): LogRecord[] {
  const logs: LogRecord[] = [];
  for (const rl of body.resourceLogs ?? []) {
    const serviceName = getServiceName(rl.resource?.attributes);
    for (const sl of rl.scopeLogs ?? []) {
      for (const lr of sl.logRecords ?? []) {
        const attributes = attrsToRecord(lr.attributes);
        // Newer SDKs name an event in this field, older ones in the attribute.
        if (lr.eventName) attributes['event.name'] ??= lr.eventName;
        logs.push({
          timestampUnixMs: nanoStringToMs(lr.timeUnixNano),
          severityText: lr.severityText ?? 'UNSPECIFIED',
          body: lr.body ? String(decodeAnyValue(lr.body)) : '',
          serviceName,
          traceId: toHex(lr.traceId, 32) ?? undefined,
          spanId: toHex(lr.spanId, 16) ?? undefined,
          attributes,
        });
      }
    }
  }
  return logs;
}

// ---------------------------------------------------------------------------
// OtlpReceiver
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Every response this receiver sends: an empty OTLP ack, or an error. */
interface OtlpResponseBody {
  error?: string;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: OtlpResponseBody,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

/** A body that is neither valid OTLP/JSON nor OTLP/protobuf: the sender's fault, so a 400. */
class MalformedBody extends Error {}

interface OtlpRequest<T> {
  body: T;
  protobuf: boolean;
}

/** Most OpenTelemetry SDKs default to `http/protobuf`. Both encodings feed the same parsers. */
async function readOtlpRequest<T>(
  req: http.IncomingMessage,
  decodeProtobuf: (body: Uint8Array) => object,
): Promise<OtlpRequest<T>> {
  const compressed = await readBody(req);
  const protobuf = isProtobufContentType(req.headers['content-type']);
  try {
    const raw = await decompressOtlpBody(
      compressed,
      req.headers['content-encoding'],
    );
    // SAFETY: an OTLP exporter is the only caller, and every field the parsers
    // read is optional, so a payload of another shape yields no records rather
    // than a bad read.
    const body = (
      protobuf ? decodeProtobuf(raw) : JSON.parse(raw.toString('utf8'))
    ) as T;
    return { body, protobuf };
  } catch (error) {
    throw new MalformedBody(String(error));
  }
}

/** OTLP answers in the encoding it was sent; an empty protobuf response is zero bytes. */
function sendAck(res: http.ServerResponse, protobuf: boolean): void {
  if (protobuf) {
    res.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
    res.end();
    return;
  }
  sendJson(res, 200, {});
}

export class OtlpReceiver {
  private store: CollectorStore;
  private port: number;
  private server: http.Server;

  constructor(
    store: CollectorStore,
    port: number,
    private readonly resolver?: SourceMapResolver,
  ) {
    this.store = store;
    this.port = port;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const { method, url } = req;

      if (method === 'POST' && url === '/v1/traces') {
        const { body, protobuf } = await readOtlpRequest<OtlpTracesPayload>(
          req,
          decodeOtlpTraceRequest,
        );
        const spans = parseTraces(body, this.resolver);
        await this.store.insertSpans(spans);
        sendAck(res, protobuf);
        return;
      }

      if (method === 'POST' && url === '/v1/metrics') {
        const { body, protobuf } = await readOtlpRequest<OtlpMetricsPayload>(
          req,
          decodeOtlpMetricsRequest,
        );
        const metrics = parseMetrics(body);
        await this.store.insertMetrics(metrics);
        sendAck(res, protobuf);
        return;
      }

      if (method === 'POST' && url === '/v1/logs') {
        const { body, protobuf } = await readOtlpRequest<OtlpLogsPayload>(
          req,
          decodeOtlpLogsRequest,
        );
        const logs = parseLogs(body);
        await this.store.insertLogs(logs);
        sendAck(res, protobuf);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = error instanceof MalformedBody ? 400 : 500;
      if (isProtobufContentType(req.headers['content-type'])) {
        res.writeHead(status, { 'Content-Type': 'application/x-protobuf' });
        res.end(encodeOtlpError(String(error)));
        return;
      }
      sendJson(res, status, { error: String(error) });
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        // SAFETY: address() answers with AddressInfo for a host/port listen.
        // The string form describes a pipe or unix socket, which this never
        // binds, and null only before listening — inside this callback it is.
        const address = this.server.address() as AddressInfo | null;
        if (address !== null) this.port = address.port;
        resolve();
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
