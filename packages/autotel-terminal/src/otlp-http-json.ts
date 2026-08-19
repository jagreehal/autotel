import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TerminalSpanEvent, SpanEvent, SpanLink } from './span-stream';
import type { TerminalLogEvent, LogLevel } from './lib/log-model';
import { asRecord, asString } from './values.js';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

type OtlpAnyValue = {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  bytesValue?: string;
};

type OtlpKeyValue = {
  key: string;
  value?: OtlpAnyValue;
};

type OtlpSpan = {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number | string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: OtlpKeyValue[];
  status?: {
    code?: number | string;
  };
  events?: {
    timeUnixNano?: string;
    name?: string;
    attributes?: OtlpKeyValue[];
  }[];
  links?: {
    traceId?: string;
    spanId?: string;
    attributes?: OtlpKeyValue[];
  }[];
};

/** What an OTLP AnyValue decodes to once its wrapper is unwrapped. */
export type OtlpPrimitive = string | number | boolean | undefined;

/** A decoded OTLP attribute bag. */
export type OtlpAttributes = Record<string, OtlpPrimitive>;

function anyValueToPrimitive(value: OtlpAnyValue | undefined): OtlpPrimitive {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) {
    const num = Number(value.intValue);
    return Number.isNaN(num) ? value.intValue : num;
  }
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  return undefined;
}

function attrsToRecord(attributes: OtlpKeyValue[] | undefined): OtlpAttributes {
  if (!attributes || attributes.length === 0) return {};
  return Object.fromEntries(
    attributes.map((attribute) => [
      attribute.key,
      anyValueToPrimitive(attribute.value),
    ]),
  );
}

function normalizeHexId(
  id: string | undefined,
  expectedHexLength: number,
): string {
  if (!id) return ''.padStart(expectedHexLength, '0');
  const trimmed = id.trim();
  if (/^[a-fA-F0-9]+$/.test(trimmed)) {
    return trimmed
      .toLowerCase()
      .padStart(expectedHexLength, '0')
      .slice(-expectedHexLength);
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('hex');
    if (decoded.length > 0) {
      return decoded
        .toLowerCase()
        .padStart(expectedHexLength, '0')
        .slice(-expectedHexLength);
    }
  } catch {
    // ignore and fall through
  }
  return ''.padStart(expectedHexLength, '0');
}

function toMs(unixNano: string | undefined): number {
  if (!unixNano) return Date.now();
  const parsed = Number(unixNano);
  if (Number.isNaN(parsed)) return Date.now();
  return parsed / 1_000_000;
}

function mapStatus(
  code: number | string | undefined,
): 'OK' | 'ERROR' | 'UNSET' {
  const normalized = asString(code)?.toUpperCase() ?? code;
  if (
    normalized === 1 ||
    normalized === 'STATUS_CODE_OK' ||
    normalized === 'OK'
  )
    return 'OK';
  if (
    normalized === 2 ||
    normalized === 'STATUS_CODE_ERROR' ||
    normalized === 'ERROR'
  ) {
    return 'ERROR';
  }
  return 'UNSET';
}

function mapKind(kind: number | string | undefined): string {
  const named = asString(kind);
  if (named !== undefined) return named.toUpperCase();
  switch (kind) {
    case 1: {
      return 'INTERNAL';
    }
    case 2: {
      return 'SERVER';
    }
    case 3: {
      return 'CLIENT';
    }
    case 4: {
      return 'PRODUCER';
    }
    case 5: {
      return 'CONSUMER';
    }
    default: {
      return 'INTERNAL';
    }
  }
}

/**
 * The OTLP/JSON export envelopes, as the collector protocol defines them. A
 * body that does not match yields nothing: every level is checked for the array
 * it should carry before it is walked.
 */
interface OtlpTraceExport {
  resourceSpans?: Array<{
    resource?: { attributes?: OtlpKeyValue[] };
    scopeSpans?: Array<{ spans?: OtlpSpan[] }>;
  }>;
}

function* extractSpans(
  payload: unknown,
): Generator<{ span: OtlpSpan; resourceAttrs: OtlpAttributes }> {
  if (!asRecord(payload)) return;
  // SAFETY: the one assertion for this walker. The envelope is a published
  // protocol shape, and each level below is checked for its array before use.
  const { resourceSpans } = payload as OtlpTraceExport;
  if (!Array.isArray(resourceSpans)) return;
  for (const resourceSpan of resourceSpans) {
    if (!asRecord(resourceSpan)) continue;
    const resourceAttrs = attrsToRecord(resourceSpan.resource?.attributes);
    const scopeSpans = resourceSpan.scopeSpans;
    if (!Array.isArray(scopeSpans)) continue;
    for (const scopeSpan of scopeSpans) {
      if (!asRecord(scopeSpan)) continue;
      const spans = scopeSpan.spans;
      if (!Array.isArray(spans)) continue;
      for (const span of spans) {
        if (asRecord(span)) yield { span, resourceAttrs };
      }
    }
  }
}

