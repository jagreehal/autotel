import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { InitOptions, Preset, EnvVar } from '../types/index';
import { discoverProject } from '../lib/project';
import { getInstallCommand } from '../lib/package-manager';
import { detectConfig } from '../lib/config-detector';
import {
  createCodeFile,
  addImport,
  setBackendConfig,
  addSubscriberConfig,
  addPluginInit,
  renderCodeFile,
  setPinoLogger,
  addAutoInstrumentationLogger,
} from '../lib/code-builder';
import { generateEnvExample } from '../lib/env-generator';
import { atomicWrite, fileExists, readFileSafe } from '../lib/fs';
import {
  detectInProject,
  envFilesRequireConsent,
} from '../lib/dep-detector';
import { buildPlanFromDetection } from '../lib/plan-builder';
import { parsePlan, type InitPlan } from '../lib/plan';
import {
  parseInstrumentation,
  diffImportSources,
  diffAutoInstrumentations,
} from '../lib/instrumentation-parser';
import { confirmOrEditPlan } from '../ui/preview';
import {
  AutotelError,
  AutotelErrorCodes,
  toAutotelError,
} from '../lib/errors';
import {
  configureJsonOutput,
  printJson,
} from '../lib/json-output';
import {
  getQuickPreset,
  getPreset,
} from '../presets/index';
import {
  promptConfirm,
  promptExistingConfigAction,
} from '../ui/prompts';
import * as output from '../ui/output';
import { isCI } from '../ui/spinner';

/**
 * Run the init command.
 *
 * Order of operations:
 *   1. Source the plan:
 *        --plan <path>  → read+parse a pre-built plan
 *        --input -      → read plan from stdin
 *        --preset <q>   → translate quick preset to plan
 *        else           → run detection (unless --no-detect)
 *      If no source is available, fail fast with E_INVALID_FLAG.
 *   2. If detection-driven and interactive: preview + confirm (or edit/abort).
 *      --yes / --no-interactive / --json skip the prompt.
 *   3. --json or --dry-run: emit/print the plan, do not write.
 *   4. Apply: render instrumentation file (merge if existing CLI-owned),
 *      write .env.example, run installs (per-package PM-native).
 */
export async function runInit(options: InitOptions): Promise<void> {
  // Configure agent-native I/O up front so errors bubble through correctly.
  if (options.json) {
    configureJsonOutput({
      outputFile: options.outputFile,
      noSecrets: options.noSecrets,
    });
  }

  if (options.verbose) process.env['AUTOTEL_VERBOSE'] = 'true';
  if (options.quiet) process.env['AUTOTEL_QUIET'] = 'true';

  const project = discoverProject(options.cwd);
  if (project === null) {
    throw new AutotelError({
      type: 'environment',
      code: AutotelErrorCodes.E_NO_PACKAGE_JSON,
      message: `No package.json found at or above ${options.cwd}`,
      fix: 'cd into a directory with a package.json, or pass --cwd <path>',
      expected: { file: 'package.json' },
    });
  }

  // Configure output root for any --output-file writes.
  if (options.json && options.outputFile !== undefined) {
    configureJsonOutput({
      outputFile: options.outputFile,
      outputRoot: project.packageRoot,
      noSecrets: options.noSecrets,
    });
  }

  // === Plan sourcing =====================================================

  let plan: InitPlan | null = null;

  if (options.plan !== undefined) {
    plan = readPlanFromFile(options.plan);
  } else if (options.input !== undefined) {
    plan = await readPlanFromInput(options.input);
  } else if (options.preset !== undefined) {
    plan = planFromQuickPreset(options.preset, project);
  } else if (!options.noDetect) {
    plan = await planFromDetection(project, options);
  }

  // If no plan source was available (e.g. --no-detect with no --plan/--input/
  // --preset), fail fast. init is detection/plan-driven.
  if (plan === null) {
    throw new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_INVALID_FLAG,
      message:
        'No plan source available (--no-detect disables detection)',
      fix: 'Drop --no-detect or pass --plan / --input / --preset',
    });
  }

  // === Preview / confirmation ===========================================

  const interactive =
    !options.yes && !options.noInteractive && !options.json && !isCI();

  if (
    interactive &&
    options.plan === undefined &&
    options.input === undefined &&
    options.preset === undefined
  ) {
    // Only show preview for the auto-detected flow. Explicit-input flows
    // skip preview because the user already supplied the plan.
    const confirmed = await confirmOrEditPlan(plan);
    if (confirmed === null) {
      output.info('Aborted');
      return;
    }
    plan = confirmed;
  }

  // === Detect-only / JSON / dry-run early exits =========================

  if (options.detectOnly) {
    if (options.json) {
      printJson({ ok: true, command: 'autotel init', plan });
    } else {
      output.info('Detection-only mode — no files written');
      console.log(JSON.stringify(plan, null, 2));
    }
    return;
  }

  if (options.json && options.dryRun) {
    printJson({ ok: true, command: 'autotel init', plan, dryRun: true });
    return;
  }

  if (options.json && !options.dryRun) {
    // Apply, then emit a result envelope.
    const applied = applyPlan({ plan, project, options });
    printJson({ ok: true, command: 'autotel init', plan, applied });
    return;
  }

  // === Apply (human-output path) ========================================

  if (options.dryRun) {
    output.heading('\nDry run — no files will be written\n');
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const applied = applyPlan({ plan, project, options });
  printApplySummary({ plan, applied, project, options });
}

