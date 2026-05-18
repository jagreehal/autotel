import chalk from 'chalk';
import { checkbox, select } from '@inquirer/prompts';
import type { InitPlan } from '../lib/plan';

/**
 * Render an InitPlan as a single human-readable preview screen.
 *
 * The agent-native equivalent of this preview is `autotel init --json
 * --dry-run`, which emits the same `InitPlan` as machine-parseable JSON.
 */
export function renderPlanPreview(plan: InitPlan): string {
  const lines: string[] = [
    chalk.bold('autotel init — proposed plan'),
    '',
  ];

  if (plan.detected) {
    const det = plan.detected;
    const pkgList = det.packages
      .map((p) => `${p.name}@${p.version}`)
      .join(', ');
    lines.push(
      `${chalk.dim('Detected packages:')} ${pkgList || chalk.dim('(none)')}`
    );
    if (det.primaryLogger !== null) {
      lines.push(
        `${chalk.dim('Logger:')} ${chalk.bold(det.primaryLogger)} ${chalk.dim('(first-class)')}` +
          (det.autoInstrumentLoggers.length > 0
            ? `, ${chalk.dim('+ auto-instrumented:')} ${det.autoInstrumentLoggers.join(', ')}`
            : '')
      );
    }
    if (det.autoInstrumentedDeps.length > 0) {
      lines.push(
        `${chalk.dim('Covered by auto-instrumentations-node:')} ${det.autoInstrumentedDeps.join(', ')}`
      );
    }
    lines.push(
      `${chalk.dim('Backend:')} ${chalk.bold(det.backend.slug)} ${chalk.dim(`(${det.backend.source}${det.backend.detail ? `: ${det.backend.detail}` : ''})`)}`
    );
    if (det.platform !== null) {
      lines.push(`${chalk.dim('Platform:')} ${chalk.bold(det.platform)}`);
    }
  }

  lines.push('');
  lines.push(chalk.bold('Will wire:'));
  for (const slug of plan.presets) {
    lines.push(`  ${chalk.green('+')} ${slug}`);
  }

  lines.push('');
  if (plan.packagesToInstall.prod.length > 0) {
    lines.push(
      `${chalk.bold('Install:')} ${plan.packagesToInstall.prod.join(', ')}`
    );
  }
  if (plan.packagesToInstall.dev.length > 0) {
    lines.push(
      `${chalk.bold('Install (dev):')} ${plan.packagesToInstall.dev.join(', ')}`
    );
  }

  if (plan.envVars.length > 0) {
    lines.push('');
    lines.push(chalk.bold('Env vars:'));
    for (const ev of plan.envVars) {
      const marker = ev.sensitive ? chalk.yellow('[sensitive]') : '';
      lines.push(`  ${ev.name} ${marker}`);
    }
  }

  if (plan.filesToWrite.length > 0) {
    lines.push('');
    lines.push(chalk.bold('Files:'));
    for (const f of plan.filesToWrite) {
      lines.push(`  ${chalk.dim(f.action)}  ${f.path}`);
    }
  }

  return lines.join('\n');
}

/**
 * Single confirmation screen with three choices: apply / edit / abort.
 * Returns the (possibly edited) plan, or null if aborted.
 */
export async function confirmOrEditPlan(
  plan: InitPlan
): Promise<InitPlan | null> {
  console.log(renderPlanPreview(plan));
  console.log('');

  const choice = await select({
    message: 'Proceed?',
    choices: [
      { value: 'apply' as const, name: 'Apply the plan above' },
      { value: 'edit' as const, name: 'Edit — deselect items I do not want' },
      { value: 'abort' as const, name: 'Abort, write nothing' },
    ],
    default: 'apply',
  });

  if (choice === 'abort') return null;
  if (choice === 'apply') return plan;

  // edit: let user deselect presets
  const kept = await checkbox({
    message: 'Keep which presets?',
    choices: plan.presets.map((slug) => ({
      value: slug,
      name: slug,
      checked: true,
    })),
  });

  // Conservative: only filter the preset list. Install set and env vars
  // stay — re-deriving them would require re-running planning with the
  // filtered slugs, which the caller can do if needed.
  return { ...plan, presets: kept };
}

/**
 * Workspace multi-select. Returns absolute package paths the user chose.
 */
export async function promptWorkspaceSelection(
  packages: { path: string; relativePath: string; name: string | null }[]
): Promise<string[]> {
  const chosen = await checkbox({
    message: 'Which workspace packages do you want to instrument?',
    choices: packages.map((p) => ({
      value: p.path,
      name: `${p.relativePath} ${p.name ? chalk.dim(`(${p.name})`) : ''}`,
    })),
  });
  return chosen;
}
