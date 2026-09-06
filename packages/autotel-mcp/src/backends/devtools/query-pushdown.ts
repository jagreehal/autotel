/**
 * Compiles a structured `TraceSearchQuery` into devtools query-language text.
 *
 * devtools now answers queries server-side against its whole retained history,
 * so a filter expressed here runs as SQL rather than as a JavaScript pass over
 * the hundred-trace live tail. That is the difference between "the last hundred
 * traces, filtered" and "every trace we kept, filtered".
 *
 * Only predicates that the canonical matcher requires on the same span are
 * emitted. Trace duration, status, errors and generic filters are evaluated
 * after hydration; combining them here could exclude a valid trace when
 * different spans satisfy different predicates.
 */

import { tagKind } from '../../lib/values';
import type { TagValue, TraceSearchQuery } from '../../types';

export function compileTraceQuery(query: TraceSearchQuery): string {
  const clauses: string[] = [];

  if (query.service) clauses.push(`service = ${literal(query.service)}`);
  if (query.operation) clauses.push(`name = ${literal(query.operation)}`);

  for (const [key, value] of Object.entries(query.tags ?? {})) {
    if (value === undefined || value === null) continue;
    clauses.push(`${quote(key)} = ${literal(value)}`);
  }

  return clauses.join(' AND ');
}

/** A value as query-language source: numbers and booleans bare, text quoted. */
function literal(value: TagValue): string {
  // `tagKind` reports `number` only for a finite one, so an infinity or a NaN
  // falls through to the quoted form rather than emitting bare `Infinity`.
  const kind = tagKind(value);
  return kind === 'number' || kind === 'boolean'
    ? String(value)
    : quote(String(value));
}

/**
 * Quote a string for the query language.
 *
 * Used for field names as well as values: the language accepts a quoted string
 * as a field name precisely so arbitrary attribute keys — which may contain
 * spaces, dots or operator characters — can be named at all.
 */
function quote(text: string): string {
  return `"${text.replace(/\\/g, String.raw`\\`).replace(/"/g, String.raw`\"`)}"`;
}
