import chalk from 'chalk';
import type { BaselineComparison } from './baseline';
import { getRule, REQUIREMENTS, RULES } from './rules';
import { classifyRouteObservability, topIssue } from './score';
import { sensitivityLabel } from './sensitivity';
import type { Grade, RouteEntry, ScanResult } from './types';

const GRADE_COLOUR: Record<Grade, (text: string) => string> = {
  excellent: chalk.green,
  good: chalk.green,
  'needs-work': chalk.yellow,
  'at-risk': chalk.red,
};

/** Entry-point label without colour — the one width calculations can trust. */
function plainLabel(route: RouteEntry): string {
  const method = route.method ? `${route.method} ` : '';
  const badge = sensitivityLabel(route.sensitivity);
  return `${method}${route.path}${badge ? ` [${badge}]` : ''}`;
}

function label(route: RouteEntry): string {
  const method = route.method ? `${route.method} ` : '';
  const badge = sensitivityLabel(route.sensitivity);
  return `${method}${route.path}${badge ? chalk.magenta(` [${badge}]`) : ''}`;
}

/** Points this entry point is losing, weighted the way the global score weighs it. */
function lostPoints(route: RouteEntry): number {
  const weight = route.sensitivity.level === 'high' ? 2 : 1;
  return (100 - route.score) * weight;
}

/**
 * The default view: the number, the tally, and the three entry points worth
 * fixing first.
 *
 * Three rather than all of them on purpose — a list of forty gaps is a list
 * nobody starts. `--all` is one keystroke away when the whole picture is wanted.
 */
export function formatReport(
  result: ScanResult,
  options: { mapPath?: string | null } = {},
): string {
  const { map, summary, grade } = result;
  const lines: string[] = [];
  const colour = GRADE_COLOUR[grade];

  lines.push('');
  lines.push(
    chalk.bold(`Observability map — ${map.projectName} (${map.framework})`),
  );
  lines.push('');
  lines.push(`  ${colour(chalk.bold(`${map.score}/100`))}  ${colour(grade)}`);
  lines.push(
    chalk.dim(
      `  ${map.routes.length} entry point${map.routes.length === 1 ? '' : 's'} · ` +
        `${summary.instrumented} instrumented · ${summary.partial} partial · ` +
        `${summary.dark} dark · ${summary.exempt} exempt` +
        (summary.suppressedChecks > 0
          ? ` · ${summary.suppressedChecks} suppressed`
          : ''),
    ),
  );

  const worst = map.routes
    .filter(
      (route) =>
        classifyRouteObservability(route) !== 'exempt' && route.score < 100,
    )
    .toSorted((a, b) => lostPoints(b) - lostPoints(a))
    .slice(0, 3);

  if (worst.length > 0) {
    lines.push('');
    lines.push(chalk.bold('Fix these first'));
    for (const [index, route] of worst.entries()) {
      lines.push(`  ${index + 1}. ${label(route)}`);
      lines.push(`     ${chalk.yellow(topIssue(route))}`);
      lines.push(
        chalk.dim(
          `     ${route.file}${route.handler ? `:${route.handler.line}` : ''}  (${route.score}/100)`,
        ),
      );
    }
  }

  /* Only failures: an exempt or not-applicable rule leaves an `n/a` entry in
     `suggestions`, and printing those reads as advice to instrument a health
     check the map deliberately excused. */
  const perRoute = map.routes.flatMap((route) =>
    Object.entries(route.suggestions)
      .filter(([, check]) => check?.status === 'fail')
      .map(([, check]) => `${label(route)} — ${check?.message ?? ''}`),
  );
  const suggestions = [
    ...result.suggestions.map((suggestion) => suggestion.message),
    ...perRoute.slice(0, 3),
  ];
  if (suggestions.length > 0) {
    lines.push('');
    lines.push(chalk.bold('Suggestions'));
    for (const suggestion of suggestions) {
      lines.push(chalk.dim(`  · ${suggestion}`));
    }
  }

  lines.push('');
  if (options.mapPath) {
    lines.push(chalk.dim(`Wrote ${options.mapPath}`));
  }
  lines.push(
    chalk.cyan(
      'Next: autotel map --all  ·  autotel map <route|file>  ·  autotel map --json',
    ),
  );

  return lines.join('\n');
}

/** Every entry point as a check matrix — one column per requirement. */
export function formatMatrix(result: ScanResult): string {
  const lines: string[] = [''];
  const columns = REQUIREMENTS.map((rule) => rule.id);
  const headers = REQUIREMENTS.map((rule) => rule.title);

  const nameWidth = Math.max(
    20,
    ...result.map.routes.map((route) => plainLabel(route).length),
  );

  lines.push(
    chalk.bold(
      `${'entry point'.padEnd(nameWidth)}  ${headers
        .map((header) => header.padEnd(8))
        .join('')}score`,
    ),
  );

  for (const route of result.map.routes) {
    const padding = ' '.repeat(
      Math.max(0, nameWidth - plainLabel(route).length),
    );
    const cells = columns
      .map((id) => mark(route.checks[id]?.status).padEnd(8))
      .join('');
    lines.push(`${label(route)}${padding}  ${cells}${route.score}`);
  }

  lines.push('');
  lines.push(chalk.dim('✓ pass   ✗ fail   – not applicable'));
  return lines.join('\n');
}

