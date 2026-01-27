import chalk from 'chalk';
import type { Check, CheckSummary, PackageManager } from '../types/index.js';

/**
 * Status tokens for consistent output
 */
export const STATUS = {
  ok: chalk.green('[OK]'),
  warn: chalk.yellow('[WARN]'),
  error: chalk.red('[ERROR]'),
  info: chalk.blue('[INFO]'),
  skip: chalk.gray('[SKIP]'),
};

/**
 * Format check output line
 */
export function formatCheck(check: Check): string[] {
  const lines: string[] = [];
  const statusToken = STATUS[check.status];

  lines.push(`  ${statusToken} ${check.message}`);

  if (check.details && check.details.length > 0) {
    for (const detail of check.details) {
      lines.push(`         ${chalk.dim(detail)}`);
    }
  }

  if (check.fix) {
    lines.push(`         ${chalk.cyan('Fix:')} ${check.fix.cmd}`);
  }

  return lines;
}

/**
 * Format summary line
 */
export function formatSummary(summary: CheckSummary): string {
  const parts: string[] = [];

  if (summary.ok > 0) {
    parts.push(chalk.green(`${summary.ok} passed`));
  }
  if (summary.warnings > 0) {
    parts.push(chalk.yellow(`${summary.warnings} warning${summary.warnings > 1 ? 's' : ''}`));
  }
  if (summary.errors > 0) {
    parts.push(chalk.red(`${summary.errors} error${summary.errors > 1 ? 's' : ''}`));
  }
  if (summary.skipped > 0) {
    parts.push(chalk.gray(`${summary.skipped} skipped`));
  }

  return `Summary: ${parts.join(', ')}`;
}

/**
 * Format structured footer
 */
export function formatFooter(options: {
  detected?: string;
  wrote?: string[];
  next?: string;
}): string {
  const lines: string[] = [''];

  if (options.detected) {
    lines.push(chalk.dim(`Detected: ${options.detected}`));
  }

  if (options.wrote && options.wrote.length > 0) {
    lines.push(chalk.dim(`Wrote: ${options.wrote.join(', ')}`));
  }

  if (options.next) {
    lines.push(chalk.cyan(`Next: ${options.next}`));
  }

  return lines.join('\n');
}

/**
 * Format package manager detection info
 */
export function formatPackageManagerInfo(
  pm: PackageManager,
  lockfilePath: string | null
): string {
  if (lockfilePath) {
    return `${pm} (via ${chalk.dim(lockfilePath)})`;
  }
  return `${pm} (default, no lockfile found)`;
}

/**
 * Format workspace info
 */
export function formatWorkspaceInfo(
  isMonorepo: boolean,
  workspaceRoot: string | null,
  packageRoot: string
): string {
  if (!isMonorepo) {
    return `package root ${chalk.dim(packageRoot)}`;
  }
  return `monorepo, workspace root ${chalk.dim(workspaceRoot)}, package root ${chalk.dim(packageRoot)}`;
}

/**
 * Print heading
 */
export function heading(text: string): void {
  console.log(chalk.bold(text));
}

/**
 * Print info message
 */
export function info(text: string): void {
  console.log(chalk.blue(text));
}

/**
 * Print success message
 */
export function success(text: string): void {
  console.log(chalk.green(text));
}

/**
 * Print warning message
 */
export function warn(text: string): void {
  console.log(chalk.yellow(text));
}

/**
 * Print error message
 */
export function error(text: string): void {
  console.log(chalk.red(text));
}

/**
 * Print dim/muted text
 */
export function dim(text: string): void {
  console.log(chalk.dim(text));
}

/**
 * Format install command
 */
export function formatInstallCmd(cmd: string): string {
  return chalk.cyan(`$ ${cmd}`);
}

/**
 * Format file path relative to cwd
 */
export function formatPath(filePath: string): string {
  return chalk.dim(filePath);
}

/**
 * Quiet output - only warnings and errors
 */
export function isQuiet(): boolean {
  return process.env['AUTOTEL_QUIET'] === 'true';
}

/**
 * Verbose output
 */
export function isVerbose(): boolean {
  return process.env['AUTOTEL_VERBOSE'] === 'true';
}

/**
 * Print only if not quiet
 */
export function log(text: string): void {
  if (!isQuiet()) {
    console.log(text);
  }
}

/**
 * Print only if verbose
 */
export function verbose(text: string): void {
  if (isVerbose()) {
    console.log(chalk.gray(`[verbose] ${text}`));
  }
}
