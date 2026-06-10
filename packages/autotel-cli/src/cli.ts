import { Command } from 'commander';
import type { InitOptions, DoctorOptions, AddOptions, CodemodTraceOptions } from './types/index';
import { runInit } from './commands/init';
import { runDoctor } from './commands/doctor';
import { runAdd } from './commands/add';
import { runCodemodTrace } from './commands/codemod-trace';
import {
  runSchema,
  runSchemaErrors,
  runSchemaOutputs,
  runCommandsListing,
  runExamples,
  runVersion,
} from './commands/schema';
import { registerHealthCommands } from './commands/investigate/health';
import { registerDiscoveryCommands } from './commands/investigate/discovery';
import {
  registerQueryCommands,
  registerTraceCommands,
} from './commands/investigate/investigation';
import { registerTopologyCommands } from './commands/investigate/topology';
import { registerDiagnoseCommands } from './commands/investigate/diagnosis';
import { registerCorrelateCommands } from './commands/investigate/correlation';
import { registerLlmCommands } from './commands/investigate/llm';
import { registerSemconvCommands } from './commands/investigate/semconv';
import { registerScoreCommands } from './commands/investigate/instrumentation';
import { registerCollectorCommands } from './commands/investigate/collector';
import { registerSecurityCommands } from './commands/investigate/security';

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
    // Detection-driven flow
    .option('--no-detect', 'Skip auto-detection of installed deps')
    .option('--detect-only', 'Run detection, print the plan, write nothing')
    .option('--plan <path>', 'Apply a pre-built InitPlan JSON file')
    .option('--input <path>', 'Read InitPlan JSON from stdin (-) or a file')
    .option('--scan-env', 'Consent to reading .env / .env.local for backend detection')
    // Agent-native I/O
    .option('--json', 'Emit machine-readable JSON')
    .option('--output-file <path>', 'Persist JSON output to this file')
    .option('--no-secrets-in-output', 'Redact secret-shaped values')
    .option('--no-interactive', 'Never prompt; fail if input would be required')
    .action(async (opts) => {
      // Commander maps --no-X flags to opts.X = false (NOT opts.noX), so
      // read the negative flags via the positive name.
      const options: InitOptions = {
        cwd: opts.cwd ?? process.cwd(),
        dryRun: opts.dryRun ?? false,
        noInstall: opts.install === false,
        printInstallCmd: opts.printInstallCmd ?? false,
        verbose: opts.verbose ?? false,
        quiet: opts.quiet ?? false,
        workspaceRoot: opts.workspaceRoot ?? false,
        yes: opts.yes ?? false,
        preset: opts.preset,
        force: opts.force ?? false,
        noDetect: opts.detect === false,
        detectOnly: opts.detectOnly ?? false,
        plan: opts.plan,
        input: opts.input,
        scanEnv: opts.scanEnv ?? false,
        json: opts.json ?? false,
        outputFile: opts.outputFile,
        noSecrets: opts.secretsInOutput === false,
        noInteractive: opts.interactive === false,
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

  // Codemod command
  const codemodCmd = new Command('codemod')
    .description('Codemod commands for adopting autotel');
  const traceCmd = new Command('trace')
    .description('Wrap functions in trace() with span name from function/variable/method name')
    .argument('<path>', 'File path or glob (e.g. src/index.ts, src/**/*.ts)')
    .option('--dry-run', 'Print changes without writing files')
    .option('--name-pattern <pattern>', 'Span name template: {name}, {file}, {path}')
    .option('--skip <regex>...', 'Skip functions whose name matches (repeatable)')
    .option('--print-files', 'Print per-file summary (wrapped count, skipped)')
    .action(async (pathArg: string, opts) => {
      const options: CodemodTraceOptions = {
        cwd: opts.cwd ?? process.cwd(),
        dryRun: opts.dryRun ?? false,
        noInstall: false,
        printInstallCmd: false,
        verbose: opts.verbose ?? false,
        quiet: opts.quiet ?? false,
        workspaceRoot: false,
        path: pathArg,
        namePattern: opts.namePattern,
        skip: Array.isArray(opts.skip) && opts.skip.length > 0 ? opts.skip : undefined,
        printFiles: opts.printFiles ?? false,
      };
      await runCodemodTrace(options);
    });
  addGlobalOptions(traceCmd);
  codemodCmd.addCommand(traceCmd);
  addGlobalOptions(codemodCmd);
  program.addCommand(codemodCmd);

  // Agent-native discovery surface (always JSON).
  const schemaCmd = new Command('schema')
    .description('Print the CLI manifest as JSON (agent discovery)')
    .option('--output-file <path>', 'Persist JSON to a file')
    .option('--no-secrets-in-output', 'Redact secret-shaped values')
    .action((opts) => {
      runSchema({ outputFile: opts.outputFile, noSecrets: opts.secretsInOutput === false });
    });

  const schemaErrorsCmd = new Command('errors')
    .description('Print error envelope shape + AUTOTEL_E_* codes')
    .option('--output-file <path>', 'Persist JSON to a file')
    .action((opts) => {
      runSchemaErrors({ outputFile: opts.outputFile });
    });

  const schemaOutputsCmd = new Command('outputs')
    .description('Print JSON output shapes per command')
    .option('--output-file <path>', 'Persist JSON to a file')
    .action((opts) => {
      runSchemaOutputs({ outputFile: opts.outputFile });
    });

  schemaCmd.addCommand(schemaErrorsCmd);
  schemaCmd.addCommand(schemaOutputsCmd);
  program.addCommand(schemaCmd);

  const commandsCmd = new Command('commands')
    .description('Print compact tool-style listing of commands')
    .option('--output-file <path>', 'Persist JSON to a file')
    .action((opts) => {
      runCommandsListing({ outputFile: opts.outputFile });
    });
  program.addCommand(commandsCmd);

  const examplesCmd = new Command('examples')
    .description('Print copy-pasteable examples for a command')
    .argument('[command]', 'Command name (omit for all)')
    .option('--output-file <path>', 'Persist JSON to a file')
    .action((name: string | undefined, opts) => {
      runExamples(name, { outputFile: opts.outputFile });
    });
  program.addCommand(examplesCmd);

  const versionCmd = new Command('version')
    .description('Print version info as JSON')
    .option('--output-file <path>', 'Persist JSON to a file')
    .action((opts) => {
      runVersion({ outputFile: opts.outputFile });
    });
  program.addCommand(versionCmd);

  // Investigate commands — read telemetry via the same backends autotel-mcp
  // uses, but exposed as one-shot CLI subcommands returning JSON on stdout.
  // Each command group's commander wiring lives in its own file under
  // commands/investigate/ so this surface scales without ballooning cli.ts.
  registerHealthCommands(program);
  registerDiscoveryCommands(program);
  registerQueryCommands(program);
  registerTraceCommands(program);
  registerTopologyCommands(program);
  registerDiagnoseCommands(program);
  registerCorrelateCommands(program);
  registerLlmCommands(program);
  registerSemconvCommands(program);
  registerScoreCommands(program);
  registerCollectorCommands(program);
  registerSecurityCommands(program);

  return program;
}

/**
 * Run the CLI.
 *
 * Commander's built-in error path (missing required option, unknown command,
 * etc.) writes a plain string to stderr and calls `process.exit(1)` before
 * any action runs — bypassing the JSON envelope contract investigate commands
 * promise to agents. `exitOverride()` flips that to throwing `CommanderError`
 * which the top-level handler in `index.ts` converts to an envelope.
 */
export async function run(): Promise<void> {
  const program = createProgram();
  program.exitOverride();
  // Investigate / JSON-only commands need their failure path to be
  // single-document JSON. Commander defaults to writing an `error: ...`
  // line to stderr before raising, which doubles the output an agent sees.
  // Suppress it for JSON-only invocations; humans on other commands still
  // get the helpful stderr hint.
  const argvJoined = process.argv.slice(2).join(' ');
  const isJsonOnly =
    process.argv.includes('--json') ||
    /^(schema|commands|examples|version|health|capabilities|discover|query|trace|diagnose|topology|correlate|llm|semconv|score|collector)\b/.test(
      argvJoined,
    );
  if (isJsonOnly) {
    program.configureOutput({ writeErr: () => {} });
  }
  // Apply exitOverride (+ stderr suppression) to every subcommand too;
  // commander doesn't propagate either automatically through `addCommand()`.
  const stack: Command[] = [...program.commands];
  while (stack.length > 0) {
    const cmd = stack.pop()!;
    cmd.exitOverride();
    if (isJsonOnly) {
      cmd.configureOutput({ writeErr: () => {} });
    }
    stack.push(...cmd.commands);
  }
  await program.parseAsync(process.argv);
}