export function otlpSpanToTerminalEvent(
  span: OtlpSpan,
  resourceAttrs: OtlpAttributes = {},
): TerminalSpanEvent {
  const startTime = toMs(span.startTimeUnixNano);
  const endTime = toMs(span.endTimeUnixNano);
  const spanAttrs = attrsToRecord(span.attributes);
  // Merge resource attributes (e.g. service.name) under span attributes,
  // with span-level attributes taking precedence
  const mergedAttrs: OtlpAttributes = {};
  for (const [k, v] of Object.entries(resourceAttrs)) {
    mergedAttrs[k] = v;
  }
  for (const [k, v] of Object.entries(spanAttrs)) {
    mergedAttrs[k] = v;
  }
  const parsedEvents: SpanEvent[] | undefined = span.events?.length
    ? span.events.map((e) => ({
        name: e.name || '',
        timeMs: toMs(e.timeUnixNano),
        attributes: attrsToRecord(e.attributes),
      }))
    : undefined;

  const parsedLinks: SpanLink[] | undefined = span.links?.length
    ? span.links.map((l) => ({
        traceId: normalizeHexId(l.traceId, 32),
        spanId: normalizeHexId(l.spanId, 16),
        attributes: attrsToRecord(l.attributes),
      }))
    : undefined;

  const collected: TerminalSpanEvent = {
    name: span.name || 'unnamed',
    spanId: normalizeHexId(span.spanId, 16),
    traceId: normalizeHexId(span.traceId, 32),
    parentSpanId: span.parentSpanId
      ? normalizeHexId(span.parentSpanId, 16)
      : undefined,
    startTime,
    endTime,
    durationMs: Math.max(0, endTime - startTime),
    status: mapStatus(span.status?.code),
    kind: mapKind(span.kind),
    attributes: mergedAttrs,
  };
  if (parsedEvents) collected.events = parsedEvents;
  if (parsedLinks) collected.links = parsedLinks;
  return collected;
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalLength = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += buf.length;
    if (totalLength > MAX_BODY_BYTES) {
      throw new Error(`Body exceeds ${MAX_BODY_BYTES} byte limit`);
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export function sendJson(
  res: ServerResponse,
  status: number,
  data: OtlpAttributes,
): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
}

export function parseOtlpEvents(payload: unknown): TerminalSpanEvent[] {
  const events: TerminalSpanEvent[] = [];
  for (const { span, resourceAttrs } of extractSpans(payload)) {
    events.push(otlpSpanToTerminalEvent(span, resourceAttrs));
  }
  return events;
}

// --- OTLP Log parsing ---

type OtlpLogRecord = {
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
  severityNumber?: number;
  severityText?: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
  traceId?: string;
  spanId?: string;
};

function mapSeverityToLevel(
  severityNumber?: number,
  severityText?: string,
): LogLevel {
  if (severityText) {
    const lower = severityText.toLowerCase();
    if (lower.startsWith('debug') || lower === 'trace') return 'debug';
    if (lower.startsWith('info')) return 'info';
    if (lower.startsWith('warn')) return 'warn';
    if (lower.startsWith('error') || lower.startsWith('fatal')) return 'error';
  }
  if (severityNumber !== undefined) {
    if (severityNumber <= 4) return 'debug';
    if (severityNumber <= 8) return 'debug';
    if (severityNumber <= 12) return 'info';
    if (severityNumber <= 16) return 'warn';
    return 'error';
  }
  return 'info';
}

function bodyToMessage(body: OtlpAnyValue | undefined): string {
  if (!body) return '';
  const value = anyValueToPrimitive(body);
  return value === undefined ? '' : String(value);
}

interface OtlpLogsExport {
  resourceLogs?: Array<{ scopeLogs?: Array<{ logRecords?: OtlpLogRecord[] }> }>;
}

function* extractLogRecords(payload: unknown): Generator<OtlpLogRecord> {
  if (!asRecord(payload)) return;
  // SAFETY: the one assertion for this walker; see OtlpTraceExport above.
  const { resourceLogs } = payload as OtlpLogsExport;
  if (!Array.isArray(resourceLogs)) return;
  for (const resourceLog of resourceLogs) {
    if (!asRecord(resourceLog)) continue;
    const scopeLogs = resourceLog.scopeLogs;
    if (!Array.isArray(scopeLogs)) continue;
    for (const scopeLog of scopeLogs) {
      if (!asRecord(scopeLog)) continue;
      const logRecords = scopeLog.logRecords;
      if (!Array.isArray(logRecords)) continue;
      for (const record of logRecords) {
        if (asRecord(record)) yield record;
      }
    }
  }
}

export function parseOtlpLogEvents(payload: unknown): TerminalLogEvent[] {
  const events: TerminalLogEvent[] = [];
  for (const record of extractLogRecords(payload)) {
    const time = toMs(record.timeUnixNano || record.observedTimeUnixNano);
    events.push({
      time,
      level: mapSeverityToLevel(record.severityNumber, record.severityText),
      message: bodyToMessage(record.body),
      traceId: record.traceId ? normalizeHexId(record.traceId, 32) : undefined,
      spanId: record.spanId ? normalizeHexId(record.spanId, 16) : undefined,
      attributes: attrsToRecord(record.attributes),
    });
  }
  return events;
}

// --- OTLP Metrics parsing (accept and count) ---

interface OtlpMetricsExport {
  resourceMetrics?: Array<{ scopeMetrics?: Array<{ metrics?: unknown[] }> }>;
}

export function countOtlpMetrics(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  let count = 0;
  // SAFETY: the one assertion for this walker; see OtlpTraceExport above.
  const { resourceMetrics } = payload as OtlpMetricsExport;
  if (!Array.isArray(resourceMetrics)) return 0;
  for (const resourceMetric of resourceMetrics) {
    if (!asRecord(resourceMetric)) continue;
    const scopeMetrics = resourceMetric.scopeMetrics;
    if (!Array.isArray(scopeMetrics)) continue;
    for (const scopeMetric of scopeMetrics) {
      if (!asRecord(scopeMetric)) continue;
      const metrics = scopeMetric.metrics;
      if (Array.isArray(metrics)) {
        count += metrics.length;
      }
    }
  }
  return count;
}