// ----------------------------------------------------------------------------
// Plan sourcing helpers
// ----------------------------------------------------------------------------

function readPlanFromFile(filePath: string): InitPlan {
  const content = readFileSafe(filePath);
  if (content === null) {
    throw new AutotelError({
      type: 'io',
      code: AutotelErrorCodes.E_READ_FAILED,
      message: `Could not read plan file: ${filePath}`,
    });
  }
  try {
    return parsePlan(JSON.parse(content));
  } catch (error) {
    if (error instanceof AutotelError) throw error;
    throw new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_INVALID_PLAN,
      message: `Plan file is not valid JSON: ${(error as Error).message}`,
    });
  }
}

async function readPlanFromInput(input: string): Promise<InitPlan> {
  if (input === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString('utf8');
    try {
      return parsePlan(JSON.parse(content));
    } catch (error) {
      if (error instanceof AutotelError) throw error;
      throw new AutotelError({
        type: 'validation',
        code: AutotelErrorCodes.E_INVALID_INPUT,
        message: `stdin did not contain valid JSON: ${(error as Error).message}`,
      });
    }
  }
  return readPlanFromFile(input);
}

function planFromQuickPreset(
  slug: string,
  project: ReturnType<typeof discoverProject>
): InitPlan {
  if (project === null) {
    throw new AutotelError({
      type: 'environment',
      code: AutotelErrorCodes.E_NO_PACKAGE_JSON,
      message: 'project required',
    });
  }
  const quick = getQuickPreset(slug);
  if (quick === undefined) {
    throw new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_UNKNOWN_PRESET,
      message: `Unknown preset: ${slug}`,
      fix: 'Run `autotel commands --json` to see available presets',
    });
  }
  // Synthesise a DetectionResult-equivalent and reuse the plan builder.
  const presets: string[] = [ quick.backend];
  if (quick.subscribers) presets.push(...quick.subscribers);
  if (quick.plugins) presets.push(...quick.plugins);

  const { plan } = buildPlanFromDetection({
    project,
    detection: {
      packages: [],
      presets: presets as ReturnType<
        typeof detectInProject
      >['presets'],
      primaryLogger: quick.logging === 'pino' ? 'pino' : null,
      autoInstrumentLoggers: [],
      autoInstrumentedDeps: [],
      backend: { slug: quick.backend as never, source: 'default' },
      platform: null,
    },
  });
  return plan;
}

async function planFromDetection(
  project: ReturnType<typeof discoverProject>,
  options: InitOptions
): Promise<InitPlan> {
  if (project === null) {
    throw new AutotelError({
      type: 'environment',
      code: AutotelErrorCodes.E_NO_PACKAGE_JSON,
      message: 'project required',
    });
  }

  let envConsent = options.scanEnv;
  if (
    !envConsent &&
    envFilesRequireConsent(project.packageRoot) &&
    !options.yes &&
    !options.noInteractive &&
    !options.json &&
    !isCI()
  ) {
    envConsent = await promptConfirm(
      `Found a .env file. Read its keys to help detect the backend? (values are never read)`,
      false
    );
  }

  const detection = detectInProject({ project, envConsent });
  const { plan } = buildPlanFromDetection({ project, detection });
  return plan;
}

