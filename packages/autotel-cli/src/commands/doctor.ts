import type {
  DoctorOptions,
  Check,
  CheckSummary,
  DoctorResult,
  Preset,
} from '../types/index';
import { discoverProject } from '../lib/project';
import { detectConfig } from '../lib/config-detector';
import { getAutotelInfo, checkAutotelVersions } from '../lib/dependency-auditor';
import { checkEsmHook } from '../lib/esm-checker';
import { checkEnvVarsPresent } from '../lib/env-generator';
import { getInstallCommand } from '../lib/package-manager';
import { getPreset } from '../presets/index';
import { checkLoggerInstrumentation } from '../lib/logger-checker';
import * as output from '../ui/output';
import { createSpinner } from '../ui/spinner';

/**
 * All available check definitions
 */
const CHECK_DEFINITIONS = [
  { id: 'autotel-installed', title: 'Autotel installed', description: 'Check if autotel is installed' },
  { id: 'peer-deps', title: 'Peer dependencies', description: 'Check if required peer dependencies are installed' },
  { id: 'esm-hook', title: 'ESM hook setup', description: 'Check if autotel/register is imported correctly' },
  { id: 'env-vars', title: 'Environment variables', description: 'Check if required env vars are present' },
  { id: 'version-compat', title: 'Version compatibility', description: 'Check autotel package versions match' },
  { id: 'config-found', title: 'Configuration found', description: 'Check if instrumentation config exists' },
  { id: 'logger-instrumentation', title: 'Logger instrumentation', description: 'Check if logger instrumentation packages are installed' },
];

/**
 * Infer backend from dependencies and env files
 */
async function inferBackend(
  packageRoot: string,
  deps: Record<string, string>
): Promise<Preset | null> {
  // Check for known backend packages
  if (deps['autotel-backends']) {
    // Check for grpc exporter - likely Honeycomb
    if (deps['@opentelemetry/exporter-trace-otlp-grpc']) {
      return getPreset('backend', 'honeycomb') ?? null;
    }
    // Check for http exporter - could be Datadog or generic
    if (deps['@opentelemetry/exporter-trace-otlp-http']) {
      // Check env files for DD_ prefix
      const ddVars = await checkEnvVarsPresent(packageRoot, ['DATADOG_API_KEY', 'DD_API_KEY']);
      for (const [, result] of ddVars) {
        if (result.found) {
          return getPreset('backend', 'datadog') ?? null;
        }
      }
      return getPreset('backend', 'otlp-http') ?? null;
    }
  }

  return null;
}

/**
 * Run all doctor checks
 */
