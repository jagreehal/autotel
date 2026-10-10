/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- This is where a backend's raw attribute bag becomes canonical tags. The input is unread JSON and the output is an open tag map, because an attribute set is not a fixed field list. */

import type { SpanStatusCode, TagValue } from '../types';
import { asNumber, asTagValue } from '../lib/values';
import { primaryException } from 'autotel-devtools/issues';

/**
 * Shared helpers for mapping raw backend payloads into the canonical
 * `SpanRecord` shape. Trace backends (Jaeger, devtools, …) all receive spans
 * with loosely-typed attributes and must reconstruct tags + OTel status the
 * same way; this is the single home for that logic so the rules don't drift
 * per backend.
 */

/** Coerce an arbitrary attribute value into a flat tag value. */
export function normalizeTagValue(value: unknown): TagValue {
  return asTagValue(value) ?? String(value);
}

/** Coerce a record of raw attributes into flat tags. */
export function normalizeTags(
  attributes: Record<string, unknown> | undefined,
): Record<string, TagValue> {
  const tags: Record<string, TagValue> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    tags[key] = normalizeTagValue(value);
  }
  return tags;
}

const SPAN_KINDS = ['internal', 'server', 'client', 'producer', 'consumer'];

/**
 * `span.kind` as a tag (`server`, `client`...), the name Jaeger already uses,
 * from an OTLP enum number (1-5), an OTLP JSON name (`SPAN_KIND_SERVER`) or
 * a plain one (`SERVER`). Empty when the kind is unspecified or unknown.
 */
export function spanKindTag(kind: unknown): Record<string, TagValue> {
  const name =
    typeof kind === 'number'
      ? SPAN_KINDS[kind - 1]
      : typeof kind === 'string'
        ? kind.toLowerCase().replace(/^span_kind_/, '')
        : undefined;
  return name !== undefined && SPAN_KINDS.includes(name)
    ? { 'span.kind': name }
    : {};
}

/** Read a tag as a finite number, parsing numeric strings. */
export function readNumericTag(
  value: TagValue | undefined,
): number | undefined {
  return asNumber(value);
}

/**
 * Infer an error status from span tags. Returns `'ERROR'` when a recognised
 * error signal is present, otherwise `'UNSET'` — never `'OK'`, since the
 * absence of an error signal is not positive confirmation of success. Callers
 * that can prove success (an explicit OTel status, a 2xx/3xx code) layer that
 * on top of this result.
 */
export function inferErrorStatusFromTags(
  tags: Record<string, TagValue>,
): SpanStatusCode {
  if (tags['error'] === true || tags['error.kind'] !== undefined) {
    return 'ERROR';
  }

  const httpStatus = readNumericTag(
    tags['http.response.status_code'] ?? tags['http.status_code'],
  );
  if (httpStatus !== undefined && httpStatus >= 500) {
    return 'ERROR';
  }

  const grpcStatus = readNumericTag(tags['rpc.grpc.status_code']);
  if (grpcStatus !== undefined && grpcStatus !== 0) {
    return 'ERROR';
  }

  return 'UNSET';
}

/**
 * Tags a span's `exception` event and status message contribute: type,
 * message and stacktrace live on the event in OTel, not the attributes, and
 * issue grouping needs them. Span attributes win on a clash.
 */
export function exceptionTags(
  events:
    Array<{ name?: string; attributes?: Record<string, unknown> }> | undefined,
  statusMessage: string | undefined,
): Record<string, TagValue> {
  // Same choice as the issue core: a detector report outranks the first one.
  const exception = primaryException(events);
  return {
    ...(statusMessage ? { 'otel.status_description': statusMessage } : {}),
    ...normalizeTags(exception?.attributes),
  };
}
