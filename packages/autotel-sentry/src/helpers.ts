/**
 * Helpers for mapping OpenTelemetry spans to Sentry transactions/spans and context.
 * Aligned with Sentry's OpenTelemetry integration spec.
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import {
  SEMATTRS_HTTP_URL,
  SEMATTRS_HTTP_STATUS_CODE,
  SEMATTRS_RPC_GRPC_STATUS_CODE,
  SEMATTRS_EXCEPTION_MESSAGE,
  SEMATTRS_EXCEPTION_STACKTRACE,
  SEMATTRS_EXCEPTION_TYPE,
} from '@opentelemetry/semantic-conventions';

/** Sentry span status strings per their spec (maps to gRPC-style codes). */
export type SentrySpanStatus =
  | 'ok'
  | 'cancelled'
  | 'unknown_error'
  | 'invalid_argument'
  | 'deadline_exceeded'
  | 'not_found'
  | 'already_exists'
  | 'permission_denied'
  | 'resource_exhausted'
  | 'failed_precondition'
  | 'aborted'
  | 'out_of_range'
  | 'unimplemented'
  | 'internal_error'
  | 'unavailable'
  | 'data_loss'
  | 'unauthenticated';

export interface ParsedSpanDescription {
  op: string;
  description: string;
}

/** OTel timestamps are typically in nanoseconds (HrTime or number). */
export function convertOtelTimeToSeconds(time: number | [number, number]): number {
  if (Array.isArray(time)) {
    return time[0] + time[1] / 1e9;
  }
  return time / 1e9;
}

const CANONICAL_HTTP_MAP: Record<string, SentrySpanStatus> = {
  '400': 'failed_precondition',
  '401': 'unauthenticated',
  '403': 'permission_denied',
  '404': 'not_found',
  '409': 'aborted',
  '429': 'resource_exhausted',
  '499': 'cancelled',
  '500': 'internal_error',
  '501': 'unimplemented',
  '503': 'unavailable',
  '504': 'deadline_exceeded',
};

const CANONICAL_GRPC_MAP: Record<string, SentrySpanStatus> = {
  '1': 'cancelled',
  '2': 'unknown_error',
  '3': 'invalid_argument',
  '4': 'deadline_exceeded',
  '5': 'not_found',
  '6': 'already_exists',
  '7': 'permission_denied',
  '8': 'resource_exhausted',
  '9': 'failed_precondition',
  '10': 'aborted',
  '11': 'out_of_range',
  '12': 'unimplemented',
  '13': 'internal_error',
  '14': 'unavailable',
  '15': 'data_loss',
  '16': 'unauthenticated',
};

export function mapOtelStatus(otelSpan: ReadableSpan): SentrySpanStatus {
  const { status, attributes } = otelSpan;
  const code = status.code;

  if (code !== undefined && (code < 0 || code > 2)) {
    return 'unknown_error';
  }

  if (code === 0 || code === 1) {
    return 'ok';
  }

  const httpCode = attributes[SEMATTRS_HTTP_STATUS_CODE];
  const grpcCode = attributes[SEMATTRS_RPC_GRPC_STATUS_CODE];

  if (typeof httpCode === 'string') {
    const sentryStatus = CANONICAL_HTTP_MAP[httpCode];
    if (sentryStatus) return sentryStatus;
  }
  if (typeof httpCode === 'number') {
    const sentryStatus = CANONICAL_HTTP_MAP[String(httpCode)];
    if (sentryStatus) return sentryStatus;
  }

  if (typeof grpcCode === 'string') {
    const sentryStatus = CANONICAL_GRPC_MAP[grpcCode];
    if (sentryStatus) return sentryStatus;
  }

  return 'unknown_error';
}

/** Derive Sentry op and description from OTel span name, kind, and attributes. */
export function parseSpanDescription(otelSpan: ReadableSpan): ParsedSpanDescription {
  const { name, kind, attributes } = otelSpan;
  const description = name || 'unknown';

  const spanKind = kind ?? 0;
  const isHttp = spanKind === 2 || attributes['http.method'] != null;
  const isDb =
    attributes['db.system'] != null ||
    attributes['db.operation'] != null ||
    attributes['db.statement'] != null;

  let op = 'default';
  if (isHttp) {
    op = 'http.client';
    const method = attributes['http.method'];
    const route = attributes['http.route'] ?? attributes['http.target'];
    if (method && route) op = 'http.server';
  } else if (isDb) {
    op = 'db.query';
  }

  return { op, description };
}