function mark(status: string | undefined): string {
  if (status === 'pass') return chalk.green('✓');
  if (status === 'fail') return chalk.red('✗');
  return chalk.dim('–');
}

/** Find an entry point by route path or file path. */
export function findEntry(
  result: ScanResult,
  query: string,
): RouteEntry | undefined {
  const needle = query.toLowerCase();
  return (
    result.map.routes.find((route) => route.file.toLowerCase() === needle) ??
    result.map.routes.find((route) => route.path.toLowerCase() === needle) ??
    result.map.routes.find(
      (route) =>
        route.file.toLowerCase().includes(needle) ||
        route.path.toLowerCase().includes(needle),
    )
  );
}

/** One entry point in full: every rule, its verdict, and the code that fixes it. */
export function formatInspect(route: RouteEntry): string {
  const lines: string[] = [
    '',
    chalk.bold(label(route)),
    chalk.dim(
      `${route.file}${route.handler ? `:${route.handler.line}` : ''} · ${route.kind} · ${route.score}/100`,
    ),
  ];
  if (route.sensitivity.reasons.length > 0) {
    lines.push(
      chalk.magenta(`sensitive: ${route.sensitivity.reasons.join(', ')}`),
    );
  }
  lines.push('');

  for (const rule of RULES) {
    const result = route.checks[rule.id] ?? route.suggestions[rule.id];
    if (!result) continue;
    if (result.status === 'n/a' && !result.suppressed) continue;

    const kind =
      rule.category === 'requirement' ? '' : chalk.dim(' (suggestion)');
    lines.push(`${mark(result.status)} ${chalk.bold(rule.title)}${kind}`);
    lines.push(`  ${chalk.dim(rule.question)}`);
    if (result.message) lines.push(`  ${result.message}`);
    if (result.evidence?.snippet) {
      lines.push(
        chalk.dim(`  ${result.evidence.line}| ${result.evidence.snippet}`),
      );
    }
    if (result.status === 'fail' && result.fix) {
      lines.push(chalk.cyan(`  → ${result.fix}`));
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatEntryNotFound(result: ScanResult, query: string): string {
  const known = result.map.routes
    .slice(0, 10)
    .map((route) => `  ${label(route)}  ${chalk.dim(route.file)}`);
  return [
    '',
    chalk.yellow(`No entry point matches "${query}".`),
    '',
    chalk.dim('Known entry points:'),
    ...known,
  ].join('\n');
}

export function formatWarnings(warnings: readonly string[]): string {
  return ['', ...warnings.map((warning) => chalk.yellow(`! ${warning}`))].join(
    '\n',
  );
}

export function formatBaseline(comparison: BaselineComparison): string {
  const lines: string[] = [
    '',
    chalk.bold(`Baseline (${comparison.source.label})`),
  ];
  const sign = comparison.totalDelta >= 0 ? '+' : '';
  lines.push(
    `  ${comparison.baselineScore} → ${comparison.score} (${sign}${comparison.totalDelta})`,
  );

  for (const regression of comparison.regressions) {
    const rule = getRule(regression.check);
    lines.push(
      chalk.red(
        `  ✗ ${regression.method ?? ''} ${regression.path} — "${rule?.title ?? regression.check}" now ${regression.to}`,
      ),
    );
    lines.push(chalk.dim(`    ${regression.file}`));
  }
  for (const fix of comparison.fixed) {
    const rule = getRule(fix.check);
    lines.push(
      chalk.green(
        `  ✓ ${fix.method ?? ''} ${fix.path} — "${rule?.title ?? fix.check}" fixed`,
      ),
    );
  }
  const darkAdded = comparison.added.filter((route) => route.dark);
  if (darkAdded.length > 0) {
    lines.push(
      chalk.yellow(
        `  ${darkAdded.length} new entry point${darkAdded.length === 1 ? '' : 's'} with no instrumentation`,
      ),
    );
    for (const route of darkAdded) {
      lines.push(
        chalk.dim(`    ${route.method ?? ''} ${route.path} (${route.file})`),
      );
    }
  }
  if (comparison.removed.length > 0) {
    lines.push(
      chalk.dim(`  ${comparison.removed.length} entry point(s) removed`),
    );
  }

  return lines.join('\n');
}

export function formatGate(score: number, threshold: number): string {
  return score < threshold
    ? chalk.red(`\nScore ${score} is below --min-score ${threshold}.`)
    : chalk.green(`\nScore ${score} meets --min-score ${threshold}.`);
}
