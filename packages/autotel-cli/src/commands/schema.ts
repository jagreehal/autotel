import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureJsonOutput, printJson } from '../lib/json-output';
import {
  COMMANDS,
  ERROR_CATALOGUE,
  getCommand,
  type CommandSpec,
} from '../lib/manifest';
import { AutotelError, AutotelErrorCodes } from '../lib/errors';

interface SchemaCommonOptions {
  outputFile?: string;
  noSecrets?: boolean;
}

function configure(opts: SchemaCommonOptions): void {
  configureJsonOutput({
    outputFile: opts.outputFile,
    noSecrets: opts.noSecrets,
  });
}

function readSelfVersion(): string {
  try {
    // dist/index.js → walks up to package root
    const here = path.dirname(fileURLToPath(import.meta.url));
    let dir = here;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (pkg.name === 'autotel-cli') return String(pkg.version ?? '0.0.0');
      }
      dir = path.dirname(dir);
    }
  } catch {
    // fall through
  }
  return '0.0.0';
}

/** `autotel schema [--json]` — full manifest. */
export function runSchema(opts: SchemaCommonOptions): void {
  configure(opts);
  printJson({
    ok: true,
    command: 'autotel schema',
    version: readSelfVersion(),
    commands: COMMANDS,
  });
}

/** `autotel schema errors [--json]` */
export function runSchemaErrors(opts: SchemaCommonOptions): void {
  configure(opts);
  printJson({
    ok: true,
    command: 'autotel schema errors',
    envelope: {
      ok: false,
      command: '<command>',
      error: {
        type: '<one of: validation, environment, auth, conflict, install, io, runtime>',
        code: '<AUTOTEL_E_*>',
        message: 'human-readable message',
        retryable: false,
        fix: 'optional remediation hint',
        expected: { '<key>': '<value>' },
        suggestions: ['optional follow-up commands'],
      },
    },
    codes: ERROR_CATALOGUE,
    exitCodes: {
      '0': 'success',
      '1': 'runtime / unexpected failure',
      '2': 'validation / conflict / refusal',
    },
  });
}

/** `autotel schema outputs [--json]` — JSON output shapes per command. */
export function runSchemaOutputs(opts: SchemaCommonOptions): void {
  configure(opts);
  // For v1 we publish the shape of init's JSON plan output. Other commands
  // can be filled in incrementally.
  printJson({
    ok: true,
    command: 'autotel schema outputs',
    outputs: {
      'autotel init --json': {
        ok: 'boolean',
        command: 'string',
        detected: {
          packages: 'array of { name, version, resolution: "target" | "workspace-root" }',
          logger: '"pino" | "winston" | "bunyan" | null',
          backend: '{ source: "env" | "wrangler" | "deps" | "prompt" | "default", value: string }',
          platform: '"cloudflare" | "aws-lambda" | "edge" | null',
        },
        plan: {
          presets: 'string[] (slugs)',
          packagesToInstall: { prod: 'string[]', dev: 'string[]' },
          filesToWrite: 'array of { path, action: "create" | "merge" | "skip" }',
          envVars: 'array of { name, sensitive, action }',
        },
        nextSteps: 'string[]',
      },
    },
  });
}

/** `autotel commands [--json]` — compact listing. */
export function runCommandsListing(opts: SchemaCommonOptions): void {
  configure(opts);
  const compact = COMMANDS.map((c: CommandSpec) => ({
    name: c.name,
    description: c.description,
    mutating: c.mutating,
    network: c.network,
    writesFiles: c.writesFiles,
    supportsDryRun: c.supportsDryRun,
    supportsJson: c.supportsJson,
  }));
  printJson({ ok: true, command: 'autotel commands', commands: compact });
}

/** `autotel examples [name] [--json]` */
export function runExamples(
  name: string | undefined,
  opts: SchemaCommonOptions
): void {
  configure(opts);

  if (name === undefined) {
    const all = COMMANDS.filter((c) => c.examples && c.examples.length > 0).map(
      (c) => ({ command: c.name, examples: c.examples })
    );
    printJson({ ok: true, command: 'autotel examples', examples: all });
    return;
  }

  const cmd = getCommand(name);
  if (!cmd) {
    throw new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_INVALID_INPUT,
      message: `Unknown command: ${name}`,
      expected: { command: COMMANDS.map((c) => c.name) },
      fix: 'Run `autotel commands --json` to see available commands',
    });
  }
  printJson({
    ok: true,
    command: 'autotel examples',
    target: cmd.name,
    examples: cmd.examples ?? [],
  });
}

/** `autotel version [--json]` */
export function runVersion(opts: SchemaCommonOptions): void {
  configure(opts);
  printJson({
    ok: true,
    command: 'autotel version',
    version: readSelfVersion(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  });
}
