import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TerminalSpanEvent } from './span-stream';
import type { TerminalLogEvent, LogLevel } from './lib/log-model';

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
};

function anyValueToPrimitive(value: OtlpAnyValue | undefined): unknown {
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

function attrsToRecord(
  attributes: OtlpKeyValue[] | undefined,
): Record<string, unknown> {
  if (!attributes || attributes.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const attribute of attributes) {
    out[attribute.key] = anyValueToPrimitive(attribute.value);
  }
  return out;
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
  const normalized = typeof code === 'string' ? code.toUpperCase() : code;
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
  if (typeof kind === 'string') return kind.toUpperCase();
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

function* extractSpans(payload: unknown): Generator<OtlpSpan> {
  if (!payload || typeof payload !== 'object') return;
  const resourceSpans = (payload as { resourceSpans?: unknown[] })
    .resourceSpans;
  if (!Array.isArray(resourceSpans)) return;
  for (const resourceSpan of resourceSpans) {
    if (!resourceSpan || typeof resourceSpan !== 'object') continue;
    const scopeSpans = (resourceSpan as { scopeSpans?: unknown[] }).scopeSpans;
    if (!Array.isArray(scopeSpans)) continue;
    for (const scopeSpan of scopeSpans) {
      if (!scopeSpan || typeof scopeSpan !== 'object') continue;
      const spans = (scopeSpan as { spans?: unknown[] }).spans;
      if (!Array.isArray(spans)) continue;
      for (const span of spans) {
        if (span && typeof span === 'object') {
          yield span as OtlpSpan;
        }
      }
    }
  }
}

export function otlpSpanToTerminalEvent(span: OtlpSpan): TerminalSpanEvent {
  const startTime = toMs(span.startTimeUnixNano);
  const endTime = toMs(span.endTimeUnixNano);
  return {
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
    attributes: attrsToRecord(span.attributes),
  };
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
  data: Record<string, unknown>,
): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
}

export function parseOtlpEvents(payload: unknown): TerminalSpanEvent[] {
  const events: TerminalSpanEvent[] = [];
  for (const span of extractSpans(payload)) {
    events.push(otlpSpanToTerminalEvent(span));
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

function* extractLogRecords(payload: unknown): Generator<OtlpLogRecord> {
  if (!payload || typeof payload !== 'object') return;
  const resourceLogs = (payload as { resourceLogs?: unknown[] }).resourceLogs;
  if (!Array.isArray(resourceLogs)) return;
  for (const resourceLog of resourceLogs) {
    if (!resourceLog || typeof resourceLog !== 'object') continue;
    const scopeLogs = (resourceLog as { scopeLogs?: unknown[] }).scopeLogs;
    if (!Array.isArray(scopeLogs)) continue;
    for (const scopeLog of scopeLogs) {
      if (!scopeLog || typeof scopeLog !== 'object') continue;
      const logRecords = (scopeLog as { logRecords?: unknown[] }).logRecords;
      if (!Array.isArray(logRecords)) continue;
      for (const record of logRecords) {
        if (record && typeof record === 'object') {
          yield record as OtlpLogRecord;
        }
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

export function countOtlpMetrics(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  let count = 0;
  const resourceMetrics = (payload as { resourceMetrics?: unknown[] })
    .resourceMetrics;
  if (!Array.isArray(resourceMetrics)) return 0;
  for (const resourceMetric of resourceMetrics) {
    if (!resourceMetric || typeof resourceMetric !== 'object') continue;
    const scopeMetrics = (resourceMetric as { scopeMetrics?: unknown[] })
      .scopeMetrics;
    if (!Array.isArray(scopeMetrics)) continue;
    for (const scopeMetric of scopeMetrics) {
      if (!scopeMetric || typeof scopeMetric !== 'object') continue;
      const metrics = (scopeMetric as { metrics?: unknown[] }).metrics;
      if (Array.isArray(metrics)) {
        count += metrics.length;
      }
    }
  }
  return count;
}
