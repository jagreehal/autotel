/**
 * Validation telemetry wire constants — the single source of truth for the
 * `validation.*` span attributes and the `autotel.validation.mismatches` metric
 * emitted when an input payload (HTTP body, event, message) fails to match its
 * declared shape.
 *
 * Dependency-free and side-effect-free by design (mirrors `security-schema.ts`):
 * safe to import from anything that only needs the constant strings — a
 * dashboard, a CLI, an alert rule — without pulling in the OpenTelemetry SDK.
 *
 * These keys are a public API for the agents that query your telemetry. Treat a
 * rename here the way you'd treat a breaking change to any other contract.
 */

export const VALIDATION_ATTR = {
  /** Contract id of the validated boundary, e.g. `POST /orders`, `order.placed`. */
  name: 'validation.name',
  /** Where validation ran: `http` | `event` | `message` | a custom label. */
  boundary: 'validation.boundary',
  /** `observe` (recorded, request continues) or `reject` (recorded, then failed). */
  mode: 'validation.mode',
  /** Stable hash of the declared shape, when a JSON-schema projection is given. */
  hash: 'validation.hash',
  /** `info` | `warning` | `error`. */
  severity: 'validation.severity',
  /** Number of failing fields. */
  issueCount: 'validation.issue.count',
  /** Comma-separated failing field paths (capped). Never contains values. */
  issuePaths: 'validation.issue.paths',
  /** Comma-separated distinct issue codes (capped). Never contains values. */
  issueCodes: 'validation.issue.codes',
} as const;

export type ValidationAttributeKey =
  (typeof VALIDATION_ATTR)[keyof typeof VALIDATION_ATTR];

export const VALIDATION_METRICS = {
  /** Counter, labelled `{ boundary, validation, mode }`. */
  mismatches: 'autotel.validation.mismatches',
} as const;

/** Max field paths / codes stamped onto a span, to bound attribute size. */
export const VALIDATION_ISSUE_CAP = 20;
