import { Command } from 'commander';
import type { InitOptions, DoctorOptions, AddOptions } from './types/index';
import { runInit } from './commands/init';
import { runDoctor } from './commands/doctor';
import { runAdd } from './commands/add';

/**
 * Create the CLI program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('autotel')
    .description('CLI for autotel - setup wizard, diagnostics, and incremental features')
    .version('0.1.0');

  // Global options
  const addGlobalOptions = (cmd: Command): Command => {
    return cmd
      .option('--cwd <path>', 'Target directory', process.cwd())
      .option('--verbose', 'Show detailed output')
      .option('--quiet', 'Only show warnings and errors');
  };

  // Init command
  const initCmd = new Command('init')
    .description('Initialize autotel in your project')
    .option('--dry-run', 'Skip installation and print what would be done')
    .option('--no-install', 'Generate files only, skip package installation')
    .option('--print-install-cmd', 'Output the install command without running it')
    .option('-y, --yes', 'Accept defaults, non-interactive')
    .option('--preset <name>', 'Use a quick preset (e.g., node-datadog-pino)')
    .option('--force', 'Overwrite existing config (creates backup first)')
    .option('--workspace-root', 'Install at workspace root instead of package root')
    .action(async (opts) => {
      const options: InitOptions = {
        cwd: opts.cwd ?? process.cwd(),
        dryRun: opts.dryRun ?? false,
        noInstall: opts.noInstall ?? false,
        printInstallCmd: opts.printInstallCmd ?? false,
        verbose: opts.verbose ?? false,
        quiet: opts.quiet ?? false,
        workspaceRoot: opts.workspaceRoot ?? false,
        yes: opts.yes ?? false,
        preset: opts.preset,
        force: opts.force ?? false,
      };

      // --dry-run implies --no-install and --print-install-cmd
      if (options.dryRun) {
        options.noInstall = true;
        options.printInstallCmd = true;
      }

      await runInit(options);
    });

  addGlobalOptions(initCmd);
  program.addCommand(initCmd);

  // Doctor command
  const doctorCmd = new Command('doctor')
    .description('Run diagnostics on your autotel setup')
    .option('--json', 'Output machine-readable JSON')
    .option('--fix', 'Auto-fix resolvable issues')
    .option('--list-checks', 'List all available checks')
    .option('--env-file <path>', 'Specify env file to check')
    .action(async (opts) => {
      const options: DoctorOptions = {
        cwd: opts.cwd ?? process.cwd(),
        dryRun: false,
        noInstall: false,
        printInstallCmd: false,
        verbose: opts.verbose ?? false,
        quiet: opts.quiet ?? false,
        workspaceRoot: false,
        json: opts.json ?? false,
        fix: opts.fix ?? false,
        listChecks: opts.listChecks ?? false,
        envFile: opts.envFile,
      };

      await runDoctor(options);
    });

  addGlobalOptions(doctorCmd);
  program.addCommand(doctorCmd);

  // Add command
  const addCmd = new Command('add')
    .description('Add a backend, subscriber, plugin, or platform')
    .argument('[type]', 'Preset type (backend, subscriber, plugin, platform)')
    .argument('[name]', 'Preset name (e.g., datadog, posthog, mongoose)')
    .option('--list', 'List available presets for the given type')
    .option('--dry-run', 'Skip installation and print what would be done')
    .option('--no-install', 'Generate files only, skip package installation')
    .option('--print-install-cmd', 'Output the install command without running it')
    .option('-y, --yes', 'Accept defaults, non-interactive')
    .option('--force', 'Overwrite non-CLI-owned config (creates backup first)')
    .option('--json', 'Output machine-readable JSON (for --list)')
    .option('--workspace-root', 'Install at workspace root instead of package root')
    .action(async (type, name, opts) => {
      const options: AddOptions = {
        cwd: opts.cwd ?? process.cwd(),
        dryRun: opts.dryRun ?? false,
        noInstall: opts.noInstall ?? false,
        printInstallCmd: opts.printInstallCmd ?? false,
        verbose: opts.verbose ?? false,
        quiet: opts.quiet ?? false,
        workspaceRoot: opts.workspaceRoot ?? false,
        list: opts.list ?? false,
        yes: opts.yes ?? false,
        force: opts.force ?? false,
        json: opts.json ?? false,
      };

      // --dry-run implies --no-install and --print-install-cmd
      if (options.dryRun) {
        options.noInstall = true;
        options.printInstallCmd = true;
      }

      await runAdd(type, name, options);
    });

  addGlobalOptions(addCmd);
  program.addCommand(addCmd);

  return program;
}

/**
 * Run the CLI
 */
export async function run(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);
}
