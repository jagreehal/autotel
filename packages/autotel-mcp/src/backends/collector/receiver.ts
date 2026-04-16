import * as http from 'node:http';
import type { CollectorStore } from './store.js';
import type {
  SpanRecord,
  MetricSeries,
  LogRecord,
  TagValue,
} from '../../types.js';

// ---------------------------------------------------------------------------
// OTLP attribute helpers
// ---------------------------------------------------------------------------

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

function decodeAnyValue(v: OtlpAnyValue): TagValue {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return '';
}

function attrsToRecord(
  kvs: OtlpKeyValue[] | undefined,
): Record<string, TagValue> {
  if (!kvs) return {};
  const out: Record<string, TagValue> = {};
  for (const kv of kvs) {
    out[kv.key] = decodeAnyValue(kv.value);
  }
  return out;
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
  return Number(BigInt(String(ns)) / 1_000_000n);
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
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  status?: { code?: number };
  attributes?: OtlpKeyValue[];
}

interface OtlpScopeSpans {
  spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeSpans?: OtlpScopeSpans[];
}

interface OtlpTracesPayload {
  resourceSpans?: OtlpResourceSpans[];
}

function parseTraces(body: OtlpTracesPayload): SpanRecord[] {
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
        const durationMs = endMs - startMs;
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
          tags: attrsToRecord(s.attributes),
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
}

interface OtlpMetric {
  name?: string;
  unit?: string;
  gauge?: { dataPoints?: OtlpDataPoint[] };
  sum?: { dataPoints?: OtlpDataPoint[] };
  histogram?: { dataPoints?: OtlpDataPoint[] };
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

function parseMetrics(body: OtlpMetricsPayload): MetricSeries[] {
  const series: MetricSeries[] = [];
  for (const rm of body.resourceMetrics ?? []) {
    const resourceAttrs = attrsToRecord(rm.resource?.attributes);
    for (const sm of rm.scopeMetrics ?? []) {
      for (const m of sm.metrics ?? []) {
        const dataPoints =
          m.gauge?.dataPoints ??
          m.sum?.dataPoints ??
          m.histogram?.dataPoints ??
          [];

        if (dataPoints.length === 0) continue;

        series.push({
          metricName: m.name ?? 'unknown',
          unit: m.unit,
          attributes: resourceAttrs,
          points: dataPoints.map((dp) => ({
            timestampUnixMs: nanoStringToMs(dp.timeUnixNano),
            value:
              dp.asDouble !== undefined
                ? dp.asDouble
                : dp.asInt !== undefined
                  ? Number(dp.asInt)
                  : 0,
          })),
        });
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
        logs.push({
          timestampUnixMs: nanoStringToMs(lr.timeUnixNano),
          severityText: lr.severityText ?? 'UNSPECIFIED',
          body: lr.body ? String(decodeAnyValue(lr.body)) : '',
          serviceName,
          traceId: toHex(lr.traceId, 32) ?? undefined,
          spanId: toHex(lr.spanId, 16) ?? undefined,
          attributes: attrsToRecord(lr.attributes),
        });
      }
    }
  }
  return logs;
}

// ---------------------------------------------------------------------------
// OtlpReceiver
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

export class OtlpReceiver {
  private store: CollectorStore;
  private port: number;
  private server: http.Server;

  constructor(store: CollectorStore, port: number) {
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
        const raw = await readBody(req);
        const body = JSON.parse(raw) as OtlpTracesPayload;
        const spans = parseTraces(body);
        await this.store.insertSpans(spans);
        sendJson(res, 200, {});
        return;
      }

      if (method === 'POST' && url === '/v1/metrics') {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as OtlpMetricsPayload;
        const metrics = parseMetrics(body);
        await this.store.insertMetrics(metrics);
        sendJson(res, 200, {});
        return;
      }

      if (method === 'POST' && url === '/v1/logs') {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as OtlpLogsPayload;
        const logs = parseLogs(body);
        await this.store.insertLogs(logs);
        sendJson(res, 200, {});
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
