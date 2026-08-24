/**
 * Sigma export for {@link ./sequence} rules.
 *
 * **Sigma selects a single record, and the record it selects is the detection.**
 * The sequence has already been matched in-process, and
 * `emitSequenceDetections` writes each finding as one `agent.sequence.detected`
 * log record carrying the rule id. The Sigma rule alerts on *that*, which is
 * exact. (`sequenceDetectionsToSecurityEvents` only shapes the payload; it
 * sends nothing.)
 *
 * An earlier version of this file exported the sequence's final step as the
 * selection and left the ordering to a correlation the operator was expected to
 * write. Deployed as-is, that alerts on every successful tool call — it is not
 * the rule, it is the rule's least specific ingredient. Selecting the emitted
 * detection has no such gap: the ordering, the session boundary and the
 * correlation key were all applied before the event existed.
 *
 * The trade is that the SIEM sees findings only from processes running the
 * in-process engine. That is a real limit, and it is a smaller one than an
 * alert nobody can keep.
 *
 * @example
 * ```typescript
 * import { SEQUENCE_RULES } from 'autotel-genai/agent';
 * import { sequenceRulesToSigma } from 'autotel-genai/agent';
 *
 * for (const { ruleId, yaml } of sequenceRulesToSigma(SEQUENCE_RULES)) {
 *   writeFileSync(`sigma/autotel_${ruleId.replaceAll('-', '_')}.yml`, yaml);
 * }
 * ```
 */

import { SECURITY_ATTR } from 'autotel/security-schema';
import { DETECTION_ATTR } from './sequence.js';
import type { SequenceRule, SequenceSeverity } from './sequence.js';

/** Sigma's `level` vocabulary. `high` exists here, unlike in SecuritySeverity. */
const SIGMA_LEVEL: Record<SequenceSeverity, string> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/**
 * Quote a scalar when YAML would otherwise read it as structure. A description
 * with `: ` or a leading `#` silently becomes a mapping or a comment.
 */
function scalar(value: string): string {
  return /[:#]|^\s|\s$/.test(value)
    ? `'${value.replaceAll("'", "''")}'`
    : value;
}

/** `"key=value"` → `[key, value]`. A label without `=` is a bare flag. */
function splitLabel(label: string): [string, string] {
  const index = label.indexOf('=');
  return index === -1
    ? [label, '']
    : [label.slice(0, index), label.slice(index + 1)];
}

/**
 * Field names the generated selections reference — taken from `SECURITY_ATTR`
 * rather than written out, because a Sigma rule naming an attribute nothing
 * emits fails the same silent way a sequence rule does: as "no findings".
 */
const SECURITY_EVENT_NAME_FIELD = SECURITY_ATTR.event;
const DETECTION_RULE_FIELD = SECURITY_ATTR.targetId;
const DETECTION_SEVERITY_FIELD = SECURITY_ATTR.severity;

export interface SigmaDocument {
  ruleId: string;
  yaml: string;
}

export function sequenceRuleToSigma(rule: SequenceRule): string {
  const steps = rule.steps.map(
    (step, index) =>
      `    ${index + 1}. ${step
        .map((label) => {
          const [key, value] = splitLabel(label);
          return `${key}: ${scalar(value)}`;
        })
        .join(' and ')}`,
  );

  const matched = [
    '  Matched in-process before this event was emitted:',
    ...steps,
    ...(rule.correlateBy
      ? [
          `  All steps agreeing on \`${[rule.correlateBy]
            .flat()
            .join('` or `')}\`.`,
        ]
      : []),
    ...(rule.withinMs === undefined
      ? []
      : [`  All steps within ${rule.withinMs}ms of the first.`]),
  ].join('\n');

  return [
    `title: Autotel - ${rule.id}`,
    `id: autotel-${rule.id}`,
    'status: experimental',
    'description: |',
    ...rule.description.split('\n').map((line) => `  ${line}`),
    matched,
    'logsource:',
    '  product: autotel',
    '  service: genai-agent',
    'detection:',
    '  selection:',
    `    ${SECURITY_EVENT_NAME_FIELD}: agent.sequence.detected`,
    `    ${DETECTION_RULE_FIELD}: ${scalar(rule.id)}`,
    '  condition: selection',
    'fields:',
    // The detection's own keys, so the alert carries what a disposition can be
    // joined against rather than a column nothing populates.
    `  - ${DETECTION_ATTR.ruleId}`,
    `  - ${DETECTION_ATTR.correlationId}`,
    `  - ${DETECTION_ATTR.severity}`,
    `  - ${DETECTION_SEVERITY_FIELD}`,
    'falsepositives:',
    '  - Tune the rule where it runs, not here: this selects a finding the',
    '    in-process engine already decided to emit.',
    `level: ${SIGMA_LEVEL[rule.severity]}`,
    '',
  ].join('\n');
}

export function sequenceRulesToSigma(
  rules: readonly SequenceRule[],
): SigmaDocument[] {
  return rules.map((rule) => ({
    ruleId: rule.id,
    yaml: sequenceRuleToSigma(rule),
  }));
}
