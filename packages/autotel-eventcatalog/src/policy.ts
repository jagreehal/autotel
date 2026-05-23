// Decide whether a drift outcome should fail a CI job.
//
// `policy` answers the gating question; it deliberately doesn't render or
// print anything. `reason` carries a short, log-friendly explanation that
// CLI / Action layers can surface in their exit messages.

import type { DriftDelta } from './diff-vs-base';
import type { DriftReport } from './diff';
import { hasDrift } from './diff';

export type DriftPolicyMode = 'all' | 'new-only';

export type PolicyEvaluationInput =
  | { mode: 'all'; report: DriftReport }
  | { mode: 'new-only'; delta: DriftDelta };

export type PolicyEvaluationResult = {
  shouldFail: boolean;
  reason: string;
};

export function evaluatePolicy(
  input: PolicyEvaluationInput,
): PolicyEvaluationResult {
  if (input.mode === 'all') {
    const shouldFail = hasDrift(input.report);
    return {
      shouldFail,
      reason: shouldFail
        ? 'Drift detected in current snapshot.'
        : 'No drift detected.',
    };
  }
  const shouldFail = input.delta.hasNewDrift;
  return {
    shouldFail,
    reason: shouldFail
      ? 'New drift introduced compared to baseline snapshot.'
      : 'No new drift introduced compared to baseline snapshot.',
  };
}
