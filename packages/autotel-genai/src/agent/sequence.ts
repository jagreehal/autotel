/**
 * Ordered sequence detection — what a run of tool calls means, not what one is.
 *
 * A single event is rarely an incident. Reading a credential is normal; making
 * a network call is normal; doing the second right after the first is the thing
 * worth waking someone for. That signal only exists inside a session boundary,
 * which is exactly what host- and process-level tooling never had.
 *
 * Rules are **ordered steps within one session**, never a threshold on one row.
 * `untrusted-input-then-exfiltration` requires untrusted content to arrive
 * *before* the exfil-capable action; reversed, it does not fire. That property
 * is the whole claim, so the benign half of the test corpus checks it directly.
 *
 * Events are label sets (`"key=value"` strings) rather than spans, so the engine
 * stays free of the OTel SDK and can run over live steps, recorded spans, or a
 * replayed fixture. {@link ./forensic} adapts spans into this shape.
 *
 * @example
 * ```typescript
 * import { SEQUENCE_RULES, detectSequences } from 'autotel-genai/agent';
 *
 * const findings = detectSequences(sessionEvents, SEQUENCE_RULES);
 * // → [{ ruleId: 'denied-then-executed', severity: 'critical', … }]
 * ```
 */

import { getRequestLoggerSafe, type RequestLogger } from 'autotel';
import { SECURITY_ATTR } from 'autotel/security-schema';
import { securityEvent, type OnMissingContext } from 'autotel-audit';
import { AGENT_SECURITY_ATTR } from './agent-security.js';
import type { AgentContext } from './context.js';

export type SequenceSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Canonical label keys the rules match on.
 *
 * The agent-governance layer writes `tool.name` while the MCP layer writes
 * `gen_ai.tool.name`; both mean the same thing and a label set can only carry
 * one. {@link spansToSequenceEvents} folds the MCP spelling onto this one.
 */
export const TOOL_NAME_LABEL = 'tool.name';
export const TOOL_CALL_ID_LABEL = 'tool.call.id';

/** Log-record message carrying one finding. */
export const DETECTION_EVENT = 'agent.sequence.detected';

/**
 * Flat keys every detection record carries.
 *
 * A finding and the human decision about it are separate records, normally in
 * separate traces — a disposition is made hours later. Trace correlation cannot
 * join them, so both sides emit these two keys and the join happens on them.
 * They are deliberately not nested: a JSON blob under one attribute is not a
 * join key.
 */
export const DETECTION_ATTR = {
  correlationId: 'detection.correlation_id',
  ruleId: 'detection.rule_id',
  severity: 'detection.severity',
  firstAt: 'detection.first_at',
  lastAt: 'detection.last_at',
  steps: 'detection.steps',
} as const;
export const AGENT_OUTCOME_LABEL = 'agent.outcome';
export const POLICY_DECISION_LABEL = 'policy.decision';

/** One step of a session, reduced to the labels a rule can match on. */
export interface SequenceEvent {
  /** Session / correlation id. Rules only ever match within one of these. */
  sessionId: string;
  /** Epoch ms. Events are sorted by this before matching. */
  timestamp: number;
  /** `"key=value"` labels this step carries. */
  labels: readonly string[];
}

export interface SequenceRule {
  id: string;
  severity: SequenceSeverity;
  /** What the pattern means, carried onto the finding for whoever triages it. */
  description: string;
  /** Ordered steps. A step is satisfied by an event carrying **all** its labels. */
  steps: readonly (readonly string[])[];
  /** Max ms from first to last matched step. Omitted = unbounded. */
  withinMs?: number;
  /**
   * Label prefix(es) every matched step must agree on. Without one, "denied
   * then executed" fires when a human denies one tool and an unrelated one
   * succeeds — which is most sessions.
   *
   * A list is tried in order and the first the *first step* carries is used,
   * because runtimes label the same fact differently: a governance approval
   * names the tool, while a Cloudflare `tool:approval` event carries only the
   * call id. Ordered most to least general, so a retry under a fresh call id
   * still correlates by tool name where the name is present.
   */
  correlateBy?: string | readonly string[];
}

export interface SequenceDetection {
  ruleId: string;
  severity: SequenceSeverity;
  description: string;
  sessionId: string;
  /** Timestamp of each matched step, in order, so a human can find them. */
  matchedAt: number[];
  firstAt: number;
  lastAt: number;
}

const SEVERITY_RANK: Record<SequenceSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

function satisfies(event: SequenceEvent, step: readonly string[]): boolean {
  return step.every((label) => event.labels.includes(label));
}

