/**
 * Contract violations, read off the span that carries them.
 *
 * **The viewer takes no dependency on `autotel-schema`, deliberately.** A
 * telemetry contract is a TypeScript module in the service's own repo, so the
 * app is the only thing that can validate against it — a viewer reading
 * exported spans has no contract and never will. `autotel-schema`'s span
 * processor validates and writes the result onto the span; everything here
 * reads three attributes.
 *
 * That split is what makes this work anywhere the span lands, not just in this
 * viewer, and it is why the attribute names are part of `autotel-schema`'s
 * public surface (`SCHEMA_VIOLATION_ATTRS`) rather than a private arrangement
 * between two packages.
 */

import type { SpanData } from '../types';

/** Attribute names written by `autotel-schema`'s validation processor. */
const ATTRS = {
  count: 'autotel.schema.violations',
  severity: 'autotel.schema.violation.severity',
  codes: 'autotel.schema.violation.codes',
} as const;

export interface SpanSchemaViolations {
  count: number;
  severity: 'error' | 'warning';
  /** `code:attribute` pairs. Capped at the source, so shorter than `count`. */
  codes: string[];
}

/**
 * What this span violates, or null when it conforms.
 *
 * Null rather than a zero-count object: a conforming span carries no attribute
 * at all, so absence is the normal case and the caller should render nothing.
 */
export function schemaViolations(span: SpanData): SpanSchemaViolations | null {
  const attributes = (span.attributes ?? {}) as Record<string, unknown>;
  const raw = attributes[ATTRS.count];
  const count = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(count) || count <= 0) return null;

  const codes = attributes[ATTRS.codes];
  return {
    count,
    // Anything but a known severity is treated as the milder one: an unfamiliar
    // value most likely means a newer producer, and shouting "error" on a guess
    // is how a badge stops being trusted.
    severity: attributes[ATTRS.severity] === 'error' ? 'error' : 'warning',
    codes: Array.isArray(codes) ? codes.map(String) : [],
  };
}
