import chalk from 'chalk';
import type { EstimateResult } from 'autotel-mcp';

const usd = (value: number): string => `$${value.toFixed(2)}`;

/**
 * The human view. Every figure the estimate rests on is printed with it —
 * a cost number without its basis is a number nobody can argue with, which is
 * the wrong property for a number that will end up in a budget conversation.
 */
export function printEstimate(estimate: EstimateResult): void {
  const { before, after, basis } = estimate;

  const lines = [
    '',
    chalk.bold('  Telemetry cost per month'),
    '',
    `  ${chalk.dim('today')}      ${before.events.toLocaleString()} events   ${before.gb} GB   ${chalk.bold(usd(before.cost))}`,
    `  ${chalk.dim('canonical')}  ${after.events.toLocaleString()} events   ${after.gb} GB   ${chalk.bold(usd(after.cost))}`,
    '',
    estimate.saved > 0
      ? `  ${chalk.green(`saves ${usd(estimate.saved)}/month (${estimate.savedPercent}%)`)}`
      : `  ${chalk.yellow(`costs ${usd(Math.abs(estimate.saved))}/month more`)}`,
    '',
    chalk.dim(
      `  basis: ${basis.logLineBytes} B per log line, ${basis.canonicalLineBytes} B per canonical line, ` +
        `${basis.spanBytes} B per span (${basis.bytesFrom})`,
    ),
    chalk.dim(
      `         ${usd(basis.perGb)}/GB, ${usd(basis.perMillionEvents)}/million events, ` +
        `${basis.keepPercent}% of traffic kept`,
    ),
    '',
  ];

  process.stdout.write(lines.join('\n') + '\n');
}