/** The value a step carries for `correlateBy`, or undefined if it carries none. */
function correlationValue(
  event: SequenceEvent,
  prefix: string,
): string | undefined {
  return event.labels.find((label) => label.startsWith(prefix));
}

/**
 * Try to complete `rule` starting at `start`. Returns the matched timestamps,
 * or undefined. `events` must be sorted by timestamp — the window check gives
 * up on an anchor as soon as one candidate is out of range, which is only sound
 * if everything after it is further out still.
 *
 * Restarts the walk at every event matching step 0, so worst case is
 * O(events² × steps). Sessions are tens to low hundreds of steps, and the
 * single-pass alternative is wrong: anchoring greedily on the first candidate
 * abandons a real chain whenever that candidate's window expires first.
 */
function matchFrom(
  events: SequenceEvent[],
  start: number,
  rule: SequenceRule,
): number[] | undefined {
  const anchor = events[start];
  if (!anchor) return undefined;

  const candidates =
    rule.correlateBy === undefined
      ? []
      : typeof rule.correlateBy === 'string'
        ? [rule.correlateBy]
        : rule.correlateBy;
  // Use the first key the anchor actually carries; a rule that correlates
  // cannot match an anchor carrying nothing to correlate on.
  const prefix = candidates.find(
    (key) => correlationValue(anchor, key) !== undefined,
  );
  const correlation = prefix ? correlationValue(anchor, prefix) : undefined;
  if (candidates.length > 0 && correlation === undefined) return undefined;

  const matchedAt: number[] = [anchor.timestamp];
  let stepIndex = 1;

  for (
    let i = start + 1;
    i < events.length && stepIndex < rule.steps.length;
    i++
  ) {
    const event = events[i];
    const step = rule.steps[stepIndex];
    if (!event || !step) continue;
    if (!satisfies(event, step)) continue;
    if (
      prefix !== undefined &&
      correlationValue(event, prefix) !== correlation
    ) {
      continue;
    }
    if (
      rule.withinMs !== undefined &&
      event.timestamp - anchor.timestamp > rule.withinMs
    ) {
      // Every later event is further out still; this anchor cannot complete.
      return undefined;
    }
    matchedAt.push(event.timestamp);
    stepIndex += 1;
  }

  return stepIndex === rule.steps.length ? matchedAt : undefined;
}

function detectInSession(
  events: SequenceEvent[],
  rule: SequenceRule,
): SequenceDetection | undefined {
  const first = rule.steps[0];
  if (!first) return undefined;

  for (const [index, event] of events.entries()) {
    if (!satisfies(event, first)) continue;
    const matchedAt = matchFrom(events, index, rule);
    if (!matchedAt) continue;
    return {
      ruleId: rule.id,
      severity: rule.severity,
      description: rule.description,
      sessionId: event.sessionId,
      matchedAt,
      // The anchor is the first matched step, by construction.
      firstAt: event.timestamp,
      lastAt: matchedAt.at(-1) ?? event.timestamp,
    };
  }
  return undefined;
}

/**
 * Run `rules` over `events`, grouped by session and ordered by time.
 *
 * At most one finding per rule per session — a rule that fired is a fact about
 * the session, and repeating it per matching pair buries the other findings.
 * Results are ranked most severe first.
 */
export function detectSequences(
  events: readonly SequenceEvent[],
  rules: readonly SequenceRule[],
): SequenceDetection[] {
  const bySession = new Map<string, SequenceEvent[]>();
  for (const event of events) {
    const bucket = bySession.get(event.sessionId);
    if (bucket) bucket.push(event);
    else bySession.set(event.sessionId, [event]);
  }

  const detections: SequenceDetection[] = [];
  for (const sessionEvents of bySession.values()) {
    const ordered = sessionEvents.toSorted((a, b) => a.timestamp - b.timestamp);
    for (const rule of rules) {
      const detection = detectInSession(ordered, rule);
      if (detection) detections.push(detection);
    }
  }

  return detections.toSorted(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.firstAt - b.firstAt,
  );
}

/**
 * Starter rules, built from the attribute keys the agent surface actually
 * emits — never from string literals, which is how the first version of this
 * file came to correlate on `gen_ai.tool.name` and match `tool.outcome`, one of
 * which the MCP layer emits and the other of which nothing emits at all. A rule
 * that matches labels nothing sets is decoration.
 *
 * Feed them events from {@link spansToSequenceEvents}, which normalises the two
 * tool-name vocabularies onto one label.
 *
 * Thresholds and windows are deliberately absent or generous here. Tune them
 * against your own traffic in the first weeks; shipped defaults are a starting
 * point, not a policy.
 */