export interface TraceData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export function getTraceData(otelSpan: ReadableSpan): TraceData {
  const ctx = otelSpan.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: otelSpan.parentSpanContext?.spanId,
  };
}

/** Check if the span represents a request to Sentry (ingestion); such spans must not be sent to Sentry. */
export function isSentryRequestSpan(
  otelSpan: ReadableSpan,
  getDsnHost: () => string | undefined,
): boolean {
  const httpUrl = otelSpan.attributes[SEMATTRS_HTTP_URL];
  if (httpUrl == null) return false;
  const url = typeof httpUrl === 'string' ? httpUrl : String(httpUrl);
  const host = getDsnHost();
  if (!host) return false;
  return url.includes(host);
}

/** Attributes and resource for Sentry's otel context. */
export function getOtelContextFromSpan(otelSpan: ReadableSpan): {
  attributes: Record<string, unknown>;
  resource: Record<string, unknown>;
} {
  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(otelSpan.attributes)) {
    attributes[k] = v;
  }
  const resource: Record<string, unknown> = {};
  const res = otelSpan.resource;
  if (res && res.attributes) {
    for (const [k, v] of Object.entries(res.attributes)) {
      resource[k] = v;
    }
  }
  return { attributes, resource };
}

/** Update a Sentry span with OTel span data (status, op, description, data). */
export function updateSpanWithOtelData(
  sentrySpan: { setStatus: (s: { status?: string }) => void; setData: (k: string, v: unknown) => void; op?: string; description?: string },
  otelSpan: ReadableSpan,
): void {
  const status = mapOtelStatus(otelSpan);
  sentrySpan.setStatus({ status });
  sentrySpan.setData('otel.kind', otelSpan.kind ?? 0);
  for (const [key, value] of Object.entries(otelSpan.attributes)) {
    sentrySpan.setData(key, value);
  }
  const { op, description } = parseSpanDescription(otelSpan);
  sentrySpan.op = op;
  sentrySpan.description = description;
}

/** Update a Sentry transaction with OTel span data. */
export function updateTransactionWithOtelData(
  transaction: { setStatus: (s: { status?: string }) => void; op?: string; name?: string },
  otelSpan: ReadableSpan,
): void {
  const status = mapOtelStatus(otelSpan);
  transaction.setStatus({ status });
  const { op, description } = parseSpanDescription(otelSpan);
  transaction.op = op;
  transaction.name = description;
}

/** Set otel context on transaction and finish it. */
export function finishTransactionWithContextFromOtelData(
  transaction: {
    setContext: (name: string, ctx: { attributes?: Record<string, unknown>; resource?: Record<string, unknown> }) => void;
    finish: (endTime?: number) => void;
  },
  otelSpan: ReadableSpan,
): void {
  const { attributes, resource } = getOtelContextFromSpan(otelSpan);
  transaction.setContext('otel', { attributes, resource });
  transaction.finish(convertOtelTimeToSeconds(otelSpan.endTime));
}

/** Build synthetic Error from OTel exception event attributes and capture with Sentry. */
export function generateSentryErrorsFromOtelSpan(
  otelSpan: ReadableSpan,
  captureException: (error: Error, options?: { contexts?: Record<string, unknown> }) => void,
): void {
  const events = otelSpan.events ?? [];
  for (const event of events) {
    if (event.name !== 'exception') continue;
    const attrs = event.attributes ?? {};
    const message = (attrs[SEMATTRS_EXCEPTION_MESSAGE] as string) ?? 'Unknown error';
    const stack = (attrs[SEMATTRS_EXCEPTION_STACKTRACE] as string) ?? '';
    const type = (attrs[SEMATTRS_EXCEPTION_TYPE] as string) ?? 'Error';

    const synthetic = new Error(message);
    synthetic.name = type;
    if (stack) synthetic.stack = stack;

    const { attributes, resource } = getOtelContextFromSpan(otelSpan);
    captureException(synthetic, {
      contexts: {
        otel: { attributes, resource },
        trace: {
          trace_id: otelSpan.spanContext().traceId,
          span_id: otelSpan.spanContext().spanId,
          parent_span_id: otelSpan.parentSpanContext?.spanId,
        },
      },
    });
  }
}