async function runChecks(
  options: DoctorOptions,
  projectRoot: string
): Promise<Check[]> {
  const project = discoverProject(projectRoot);
  if (!project) {
    return [{
      id: 'project',
      title: 'Project discovery',
      level: 'error',
      status: 'error',
      message: 'No package.json found',
    }];
  }

  const checks: Check[] = [];
  const deps = { ...project.packageJson.dependencies, ...project.packageJson.devDependencies };

  // Check 1: Autotel installed
  const autotelInfo = getAutotelInfo(project.packageJson);
  if (autotelInfo.installed) {
    checks.push({
      id: 'autotel-installed',
      title: 'Autotel installed',
      level: 'error',
      status: 'ok',
      message: `autotel@${autotelInfo.version} is installed`,
    });
  } else {
    checks.push({
      id: 'autotel-installed',
      title: 'Autotel installed',
      level: 'error',
      status: 'error',
      message: 'autotel is not installed',
      fix: {
        cmd: getInstallCommand(project.packageManager, ['autotel']),
        description: 'Install autotel package',
      },
    });
  }

  // Check 2: Config found
  const config = detectConfig(project.packageRoot);
  if (config.found) {
    if (config.type === 'cli-owned') {
      checks.push({
        id: 'config-found',
        title: 'Configuration found',
        level: 'info',
        status: 'ok',
        message: `CLI-owned instrumentation at ${config.path}`,
      });
    } else if (config.type === 'user-created') {
      checks.push({
        id: 'config-found',
        title: 'Configuration found',
        level: 'info',
        status: 'ok',
        message: `User-created instrumentation at ${config.path}`,
        details: ['Add CLI header to enable auto-updates'],
      });
    } else {
      checks.push({
        id: 'config-found',
        title: 'Configuration found',
        level: 'info',
        status: 'ok',
        message: `Config found at ${config.path}`,
      });
    }
  } else {
    checks.push({
      id: 'config-found',
      title: 'Configuration found',
      level: 'info',
      status: 'warn',
      message: 'No instrumentation config found',
      details: [
        'Run `autotel init` to create a CLI-owned config',
        "Or add `import 'autotel/register'` and call `init()` manually",
      ],
    });
  }

  // Infer backend for preset-aware checks
  const inferredBackend = await inferBackend(project.packageRoot, deps);
  const canInferPreset = inferredBackend !== null || config.type === 'cli-owned';

  // Check 3: Peer dependencies (preset-aware)
  if (canInferPreset && inferredBackend) {
    const missingDeps: string[] = [];
    for (const pkg of inferredBackend.packages.required) {
      if (!deps[pkg]) {
        missingDeps.push(pkg);
      }
    }

    if (missingDeps.length > 0) {
      checks.push({
        id: 'peer-deps',
        title: 'Peer dependencies',
        level: 'warning',
        status: 'warn',
        message: 'Missing peer dependencies required by selected backend',
        details: missingDeps.map((d) => `Missing: ${d}`),
        fix: {
          cmd: getInstallCommand(project.packageManager, missingDeps),
          description: 'Install missing peer dependencies',
        },
      });
    } else {
      checks.push({
        id: 'peer-deps',
        title: 'Peer dependencies',
        level: 'warning',
        status: 'ok',
        message: 'All peer dependencies satisfied',
      });
    }
  } else {
    checks.push({
      id: 'peer-deps',
      title: 'Peer dependencies',
      level: 'warning',
      status: 'skip',
      message: 'Could not infer backend; skipping peer dep check',
      details: [
        'Run `autotel init` to create a CLI-owned config',
        'Or add header marker to existing instrumentation',
      ],
    });
  }

  // Check 4: Env vars (preset-aware)
  if (canInferPreset && inferredBackend && inferredBackend.env.required.length > 0) {
    const requiredVarNames = inferredBackend.env.required.map((v) => v.name);
    const envResults = await checkEnvVarsPresent(
      project.packageRoot,
      requiredVarNames,
      options.envFile
    );

    const missingVars: string[] = [];
    for (const [varName, result] of envResults) {
      if (!result.found) {
        missingVars.push(varName);
      }
    }

    if (missingVars.length > 0) {
      checks.push({
        id: 'env-vars',
        title: 'Environment variables',
        level: 'warning',
        status: 'warn',
        message: 'Missing required environment variables',
        details: [
          ...missingVars.map((v) => `Missing: ${v}`),
          'Set in environment or deployment secrets',
        ],
      });
    } else {
      checks.push({
        id: 'env-vars',
        title: 'Environment variables',
        level: 'warning',
        status: 'ok',
        message: 'Required environment variables found',
      });
    }
  } else if (!canInferPreset) {
    checks.push({
      id: 'env-vars',
      title: 'Environment variables',
      level: 'warning',
      status: 'skip',
      message: 'Could not infer backend; skipping env check',
    });
  } else {
    checks.push({
      id: 'env-vars',
      title: 'Environment variables',
      level: 'warning',
      status: 'ok',
      message: 'No required environment variables for this backend',
    });
  }

  // Check 5: Version compatibility
  const versionCheck = checkAutotelVersions(project.packageJson);
  if (versionCheck.packages.length > 1) {
    if (versionCheck.compatible) {
      checks.push({
        id: 'version-compat',
        title: 'Version compatibility',
        level: 'warning',
        status: 'ok',
        message: 'All autotel packages are compatible',
      });
    } else {
      checks.push({
        id: 'version-compat',
        title: 'Version compatibility',
        level: 'warning',
        status: 'warn',
        message: 'Autotel packages have mismatched major versions',
        details: versionCheck.packages.map((p) => `${p.name}@${p.version}`),
      });
    }
  } else {
    checks.push({
      id: 'version-compat',
      title: 'Version compatibility',
      level: 'warning',
      status: 'skip',
      message: 'Only one autotel package installed; skipping version check',
    });
  }

  // Check 6: ESM hook setup (conservative)
  const esmCheck = checkEsmHook(project);
  checks.push({
    id: 'esm-hook',
    title: 'ESM hook setup',
    level: esmCheck.status === 'warn' ? 'warning' : 'info',
    status: esmCheck.status === 'ok' ? 'ok' :
            esmCheck.status === 'warn' ? 'warn' :
            esmCheck.status === 'error' ? 'error' : 'skip',
    message: esmCheck.message,
    details: esmCheck.details,
  });

  // Check 7: Logger instrumentation
  const loggerCheck = checkLoggerInstrumentation(project.packageRoot, deps);
  if (loggerCheck.hasLogger) {
    if (loggerCheck.configuredInCode && !loggerCheck.hasInstrumentation) {
      checks.push({
        id: 'logger-instrumentation',
        title: 'Logger instrumentation',
        level: 'warning',
        status: 'warn',
        message: `${loggerCheck.logger} is configured but instrumentation package is missing`,
        details: [
          `${loggerCheck.logger} is used in autoInstrumentations but ${loggerCheck.instrumentationPackage} is not installed`,
          `Install it: ${getInstallCommand(project.packageManager, [loggerCheck.instrumentationPackage!])}`,
        ],
        fix: {
          cmd: getInstallCommand(project.packageManager, [loggerCheck.instrumentationPackage!]),
          description: `Install ${loggerCheck.instrumentationPackage}`,
        },
      });
    } else if (loggerCheck.hasInstrumentation && loggerCheck.configuredInCode) {
      checks.push({
        id: 'logger-instrumentation',
        title: 'Logger instrumentation',
        level: 'info',
        status: 'ok',
        message: `${loggerCheck.logger} instrumentation is properly configured`,
      });
    } else if (loggerCheck.hasInstrumentation && !loggerCheck.configuredInCode) {
      checks.push({
        id: 'logger-instrumentation',
        title: 'Logger instrumentation',
        level: 'info',
        status: 'ok',
        message: `${loggerCheck.logger} instrumentation package is installed`,
        details: [
          `Add '${loggerCheck.logger}' to autoInstrumentations in your init() call to enable trace context injection`,
        ],
      });
    } else {
      checks.push({
        id: 'logger-instrumentation',
        title: 'Logger instrumentation',
        level: 'info',
        status: 'skip',
        message: `${loggerCheck.logger} is installed but not configured in code`,
      });
    }
  } else {
    checks.push({
      id: 'logger-instrumentation',
      title: 'Logger instrumentation',
      level: 'info',
      status: 'skip',
      message: 'No logger packages detected (winston, bunyan, pino)',
    });
  }

  return checks;
}