export const SEQUENCE_RULES: readonly SequenceRule[] = [
  {
    id: 'untrusted-input-then-exfiltration',
    severity: 'high',
    description:
      'Externally-authored content was ingested, then an exfiltration-capable action ran. The request may look entirely legitimate — this is the shape prompt- and data-injection take once the guardrails have passed.',
    steps: [
      [`${AGENT_SECURITY_ATTR.inputProvenance}=external_untrusted`],
      [`${AGENT_SECURITY_ATTR.actionRiskClass}=exfiltration_capable`],
    ],
  },
  {
    id: 'denied-then-executed',
    severity: 'critical',
    description:
      'A human denied a gated tool and the same tool later ran successfully. Whatever the route around the gate was, the gate did not hold.',
    correlateBy: [`${TOOL_NAME_LABEL}=`, `${TOOL_CALL_ID_LABEL}=`],
    steps: [
      [`${AGENT_SECURITY_ATTR.consentOutcome}=denied`],
      [`${AGENT_OUTCOME_LABEL}=success`],
    ],
  },
  {
    id: 'policy-denied-then-destructive',
    severity: 'critical',
    description:
      'A policy denied a tool and that same tool then ran destructively. The automated gate did not hold — the human-gate equivalent is `denied-then-executed`.',
    // Without this the rule fires whenever any denial is followed by any
    // destructive action, which describes an ordinary session.
    correlateBy: [`${TOOL_NAME_LABEL}=`, `${TOOL_CALL_ID_LABEL}=`],
    steps: [
      [`${POLICY_DECISION_LABEL}=deny`],
      [`${AGENT_SECURITY_ATTR.actionRiskClass}=destructive`],
    ],
  },
];

/**
 * A sequence finding as a security event, so detections reach the same sinks
 * as everything else `autotel-audit` emits.
 *
 * Declared as a type alias, not an interface, for the same reason as
 * {@link ./cross-agent-detect}: `securityEvent()` takes a metadata type with an
 * index signature, which TypeScript grants type aliases and never interfaces.
 */
export type SequenceSecurityEvent = {
  name: 'agent.sequence.detected';
  /** `SecurityEventCategory` has no `agent` member; the framing is in the name. */
  category: 'llm';
  outcome: 'denied';
  /** `SecuritySeverity` is `info|warning|error|critical` — there is no `high`. */
  severity: 'critical' | 'error' | 'warning' | 'info';
  reason: string;
  targetType: 'resource';
  /** The rule that fired. */
  targetId: string;
  metadata: {
    sessionId: string;
    firstAt: number;
    lastAt: number;
    steps: number;
  };
};

const SEVERITY_TO_SECURITY: Record<
  SequenceSeverity,
  SequenceSecurityEvent['severity']
> = {
  critical: 'critical',
  high: 'error',
  medium: 'warning',
  low: 'info',
};

export function sequenceDetectionsToSecurityEvents(
  detections: readonly SequenceDetection[],
): SequenceSecurityEvent[] {
  return detections.map((detection) => ({
    name: 'agent.sequence.detected',
    category: 'llm',
    outcome: 'denied',
    severity: SEVERITY_TO_SECURITY[detection.severity],
    reason: detection.description,
    targetType: 'resource',
    targetId: detection.ruleId,
    metadata: {
      sessionId: detection.sessionId,
      firstAt: detection.firstAt,
      lastAt: detection.lastAt,
      steps: detection.matchedAt.length,
    },
  }));
}

/**
 * Minimal span shape — `ReadableSpan`-compatible, declared structurally so this
 * module keeps its promise of needing no OTel SDK.
 */
export interface SequenceSpanLike {
  attributes: Record<string, unknown>;
  startTime: [number, number];
}

/** Attribute keys promoted to labels verbatim. */
const LABEL_KEYS: readonly string[] = [
  AGENT_SECURITY_ATTR.inputProvenance,
  AGENT_SECURITY_ATTR.actionRiskClass,
  AGENT_SECURITY_ATTR.consentOutcome,
  AGENT_SECURITY_ATTR.consentEvidence,
  AGENT_OUTCOME_LABEL,
  POLICY_DECISION_LABEL,
  TOOL_NAME_LABEL,
  TOOL_CALL_ID_LABEL,
];

/** Keys that mean {@link TOOL_NAME_LABEL} under another name. */
const TOOL_NAME_ALIASES: readonly string[] = [
  'gen_ai.tool.name',
  'mcp.tool.name',
];

/**
 * Turn spans into {@link SequenceEvent}s the rules can match.
 *
 * This is the piece that keeps rules honest: it is the single place where a
 * real attribute key becomes a label, so a rule can only match something the
 * codebase actually emits. Spans with no matchable label are dropped rather
 * than carried as empty steps.
 *
 * `sessionId` comes from the caller because a session is a deployment concept —
 * a trace id, a conversation id, an agent run — and guessing it wrong silently
 * merges or splits sessions, which is the one thing ordered matching cannot
 * survive.
 */
