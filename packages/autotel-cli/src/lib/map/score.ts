import { isExemptRoute } from './exemptions';
import { getRule, REQUIREMENTS } from './rules';
import type { CheckId, CheckResult, Grade, RouteEntry } from './types';

/** Fallback weight for a rule id that is not in the registry. */
const UNKNOWN_WEIGHT = 10;

/**
 * Score one entry point from its requirement results.
 *
 * Opportunities are deliberately unreachable from here: they live in
 * `route.suggestions`, and their type carries no weight to subtract.
 */
export function scoreRoute(
  checks: Partial<Record<CheckId, CheckResult>>,
): number {
  let score = 100;
  for (const [id, result] of Object.entries(checks) as [
    CheckId,
    CheckResult,
  ][]) {
    if (result.status !== 'fail') continue;
    const rule = getRule(id);
    if (rule && rule.category !== 'requirement') continue;
    score -= rule?.category === 'requirement' ? rule.weight : UNKNOWN_WEIGHT;
  }
  return Math.max(0, score);
}

/**
 * Weighted average of the per-entry scores.
 *
 * A sensitive handler counts double: the weights say which entry points the
 * number should follow.
 *
 * Exempt entries are left out entirely. Every rule is `n/a` for them, so they
 * score a free 100, and averaging those in would let a project of health checks
 * report a high score while its real handlers are dark.
 */
export function scoreGlobal(routes: readonly RouteEntry[]): number {
  const scored = routes.filter((route) => !isExemptRoute(route));
  if (scored.length === 0) return 100;

  let totalWeight = 0;
  let weightedSum = 0;
  for (const route of scored) {
    const weight = route.sensitivity.level === 'high' ? 2 : 1;
    totalWeight += weight;
    weightedSum += route.score * weight;
  }
  return Math.round(weightedSum / totalWeight);
}

/** Grade band a score falls into, at 90 / 70 / 50. */
export function gradeFromScore(score: number): Grade {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'needs-work';
  return 'at-risk';
}

/**
 * How much of an entry point the map can actually see.
 *
 * `exempt` covers entry points with nothing to instrument; it is not part of
 * the unobserved tally, because it is not a gap anyone should close.
 */
export function classifyRouteObservability(
  route: RouteEntry,
): 'instrumented' | 'partial' | 'dark' | 'exempt' {
  if (isExemptRoute(route)) return 'exempt';

  if (route.kind === 'page') {
    const applicable = Object.values(route.checks).filter(
      (check) => check?.status !== 'n/a',
    );
    if (applicable.length === 0) return 'exempt';
    const passed = applicable.filter(
      (check) => check?.status === 'pass',
    ).length;
    if (passed === applicable.length) return 'instrumented';
    if (passed > 0) return 'partial';
    return 'dark';
  }

  const span = route.checks['trace']?.status === 'pass';
  const context = route.checks['context']?.status === 'pass';
  if (span && context) return 'instrumented';
  if (span || context) return 'partial';
  return 'dark';
}

/** Compact per-rule status for the matrix view, e.g. "span ✓ context ✗". */
export function routeCheckChips(route: RouteEntry): string | null {
  const relevant = (
    Object.entries(route.checks) as [CheckId, CheckResult][]
  ).filter(([, result]) => result.status !== 'n/a');
  if (relevant.length === 0) return null;

  return relevant
    .map(([id, result]) => {
      const label = getRule(id)?.title ?? id;
      return `${label} ${result.status === 'pass' ? '✓' : '✗'}`;
    })
    .join('  ');
}

/** The one line to show next to an entry point: its heaviest unmet requirement. */
export function topIssue(route: RouteEntry): string {
  let heaviest: (typeof REQUIREMENTS)[number] | undefined;
  for (const rule of REQUIREMENTS) {
    const check = route.checks[rule.id];
    if (
      check?.status === 'fail' &&
      (!heaviest || rule.weight > heaviest.weight)
    ) {
      heaviest = rule;
    }
  }
  return heaviest ? (route.checks[heaviest.id]?.message ?? heaviest.id) : 'ok';
}