// ----------------------------------------------------------------------------
// Apply
// ----------------------------------------------------------------------------

interface ApplyResult {
  wroteFiles: string[];
  ranInstalls: string[];
  printedInstalls: string[];
  installErrors: string[];
}

function applyPlan(args: {
  plan: InitPlan;
  project: NonNullable<ReturnType<typeof discoverProject>>;
  options: InitOptions;
}): ApplyResult {
  const { plan, project, options } = args;
  const result: ApplyResult = {
    wroteFiles: [],
    ranInstalls: [],
    printedInstalls: [],
    installErrors: [],
  };

  // Resolve presets
  const presets: Preset[] = [];
  for (const slug of plan.presets) {
    const p = resolvePreset(slug);
    if (p !== null) presets.push(p);
  }

  // Build the instrumentation file
  const codeFile = createCodeFile();
  addImport(codeFile, { source: 'autotel/register', sideEffect: true });
  addImport(codeFile, { source: 'autotel', specifiers: ['init'] });

  // Logger
  if (plan.detected?.primaryLogger === 'pino') {
    setPinoLogger(codeFile);
  }
  for (const l of plan.detected?.autoInstrumentLoggers ?? []) {
    addAutoInstrumentationLogger(codeFile, l);
  }

  for (const preset of presets) {
    for (const imp of preset.imports) {
      const section =
        preset.type === 'backend' || preset.type === 'platform'
          ? 'backend'
          : preset.type === 'plugin'
            ? 'plugin'
            : preset.type === 'subscriber'
              ? 'subscriber'
              : undefined;
      addImport(codeFile, imp, section);
    }
    if (preset.configBlock.section === 'BACKEND_CONFIG') {
      setBackendConfig(codeFile, preset.configBlock.code);
    } else if (preset.configBlock.section === 'SUBSCRIBERS_CONFIG') {
      addSubscriberConfig(codeFile, preset.configBlock.code);
    } else if (preset.configBlock.section === 'PLUGIN_INIT') {
      addPluginInit(codeFile, preset.configBlock.code);
    }
  }

  if (codeFile.backendConfig === null) {
    setBackendConfig(codeFile, '// Local/console mode - no backend configured');
  }

  const newContent = renderCodeFile(codeFile);

  // Path resolution
  const instrumentationPath = resolveInstrumentationPath(project);
  const envExamplePath = path.join(project.packageRoot, '.env.example');

  // Merge with existing CLI-owned file if present
  const existing = readFileSafe(instrumentationPath);
  if (existing !== null) {
    const parsed = parseInstrumentation(existing);
    if (!parsed.cliOwned && !options.force) {
      throw new AutotelError({
        type: 'conflict',
        code: AutotelErrorCodes.E_EXISTING_CONFIG,
        message: `Hand-edited instrumentation file at ${instrumentationPath} (no CLI markers found)`,
        fix: 'Pass --force to overwrite (creates a .bak backup) or remove the file',
        expected: { path: instrumentationPath },
      });
    }
    // For CLI-owned files we still atomic-overwrite. Surgical merging is
    // best-effort: we use the diff helpers to compute what was actually new
    // for logging purposes, but we re-render the whole file. This keeps
    // the output canonical and matches the existing --force backup contract.
    const addedImports = diffImportSources(
      parsed,
      [
        ...codeFile.imports,
        ...codeFile.backendImports,
        ...codeFile.pluginImports,
        ...codeFile.subscriberImports,
        ...codeFile.loggerImports,
      ].map((i) => i.source)
    );
    const addedAuto = diffAutoInstrumentations(
      parsed,
      codeFile.autoInstrumentations
    );
    const contentChanged = existing !== newContent;
    if (
      addedImports.length === 0 &&
      addedAuto.length === 0 &&
      parsed.cliOwned &&
      !contentChanged
    ) {
      // Nothing new — skip the write entirely.
      result.wroteFiles.push(
        `${path.relative(project.cwd, instrumentationPath)} (no changes)`
      );
    } else {
      atomicWrite(instrumentationPath, newContent, {
        root: project.packageRoot,
        backup: true,
      });
      result.wroteFiles.push(path.relative(project.cwd, instrumentationPath));
    }
  } else {
    atomicWrite(instrumentationPath, newContent, {
      root: project.packageRoot,
    });
    result.wroteFiles.push(path.relative(project.cwd, instrumentationPath));
  }

  // .env.example
  const envVars: EnvVar[] = [];
  for (const p of presets) {
    envVars.push(...p.env.required, ...p.env.optional);
  }
  const envExampleContent = generateEnvExample(envVars);
  if (envExampleContent.length > 0 && !fileExists(envExamplePath)) {
    atomicWrite(envExamplePath, envExampleContent, {
      root: project.packageRoot,
    });
    result.wroteFiles.push(path.relative(project.cwd, envExamplePath));
  }

  // Installs
  const prod = plan.packagesToInstall.prod;
  const dev = plan.packagesToInstall.dev;

  if (prod.length > 0 || dev.length > 0) {
    if (options.noInstall || options.printInstallCmd) {
      if (prod.length > 0) {
        result.printedInstalls.push(
          getInstallCommand(project.packageManager, prod)
        );
      }
      if (dev.length > 0) {
        result.printedInstalls.push(
          getInstallCommand(project.packageManager, dev, { dev: true })
        );
      }
    } else {
      if (prod.length > 0) {
        const cmd = getInstallCommand(project.packageManager, prod);
        try {
          execSync(cmd, { cwd: project.packageRoot, stdio: 'pipe' });
          result.ranInstalls.push(cmd);
        } catch {
          result.installErrors.push(cmd);
        }
      }
      if (dev.length > 0) {
        const cmd = getInstallCommand(project.packageManager, dev, {
          dev: true,
        });
        try {
          execSync(cmd, { cwd: project.packageRoot, stdio: 'pipe' });
          result.ranInstalls.push(cmd);
        } catch {
          result.installErrors.push(cmd);
        }
      }
    }
  }

  return result;
}