/**
 * Calculate summary from checks
 */
function calculateSummary(checks: Check[]): CheckSummary {
  return {
    ok: checks.filter((c) => c.status === 'ok').length,
    warnings: checks.filter((c) => c.status === 'warn').length,
    errors: checks.filter((c) => c.status === 'error').length,
    skipped: checks.filter((c) => c.status === 'skip').length,
  };
}

/**
 * Determine exit code from checks
 */
function getExitCode(checks: Check[]): number {
  const hasErrors = checks.some((c) => c.status === 'error');
  const hasWarnings = checks.some((c) => c.status === 'warn');

  if (hasErrors) return 2;
  if (hasWarnings) return 1;
  return 0;
}

/**
 * Run the doctor command
 */
export async function runDoctor(options: DoctorOptions): Promise<void> {
  // Set output mode
  if (options.verbose) {
    process.env['AUTOTEL_VERBOSE'] = 'true';
  }
  if (options.quiet) {
    process.env['AUTOTEL_QUIET'] = 'true';
  }

  // List checks mode
  if (options.listChecks) {
    if (options.json) {
      console.log(JSON.stringify(CHECK_DEFINITIONS, null, 2));
    } else {
      output.heading('Available checks:\n');
      for (const check of CHECK_DEFINITIONS) {
        console.log(`  ${check.id}`);
        console.log(`    ${check.description}\n`);
      }
    }
    return;
  }

  const spinner = createSpinner();

  // Discover project
  spinner.start('Scanning project...');
  const project = discoverProject(options.cwd);

  if (!project) {
    spinner.fail('No package.json found');
    output.error('Run this command in a directory with a package.json, or use --cwd');
    process.exit(2);
  }

  spinner.text('Running checks...');

  // Run all checks
  const checks = await runChecks(options, options.cwd);
  const summary = calculateSummary(checks);

  spinner.stop();

  // JSON output
  if (options.json) {
    const result: DoctorResult = {
      project: project.packageRoot,
      checks,
      summary,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(getExitCode(checks));
  }

  // Human output
  output.heading(`autotel doctor\n`);
  output.dim(`Scanning ${project.packageRoot}...\n`);

  for (const check of checks) {
    const lines = output.formatCheck(check);
    for (const line of lines) {
      console.log(line);
    }
  }

  console.log('');
  console.log(output.formatSummary(summary));

  // Run fixes if requested
  if (options.fix) {
    const fixableChecks = checks.filter((c) => c.fix && c.status !== 'ok');

    if (fixableChecks.length === 0) {
      output.info('\nNo fixes needed');
    } else {
      output.info(`\nApplying ${fixableChecks.length} fix(es)...`);

      for (const check of fixableChecks) {
        if (!check.fix) continue;

        // Only auto-fix safe operations
        if (check.id === 'autotel-installed' || check.id === 'peer-deps') {
          output.info(`Running: ${check.fix.cmd}`);
          try {
            const { execSync } = await import('node:child_process');
            execSync(check.fix.cmd, { cwd: project.packageRoot, stdio: 'inherit' });
            output.success(`Fixed: ${check.title}`);
          } catch {
            output.error(`Failed to fix: ${check.title}`);
          }
        } else {
          output.dim(`Skipping auto-fix for ${check.id} (not safe to auto-fix)`);
          output.dim(`Manual fix: ${check.fix.cmd}`);
        }
      }
    }
  }

  process.exit(getExitCode(checks));
}
