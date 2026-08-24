/**
 * Detection triage — what the human decided about a finding.
 *
 * A detection nobody answered is an alert, not a control. The number that
 * matters on any detection surface is how many findings are still untriaged,
 * and that number only exists if dispositions are recorded.
 *
 * Three properties make this evidence rather than a checkbox:
 *
 * 1. **The decision is telemetry.** It lands on the same span pipeline as the
 *    finding it answers, so it reaches the same backend and the same alerts —
 *    you can alert on a finding being risk-accepted.
 * 2. **History is append-only.** Each decision is emitted as its own correlated
 *    log record — the repo's event model, and the only one a log query can see.
 *    Span *attributes* are last-write-wins, so they carry the latest status for
 *    filtering and are useless as history; recording history in them silently
 *    loses the "false positive later became confirmed" transition.
 *
 *    Every record is keyed by rule and correlation id rather than relying on
 *    trace correlation, because a human dispositions a finding long after it
 *    fired, from a different trace. Those keys are what join the two.
 * 3. **Closing a finding costs a sentence.** `false_positive` and
 *    `risk_accepted` are refused without a note. Enforced here rather than left
 *    to whoever builds the UI, because that is where it gets dropped.
 *
 * @example
 * ```typescript
 * recordDetectionDisposition({
 *   correlationId: 'sess-1',
 *   ruleId: 'denied-then-executed',
 *   status: 'risk_accepted',
 *   note: 'known internal test harness',
 * });
 * ```
 */

import {
  createStructuredError,
  getRequestLoggerSafe,
  type RequestLogger,
} from 'autotel';
import { resolveContext, type AgentContext } from './context.js';
import { DETECTION_ATTR } from './sequence.js';

export type DetectionDispositionStatus =
  /** Nobody has looked at it yet. The number that matters. */
  | 'new'
  /** Seen, not yet worked. */
  | 'acknowledged'
  /** Under investigation. */
  | 'in_progress'
  /** Handled. */
  | 'resolved'
  /** Not a real finding. Requires a written reason. */
  | 'false_positive'
  /** Real, and we are choosing to live with it. Requires a written reason. */
  | 'risk_accepted';

/** Statuses that close a finding, and so cannot be recorded without a reason. */
const REQUIRES_NOTE: ReadonlySet<DetectionDispositionStatus> = new Set([
  'false_positive',
  'risk_accepted',
]);

/** Log-record message for one disposition. Select on this to read history. */
export const DETECTION_DISPOSITION_EVENT = 'detection.disposition';

export const DETECTION_DISPOSITION_ATTR = {
  // Taken from the detection record, not restated: a set difference over these
  // two keys is the only thing that joins a finding to its decision, and two
  // independent string literals are one rename away from silently not joining.
  correlationId: DETECTION_ATTR.correlationId,
  ruleId: DETECTION_ATTR.ruleId,
  status: 'detection.disposition.status',
  note: 'detection.disposition.note',
  supersedes: 'detection.disposition.supersedes',
} as const;

export interface RecordDetectionDispositionInput {
  ctx?: AgentContext;
  /** Override the ambient request logger (tests, or an explicit snapshot). */
  logger?: RequestLogger;
  /** Session the finding belongs to. */
  correlationId: string;
  /** Rule that fired, e.g. `'denied-then-executed'`. */
  ruleId: string;
  status: DetectionDispositionStatus;
  /** Why. Required for `false_positive` and `risk_accepted`. */
  note?: string;
  /** The status this one replaces, when a decision is being reversed. */
  supersedes?: DetectionDispositionStatus;
}

/**
 * Record a triage decision on the current span.
 *
 * @throws when a closing status arrives without a note.
 */
export function recordDetectionDisposition(
  input: RecordDetectionDispositionInput,
): void {
  const note = input.note?.trim();
  if (REQUIRES_NOTE.has(input.status) && !note) {
    throw createStructuredError({
      name: 'DetectionDispositionError',
      code: 'DETECTION_DISPOSITION_NOTE_REQUIRED',
      message: `Disposition "${input.status}" requires a note explaining the decision.`,
      why: 'Closing a finding without a reason leaves no record of why it was safe to close, which is the one thing a later reader needs.',
      fix: 'Pass `note` with a sentence saying why this finding is not a risk, or use a status that leaves the finding open.',
    });
  }

  const attributes = {
    [DETECTION_DISPOSITION_ATTR.correlationId]: input.correlationId,
    [DETECTION_DISPOSITION_ATTR.ruleId]: input.ruleId,
    [DETECTION_DISPOSITION_ATTR.status]: input.status,
    ...(note && { [DETECTION_DISPOSITION_ATTR.note]: note }),
    ...(input.supersedes && {
      [DETECTION_DISPOSITION_ATTR.supersedes]: input.supersedes,
    }),
  };

  // The log record is the history: one per decision, so a reversal keeps both
  // halves and a log query can actually read them. Resolved before anything is
  // written, because a span attribute saying "resolved" with no record of who
  // decided or why is worse than no answer.
  const logger = input.logger ?? getRequestLoggerSafe();
  if (!logger) {
    throw createStructuredError({
      name: 'DetectionDispositionError',
      code: 'DETECTION_DISPOSITION_NO_LOGGER',
      message: 'No request logger is available to record this disposition.',
      why: 'The decision itself is the durable half of a disposition. Without a logger it would be dropped while the span still claimed the new status, leaving a finding that looks answered by nobody.',
      fix: 'Call this inside a request-scoped trace, or pass `logger` explicitly (a no-op logger if you genuinely intend to discard the record).',
    });
  }

  // Resolve the span too, before writing anything. `resolveContext` throws
  // without one, and a record written ahead of that throw is duplicated by the
  // retry — history showing two decisions where a person made one.
  const ctx = resolveContext(input.ctx);

  logger.info(DETECTION_DISPOSITION_EVENT, attributes);
  // The attributes are the *current* state, for filtering spans by status.
  ctx.setAttributes(attributes);
}
