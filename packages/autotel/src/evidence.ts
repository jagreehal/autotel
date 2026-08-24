/**
 * Evidence quality — say what a trace could not see.
 *
 * A span with no `gen_ai.usage.cost.usd` and a span with an estimated one look
 * identical to a reader who only sees the number; a trace missing tool calls
 * because none happened looks identical to one missing them because this
 * process cannot observe them. Both are the same failure: a record that reads
 * as complete because it has a start and an end.
 *
 * Two vocabularies fix that, and both travel on the span itself, so they reach
 * whichever backend the spans reach:
 *
 * - {@link recordEvidence} labels one *field*: `autotel.evidence.cost =
 *   'estimated'`, `autotel.evidence.input = 'truncated'`.
 * - {@link captureCoverageAttributes} declares, once per process, which capture
 *   *surfaces* the deployment can and cannot see at all.
 *
 * The absence of a label means unknown. Nothing here asserts completeness —
 * the vocabulary only ever narrows a claim.
 *
 * @example
 * ```typescript
 * import { init } from 'autotel';
 * import { captureCoverageAttributes, recordEvidence } from 'autotel/evidence';
 *
 * init({
 *   serviceName: 'agent',
 *   resourceAttributes: captureCoverageAttributes({
 *     observed: ['llm_calls', 'tool_calls', 'network'],
 *     unobserved: ['ide_context', 'subprocess', 'file_io'],
 *   }),
 * });
 * ```
 */

import type { Attributes } from '@opentelemetry/api';

/**
 * Why a recorded fact is the way it is.
 *
 * There is deliberately no `unknown` member: a field carrying no evidence label
 * is already unknown, and encoding that as a value invites code that treats an
 * unlabelled field as *verified* unknown rather than simply unexamined.
 */
export type EvidenceQuality =
  /** The instrumentation saw the value directly. */
  | 'observed'
  /** Derived from other observed facts, not seen. */
  | 'inferred'
  /** Computed from a price table, heuristic, or model — not reported upstream. */
  | 'estimated'
  /** Seen, then cut short. What is here is real; what is missing is not. */
  | 'truncated'
  /** Seen, then removed before storage. */
  | 'redacted'
  /** Expected here and not present — a real gap in an observable place. */
  | 'absent'
  /** This process cannot see it at all, so its absence proves nothing. */
  | 'unobservable';

/** Prefix for per-field evidence labels. */
export const EVIDENCE_ATTR_PREFIX = 'autotel.evidence.';

/** The span attribute key carrying `field`'s evidence label. */
export function evidenceAttribute(field: string): string {
  return `${EVIDENCE_ATTR_PREFIX}${field}`;
}

/** The one thing {@link recordEvidence} needs — any `TraceContext` or `Span`. */
export interface EvidenceTarget {
  setAttribute(key: string, value: string): void;
}

/** Label how `field` on this span came to be. */
export function recordEvidence(
  ctx: EvidenceTarget,
  field: string,
  quality: EvidenceQuality,
): void {
  ctx.setAttribute(evidenceAttribute(field), quality);
}

/**
 * The capture surfaces a deployment can be asked about. Closed set, because the
 * point is that a backend can query `unobserved` across services and get
 * comparable answers.
 */
export const CAPTURE_SURFACES = [
  'llm_calls',
  'tool_calls',
  'user_prompts',
  'file_io',
  'subprocess',
  'network',
  'ide_context',
] as const;

export type CaptureSurface = (typeof CAPTURE_SURFACES)[number];

/** What this process can and cannot see. Anything in neither list is unknown. */
export interface CaptureCoverage {
  observed: readonly CaptureSurface[];
  unobserved: readonly CaptureSurface[];
}

export const CAPTURE_COVERAGE_ATTR = {
  observed: 'autotel.coverage.observed',
  unobserved: 'autotel.coverage.unobserved',
} as const;

/**
 * Resource attributes declaring {@link CaptureCoverage}.
 *
 * An empty list is omitted rather than emitted: `unobserved: []` would read as
 * "this process has no blind spots", which is a stronger claim than declaring
 * nothing. A surface claimed as both is dropped from both — a contradiction
 * that left `observed` intact would let a reader conclude a gap does not exist.
 */
export function captureCoverageAttributes(
  coverage: CaptureCoverage,
): Attributes {
  const claimedBoth = new Set(
    coverage.observed.filter((s) => coverage.unobserved.includes(s)),
  );
  const keep = (surfaces: readonly CaptureSurface[]): CaptureSurface[] => [
    ...new Set(surfaces.filter((s) => !claimedBoth.has(s))),
  ];

  const observed = keep(coverage.observed);
  const unobserved = keep(coverage.unobserved);

  return {
    ...(observed.length > 0 && {
      [CAPTURE_COVERAGE_ATTR.observed]: observed,
    }),
    ...(unobserved.length > 0 && {
      [CAPTURE_COVERAGE_ATTR.unobserved]: unobserved,
    }),
  };
}