function resolveInstrumentationPath(
  project: NonNullable<ReturnType<typeof discoverProject>>
): string {
  // Re-use existing logic from project.ts. Local import-free version:
  const srcDir = path.join(project.packageRoot, 'src');
  const hasSrcDir =
    fs.existsSync(srcDir) ||
    fileExists(path.join(project.packageRoot, 'src', 'index.ts')) ||
    fileExists(path.join(project.packageRoot, 'src', 'index.js'));
  const dir = hasSrcDir ? srcDir : project.packageRoot;
  const ext = project.hasTypeScript ? 'mts' : 'mjs';
  return path.join(dir, `instrumentation.${ext}`);
}

function resolvePreset(slug: string): Preset | null {
  for (const type of ['backend', 'subscriber', 'plugin', 'platform'] as const) {
    const p = getPreset(type, slug);
    if (p !== undefined) return p;
  }
  return null;
}

function printApplySummary(args: {
  plan: InitPlan;
  applied: ApplyResult;
  project: NonNullable<ReturnType<typeof discoverProject>>;
  options: InitOptions;
}): void {
  const { applied, plan, project } = args;
  if (applied.wroteFiles.length > 0) {
    output.success(`Wrote: ${applied.wroteFiles.join(', ')}`);
  }
  for (const cmd of applied.ranInstalls) {
    output.info(`Installed: ${cmd}`);
  }
  for (const cmd of applied.printedInstalls) {
    output.dim(`Run: ${cmd}`);
  }
  for (const cmd of applied.installErrors) {
    output.error(`Install failed — run manually: ${cmd}`);
  }
  if (plan.nextSteps.length > 0) {
    console.log('\nNext steps:');
    for (const step of plan.nextSteps) {
      console.log(`  - ${step}`);
    }
  }
  const pmInfo = project.workspace.isMonorepo
    ? `${project.packageManager} workspace, package root ${project.packageRoot}`
    : project.packageManager;
  console.log(`\n${output.formatPackageManagerInfo
    ? output.formatPackageManagerInfo(project.packageManager, project.lockfilePath)
    : pmInfo}`);
}

// Re-export for tests / external callers (existing public surface).
export { detectConfig, toAutotelError, promptExistingConfigAction };
