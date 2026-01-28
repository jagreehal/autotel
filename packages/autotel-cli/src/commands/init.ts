import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { InitOptions, Preset, EnvVar } from '../types/index';
import { discoverProject, getInstrumentationPath } from '../lib/project';
import { getInstallCommand } from '../lib/package-manager';
import { detectConfig } from '../lib/config-detector';
import {
  createCodeFile,
  addImport,
  setBackendConfig,
  addSubscriberConfig,
  addPluginInit,
  renderCodeFile,
} from '../lib/code-builder';
import { generateEnvExample } from '../lib/env-generator';
import { atomicWrite, fileExists } from '../lib/fs';
import {
  buildDependencyPlan,
  getProdPackages,
  getDevPackages,
} from '../lib/dependency-planner';
import {
  backends,
  subscribers,
  plugins,
  getQuickPreset,
  getPreset,
} from '../presets/index';
import {
  promptRuntime,
  promptBackend,
  promptLogging,
  promptDatabases,
  promptSubscribers,
  promptAutoInstrumentation,
  promptStartupStyle,
  promptExistingConfigAction,
} from '../ui/prompts';
import * as output from '../ui/output';
import { createSpinner, isCI } from '../ui/spinner';

/**
 * Run the init command
 */
export async function runInit(options: InitOptions): Promise<void> {
  const spinner = createSpinner();

  // Set output mode
  if (options.verbose) {
    process.env['AUTOTEL_VERBOSE'] = 'true';
  }
  if (options.quiet) {
    process.env['AUTOTEL_QUIET'] = 'true';
  }

  // Discover project
  spinner.start('Discovering project...');
  const project = discoverProject(options.cwd);

  if (!project) {
    spinner.fail('No package.json found');
    output.error('Run this command in a directory with a package.json, or use --cwd');
    process.exit(1);
  }

  spinner.succeed(`Found ${project.packageJson.name ?? 'project'}`);
  output.verbose(`Package root: ${project.packageRoot}`);
  output.verbose(`Package manager: ${project.packageManager}`);

  // Check for existing config
  const existingConfig = detectConfig(project.packageRoot);

  if (existingConfig.found && !options.force) {
    output.info(`Existing instrumentation detected at ${existingConfig.path}`);

    if (options.yes || isCI()) {
      output.warn('Use --force to overwrite existing config');
      process.exit(0);
    }

    const action = await promptExistingConfigAction();
    if (action === 'abort') {
      output.info('Aborted');
      process.exit(0);
    }
    // For 'update' or 'new', continue with the flow
  }

  // Determine selections
  const selectedPresets: Preset[] = [];
  let autoInstrumentations: 'all' | 'none' | string[] = 'all';
  let startupStyle = 'node-esm';

  // Check for quick preset
  if (options.preset) {
    const quickPreset = getQuickPreset(options.preset);
    if (quickPreset) {
      output.info(`Using quick preset: ${quickPreset.name}`);
      const backendPreset = getPreset('backend', quickPreset.backend);
      if (backendPreset) {
        selectedPresets.push(backendPreset);
      }
      if (quickPreset.subscribers) {
        for (const sub of quickPreset.subscribers) {
          const subPreset = getPreset('subscriber', sub);
          if (subPreset) selectedPresets.push(subPreset);
        }
      }
      if (quickPreset.plugins) {
        for (const plug of quickPreset.plugins) {
          const plugPreset = getPreset('plugin', plug);
          if (plugPreset) selectedPresets.push(plugPreset);
        }
      }
      autoInstrumentations = quickPreset.autoInstrumentations;
    } else {
      output.error(`Unknown preset: ${options.preset}`);
      output.info('Available presets: node-datadog-pino, node-datadog-agent, node-honeycomb, node-otlp');
      process.exit(1);
    }
  } else if (options.yes || isCI()) {
    // Default profile for --yes
    output.info('Using defaults (local backend, all auto-instrumentations)');
    const localPreset = getPreset('backend', 'local');
    if (localPreset) {
      selectedPresets.push(localPreset);
    }
  } else {
    // Interactive prompts
    const runtime = await promptRuntime();
    output.verbose(`Runtime: ${runtime}`);

    // Backend
    const backendSlug = await promptBackend(backends);
    const backendPreset = getPreset('backend', backendSlug);
    if (backendPreset) {
      selectedPresets.push(backendPreset);
    }

    // Logging (future enhancement - not fully implemented)
    await promptLogging();

    // Databases/Plugins
    const pluginSlugs = await promptDatabases(plugins);
    for (const slug of pluginSlugs) {
      const preset = getPreset('plugin', slug);
      if (preset) selectedPresets.push(preset);
    }

    // Subscribers
    const subscriberSlugs = await promptSubscribers(subscribers);
    for (const slug of subscriberSlugs) {
      const preset = getPreset('subscriber', slug);
      if (preset) selectedPresets.push(preset);
    }

    // Auto-instrumentation
    const autoChoice = await promptAutoInstrumentation();
    if (autoChoice === 'none') {
      autoInstrumentations = 'none';
    } else if (autoChoice === 'specific') {
      // For now, just use all - specific selection would need another prompt
      autoInstrumentations = 'all';
    }

    // Startup style
    if (runtime === 'node') {
      startupStyle = await promptStartupStyle(project.hasTypeScript);
    }
  }

  // Build code file
  const codeFile = createCodeFile();

  // Add core imports
  addImport(codeFile, { source: 'autotel/register', sideEffect: true });
  addImport(codeFile, { source: 'autotel', specifiers: ['init'] });

  // Add preset imports and config
  for (const preset of selectedPresets) {
    for (const imp of preset.imports) {
      const section = preset.type === 'backend' || preset.type === 'platform' ? 'backend' :
                      preset.type === 'plugin' ? 'plugin' :
                      preset.type === 'subscriber' ? 'subscriber' : undefined;
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

  // If no backend config was set, add placeholder
  if (!codeFile.backendConfig) {
    setBackendConfig(codeFile, '// Local/console mode - no backend configured');
  }

  const instrumentationContent = renderCodeFile(codeFile);

  // Build dependency plan
  const depPlan = buildDependencyPlan({
    presets: selectedPresets,
    autoInstrumentations,
  });

  // Collect env vars
  const envVars: EnvVar[] = [];
  for (const preset of selectedPresets) {
    envVars.push(...preset.env.required, ...preset.env.optional);
  }

  const envExampleContent = generateEnvExample(envVars);

  // Determine paths
  const instrumentationPath = getInstrumentationPath(project.packageRoot, project.hasTypeScript);
  const envExamplePath = path.join(project.packageRoot, '.env.example');

  // Dry run - just print what would happen
  if (options.dryRun) {
    output.heading('\nDry run - no files will be written\n');

    output.info(`Would write: ${path.relative(project.cwd, instrumentationPath)}`);
    console.log('---');
    console.log(instrumentationContent);
    console.log('---\n');

    if (envExampleContent) {
      output.info(`Would write: ${path.relative(project.cwd, envExamplePath)}`);
      console.log('---');
      console.log(envExampleContent);
      console.log('---\n');
    }

    const prodPkgs = getProdPackages(depPlan);
    const devPkgs = getDevPackages(depPlan);

    if (prodPkgs.length > 0) {
      const cmd = getInstallCommand(project.packageManager, prodPkgs);
      output.info(`Would run: ${cmd}`);
    }
    if (devPkgs.length > 0) {
      const cmd = getInstallCommand(project.packageManager, devPkgs, { dev: true });
      output.info(`Would run: ${cmd}`);
    }

    process.exit(0);
  }

  // Write files
  spinner.start('Writing instrumentation file...');
  const { backupPath: instrBackup } = atomicWrite(instrumentationPath, instrumentationContent, {
    root: project.packageRoot,
    backup: options.force,
  });
  if (instrBackup) {
    output.verbose(`Backup created: ${instrBackup}`);
  }
  spinner.succeed(`Wrote ${path.relative(project.cwd, instrumentationPath)}`);

  // Write .env.example if we have env vars
  if (envExampleContent && !fileExists(envExamplePath)) {
    spinner.start('Writing .env.example...');
    atomicWrite(envExamplePath, envExampleContent, { root: project.packageRoot });
    spinner.succeed(`Wrote ${path.relative(project.cwd, envExamplePath)}`);
  }

  // Install dependencies
  const prodPkgs = getProdPackages(depPlan);
  const devPkgs = getDevPackages(depPlan);

  if (!options.noInstall && (prodPkgs.length > 0 || devPkgs.length > 0)) {
    if (prodPkgs.length > 0) {
      const cmd = getInstallCommand(project.packageManager, prodPkgs);
      if (options.printInstallCmd) {
        output.info(`Install command: ${cmd}`);
      } else {
        spinner.start('Installing dependencies...');
        try {
          execSync(cmd, { cwd: project.packageRoot, stdio: 'pipe' });
          spinner.succeed('Dependencies installed');
        } catch {
          spinner.fail('Failed to install dependencies');
          output.error(`Run manually: ${cmd}`);
        }
      }
    }

    if (devPkgs.length > 0) {
      const cmd = getInstallCommand(project.packageManager, devPkgs, { dev: true });
      if (options.printInstallCmd) {
        output.info(`Install command (dev): ${cmd}`);
      } else {
        spinner.start('Installing dev dependencies...');
        try {
          execSync(cmd, { cwd: project.packageRoot, stdio: 'pipe' });
          spinner.succeed('Dev dependencies installed');
        } catch {
          spinner.fail('Failed to install dev dependencies');
          output.error(`Run manually: ${cmd}`);
        }
      }
    }
  } else if (options.noInstall && (prodPkgs.length > 0 || devPkgs.length > 0)) {
    output.info('Skipping installation (--no-install)');
    if (prodPkgs.length > 0) {
      const cmd = getInstallCommand(project.packageManager, prodPkgs);
      output.dim(`Run: ${cmd}`);
    }
    if (devPkgs.length > 0) {
      const cmd = getInstallCommand(project.packageManager, devPkgs, { dev: true });
      output.dim(`Run: ${cmd}`);
    }
  }

  // Print next steps
  const relInstrPath = path.relative(project.packageRoot, instrumentationPath);

  let nextStepCmd: string;
  switch (startupStyle) {
    case 'tsx':
      nextStepCmd = `tsx --import ./${relInstrPath} src/index.ts`;
      break;
    case 'node-esm':
    default:
      nextStepCmd = `node --import ./${relInstrPath} dist/index.js`;
  }

  // Print footer
  const pmInfo = project.workspace.isMonorepo
    ? `${project.packageManager} workspace, package root ${project.packageRoot}`
    : `${project.packageManager}`;

  const writtenFiles = [path.relative(project.cwd, instrumentationPath)];
  if (envExampleContent && !fileExists(envExamplePath)) {
    writtenFiles.push('.env.example');
  }

  console.log(output.formatFooter({
    detected: pmInfo,
    wrote: writtenFiles,
    next: nextStepCmd,
  }));

  // Print additional next steps from presets
  const allNextSteps = selectedPresets.flatMap((p) => p.nextSteps);
  if (allNextSteps.length > 0) {
    console.log('\nNext steps:');
    for (const step of allNextSteps) {
      console.log(`  - ${step}`);
    }
  }
}
