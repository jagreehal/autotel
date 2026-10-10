import * as path from 'node:path';
import { hasRegressed, type BaselineComparison } from './baseline';
import { fixFirst } from './report';
import { getRule } from './rules';
import type { CheckId, CheckResult, RouteEntry, ScanResult } from './types';

/** One check to point at, with where it points. */
interface Finding {
  file: string;
  line: number;
  check: CheckId;
  message: string;
}

/**
 * Where the scanned project sits. Scan paths are relative to the project; the
 * runner resolves annotation paths against the checkout, so when the two
 * differ (a package in a monorepo) the path is rebased on the workspace.
 */
export interface AnnotationLocation {
  projectRoot: string;
  /** `GITHUB_WORKSPACE` on a runner; unset locally, where paths stay as scanned. */
  workspace?: string;
}

export interface AnnotationOptions {
  minScore?: number;
  /**
   * Most findings to emit. GitHub keeps ten annotations per level per step
   * and drops the rest without a word, so past that the list is not a list.
   */
  limit: number;
}

function rebase(file: string, location: AnnotationLocation): string {
  if (!location.workspace) return file;
  return path
    .relative(location.workspace, path.resolve(location.projectRoot, file))
    .split(path.sep)
    .join('/');
}

/** The failing requirements of one entry point, at the evidence line when a check has one. */
function failures(route: RouteEntry): Finding[] {
  const out: Finding[] = [];
  for (const [check, result] of Object.entries(route.checks) as [
    CheckId,
    CheckResult,
  ][]) {
    if (result.status !== 'fail') continue;
    out.push({
      file: result.evidence?.file ?? route.file,
      line: result.evidence?.line ?? route.handler?.line ?? 1,
      check,
      message: result.message ?? getRule(check)?.question ?? check,
    });
  }
  return out;
}

/**
 * Checks that passed in the baseline and no longer do. These are the pull
 * request's; everything else on the map predates it and is already in the score.
 */
function regressions(
  scan: ScanResult,
  baseline: BaselineComparison,
): Finding[] {
  const routes = new Map(scan.map.routes.map((route) => [route.id, route]));
  return baseline.regressions.flatMap((regression) => {
    const route = routes.get(regression.routeId);
    if (!route) return [];
    const failed = failures(route).find(
      (finding) => finding.check === regression.check,
    );
    if (failed) return [failed];
    return [
      {
        file: route.file,
        line: route.handler?.line ?? 1,
        check: regression.check,
        message: `${regression.check} passed in ${baseline.source.label} and is now suppressed`,
      },
    ];
  });
}

/* GitHub reads workflow commands off stdout and unescapes these three in the
   message and these five in the properties; anything else passes through. */
function escapeMessage(text: string): string {
  return text
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

function escapeProperty(text: string): string {
  return escapeMessage(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function annotation(
  level: 'error' | 'warning' | 'notice',
  properties: Record<string, string>,
  message: string,
): string {
  const props = Object.entries(properties)
    .map(([key, value]) => `${key}=${escapeProperty(value)}`)
    .join(',');
  return `::${level}${props ? ` ${props}` : ''}::${escapeMessage(message)}`;
}

/**
 * GitHub Actions workflow commands, one line per finding, for stdout.
 *
 * With a baseline, the findings are the regressions and they are errors: the
 * pull request caused them. Without one, they are the "Fix these first" list,
 * worst entry point first, as warnings. Either list stops at `limit`. The
 * first line carries the score, as an error when the gate failed, so the run
 * is readable without the log. It leads because GitHub keeps only the first
 * ten errors of a step.
 */
export function formatGithubAnnotations(
  scan: ScanResult,
  baseline: BaselineComparison | null,
  location: AnnotationLocation,
  options: AnnotationOptions,
): string {
  const findings = baseline
    ? regressions(scan, baseline)
    : fixFirst(scan.map.routes).flatMap(failures);
  const level = baseline ? 'error' : 'warning';
  const lines = findings.slice(0, options.limit).map((finding) =>
    annotation(
      level,
      {
        file: rebase(finding.file, location),
        line: String(finding.line),
        title: `autotel map: ${finding.check}`,
      },
      finding.message,
    ),
  );

  const { score } = scan.map;
  const { dark, instrumented, partial } = scan.summary;
  const hidden = findings.length - lines.length;
  const summary =
    `score ${score}/100 (${scan.grade}): ${instrumented} instrumented, ${partial} partial, ${dark} dark` +
    (hidden > 0
      ? `; ${hidden} more finding${hidden === 1 ? '' : 's'} not shown`
      : '');

  const title = { title: 'autotel map' };
  let headline: string;
  if (options.minScore !== undefined && score < options.minScore) {
    headline = annotation(
      'error',
      title,
      `${summary}; below --min-score ${options.minScore}`,
    );
  } else if (baseline && hasRegressed(baseline)) {
    headline = annotation(
      'error',
      title,
      `${summary}; regressed against ${baseline.source.label}`,
    );
  } else {
    headline = annotation('notice', title, summary);
  }

  return [headline, ...lines].join('\n');
}