export function spansToSequenceEvents(
  spans: readonly SequenceSpanLike[],
  sessionIdOf: (span: SequenceSpanLike) => string | undefined,
): SequenceEvent[] {
  const events: SequenceEvent[] = [];

  for (const span of spans) {
    const sessionId = sessionIdOf(span);
    if (sessionId === undefined) continue;

    const labels: string[] = [];
    for (const key of LABEL_KEYS) {
      const value = span.attributes[key];
      if (typeof value === 'string' || typeof value === 'boolean') {
        labels.push(`${key}=${String(value)}`);
      }
    }

    if (!labels.some((l) => l.startsWith(`${TOOL_NAME_LABEL}=`))) {
      for (const alias of TOOL_NAME_ALIASES) {
        const value = span.attributes[alias];
        if (typeof value === 'string') {
          labels.push(`${TOOL_NAME_LABEL}=${value}`);
          break;
        }
      }
    }

    if (labels.length === 0) continue;

    events.push({
      sessionId,
      timestamp: span.startTime[0] * 1000 + span.startTime[1] / 1e6,
      labels,
    });
  }

  return events;
}

export interface EmitSequenceDetectionsOptions {
  /** Trace context for the security event. Defaults to the ambient one. */
  ctx?: AgentContext;
  /** What to do when no trace context is available. Default `'warn'`. */
  onMissingContext?: OnMissingContext;
  /**
   * Rule ids already reported, keyed `sessionId::ruleId`. Rules are
   * re-evaluated as a session grows, so the same finding is rediscovered on
   * every pass; pass a `Set` across calls and each one is reported once.
   *
   * A finding is only added once it has actually been written — marking it
   * before delivery suppresses the retry that would have reported it.
   */
  seen?: Set<string>;
  /** Override the correlated logger. Defaults to the ambient request logger. */
  logger?: RequestLogger;
}

/**
 * Flat, joinable fields for one finding.
 *
 * Carries the security-event identity as well as the `detection.*` keys. A log
 * record holds only what is passed here — `securityEvent()` puts
 * `security.event` and `security.target_id` on the *span*, which is
 * last-write-wins and is not the record a Sigma rule selects. Without these two
 * fields the per-finding records the rules are generated against cannot match
 * them.
 */
function detectionFields(
  detection: SequenceDetection,
): Record<string, string | number> {
  const [event] = sequenceDetectionsToSecurityEvents([detection]);
  return {
    ...(event && {
      [SECURITY_ATTR.event]: event.name,
      [SECURITY_ATTR.targetId]: event.targetId,
      [SECURITY_ATTR.severity]: event.severity,
    }),
    [DETECTION_ATTR.correlationId]: detection.sessionId,
    [DETECTION_ATTR.ruleId]: detection.ruleId,
    [DETECTION_ATTR.severity]: detection.severity,
    [DETECTION_ATTR.firstAt]: detection.firstAt,
    [DETECTION_ATTR.lastAt]: detection.lastAt,
    [DETECTION_ATTR.steps]: detection.matchedAt.length,
  };
}

/**
 * Send detections to the audit pipeline. Returns how many were written.
 *
 * Each finding becomes **its own correlated log record**. `securityEvent()`
 * alone is not enough: it mutates the request snapshot and span attributes,
 * both last-write-wins, so two findings on one request leave only the last —
 * and the Sigma rule generated for the other selects nothing.
 *
 * The security event is still emitted alongside, for the counter, the
 * force-keep sampling decision, and the span attributes.
 */
export function emitSequenceDetections(
  detections: readonly SequenceDetection[],
  options: EmitSequenceDetectionsOptions = {},
): number {
  const logger = options.logger ?? getRequestLoggerSafe();
  if (!logger) return 0;

  const seen = options.seen;
  let emitted = 0;

  for (const detection of detections) {
    const key = `${detection.sessionId}::${detection.ruleId}`;
    if (seen?.has(key)) continue;

    logger.info(DETECTION_EVENT, detectionFields(detection));
    // Only now: a finding marked seen before it was written can never be
    // reported, and nothing records that it went missing.
    seen?.add(key);
    emitted += 1;

    for (const payload of sequenceDetectionsToSecurityEvents([detection])) {
      securityEvent(payload, {
        ...(options.ctx !== undefined && { ctx: options.ctx }),
        onMissingContext: options.onMissingContext ?? 'warn',
      });
    }
  }

  return emitted;
}
