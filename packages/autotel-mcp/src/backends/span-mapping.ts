import type { SpanStatusCode, TagValue } from '../types';

/**
 * Shared helpers for mapping raw backend payloads into the canonical
 * `SpanRecord` shape. Trace backends (Jaeger, devtools, …) all receive spans
 * with loosely-typed attributes and must reconstruct tags + OTel status the
 * same way; this is the single home for that logic so the rules don't drift
 * per backend.
 */

/** Coerce an arbitrary attribute value into a flat tag value. */
export function normalizeTagValue(value: unknown): TagValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return String(value);
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

/** Read a tag as a finite number, parsing numeric strings. */
export function readNumericTag(
  value: TagValue | undefined,
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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

  const httpStatus = readNumericTag(tags['http.status_code']);
  if (httpStatus !== undefined && httpStatus >= 500) {
    return 'ERROR';
  }

  const grpcStatus = readNumericTag(tags['rpc.grpc.status_code']);
  if (grpcStatus !== undefined && grpcStatus !== 0) {
    return 'ERROR';
  }

  return 'UNSET';
}
