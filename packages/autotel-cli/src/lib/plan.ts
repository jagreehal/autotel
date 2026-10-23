/**
 * `InitPlan` — the unit of work `autotel init` produces from detection and
 * consumes via `--plan <path>` / `--input -`. Agents generate plans, humans
 * review them, agents apply them.
 *
 * Roundtrip: a plan emitted via `autotel init --json --dry-run` is valid
 * input for `autotel init --plan <file>`. Keep the shape stable; treat new
 * fields as optional.
 */

import type {
  DetectedBackend,
  DetectedPackage,
  LoggerKind,
  PresetSlug,
} from './dep-detector';
import { AutotelError, AutotelErrorCodes } from './errors';
import { asRecord } from './values';

export interface InitPlanDetection {
  packages: DetectedPackage[];
  primaryLogger: LoggerKind | null;
  autoInstrumentLoggers: LoggerKind[];
  autoInstrumentedDeps: string[];
  backend: DetectedBackend;
  platform: PresetSlug | null;
}

export interface InitPlanFile {
  path: string;
  action: 'create' | 'merge' | 'skip';
}

export interface InitPlanEnvVar {
  name: string;
  sensitive: boolean;
  action: 'add-to-.env.example' | 'present';
}

export interface InitPlan {
  /** Plan format version. Increment when making breaking changes. */
  v: 1;
  /** Preset slugs to wire (backend, subscribers, plugins, platform). */
  presets: PresetSlug[];
  /** Packages to install. */
  packagesToInstall: { prod: string[]; dev: string[] };
  /** Files we will write or merge. */
  filesToWrite: InitPlanFile[];
  /** Env vars referenced by the chosen presets. */
  envVars: InitPlanEnvVar[];
  /** Human-readable next-step strings. */
  nextSteps: string[];
  /** Echo of detection for transparency. Omitted when plan was hand-crafted. */
  detected?: InitPlanDetection;
}

/**
 * Validate a candidate plan, returning a typed `InitPlan` or throwing
 * AutotelError(E_INVALID_PLAN). Minimal structural check — we trust the
 * caller for now.
 */
export function parsePlan(input: unknown): InitPlan {
  const obj = asRecord(input);
  if (obj === undefined) {
    throw new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_INVALID_PLAN,
      message: 'Plan must be a JSON object',
      expected: { v: 1, presets: 'string[]' },
    });
  }
  if (obj['v'] !== 1) {
    throw new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_INVALID_PLAN,
      message: `Unsupported plan version: ${String(obj['v'])}`,
      fix: 'Regenerate the plan with `autotel init --json --dry-run`',
      expected: { v: 1 },
    });
  }
  if (!Array.isArray(obj['presets'])) {
    throw new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_INVALID_PLAN,
      message: 'plan.presets must be an array of preset slugs',
    });
  }
  const pkgs = asRecord(obj['packagesToInstall']);
  if (
    pkgs === undefined ||
    !Array.isArray(pkgs['prod']) ||
    !Array.isArray(pkgs['dev'])
  ) {
    throw new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_INVALID_PLAN,
      message:
        'plan.packagesToInstall must be { prod: string[], dev: string[] }',
    });
  }
  // SAFETY: input is the object checked above (v, presets, packagesToInstall);
  // the remaining fields are trusted, as the doc comment says.
  return input as InitPlan;
}
