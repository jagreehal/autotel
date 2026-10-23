import {
  validateOtlpReceiverConfig,
  suggestCollectorConfig,
  buildCollectorGuide,
  listCollectorVersions,
  listCollectorComponents,
  getCollectorComponentSchema,
  getCollectorComponentReadme,
  validateCollectorComponentConfig,
  refreshCollectorCatalog,
  resolveCollectorVersion,
} from 'autotel-mcp';
import { Command } from 'commander';
import { runStatic, type InvestigateFlags } from './runtime';
import { addStaticFlags, staticFlagsFromOpts } from './cli-helpers';
import { AutotelError } from '../../lib/errors';
import * as fs from 'node:fs';
import { stringOpt } from '../../lib/opts.js';

const COMPONENT_KINDS = [
  'receiver',
  'processor',
  'exporter',
  'connector',
  'extension',
] as const;
type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** `--kind`, checked against the kinds the catalog has. */
function parseKind(kind: string): ComponentKind {
  const known = COMPONENT_KINDS.find((candidate) => candidate === kind);
  if (known === undefined) {
    throw new AutotelError({
      type: 'validation',
      code: 'AUTOTEL_E_INVALID_INPUT',
      message: `--kind must be one of ${COMPONENT_KINDS.join(' | ')} (got "${kind}")`,
      retryable: false,
    });
  }
  return known;
}

/** Raw JSON text; the collector validators parse what it holds. */
function readTextFromStdinOrFile(file?: string): string {
  return file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
}

function assertVersion(version: string | undefined): void {
  if (version === undefined) return;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new AutotelError({
      type: 'validation',
      code: 'AUTOTEL_E_INVALID_INPUT',
      message: `--version must be semver (got "${version}")`,
      retryable: false,
    });
  }
}

export async function runCollectorValidate(
  flags: InvestigateFlags & { configFile?: string },
): Promise<void> {
  await runStatic('collector validate', flags, async () => {
    const config = JSON.parse(readTextFromStdinOrFile(flags.configFile));
    return validateOtlpReceiverConfig(config);
  });
}

export async function runCollectorSuggest(
  flags: InvestigateFlags,
): Promise<void> {
  await runStatic('collector suggest', flags, async () => ({
    suggestion: suggestCollectorConfig(),
  }));
}

export async function runCollectorExplain(
  flags: InvestigateFlags,
): Promise<void> {
  await runStatic('collector explain', flags, async () => ({
    guide: buildCollectorGuide(),
  }));
}

export async function runCollectorVersions(
  flags: InvestigateFlags,
): Promise<void> {
  await runStatic('collector versions', flags, async () => ({
    versions: await listCollectorVersions(),
  }));
}

export async function runCollectorComponents(
  flags: InvestigateFlags & { version?: string; kind?: string },
): Promise<void> {
  await runStatic('collector components', flags, async () => {
    assertVersion(flags.version);
    const resolvedVersion = await resolveCollectorVersion(flags.version);
    const kind = flags.kind ? parseKind(flags.kind) : undefined;
    const components = await listCollectorComponents(resolvedVersion);
    if (kind) {
      return {
        version: resolvedVersion,
        kind,
        components: components[kind],
      };
    }
    return { version: resolvedVersion, components };
  });
}

export async function runCollectorSchema(
  flags: InvestigateFlags & {
    version?: string;
    kind: string;
    name: string;
  },
): Promise<void> {
  await runStatic('collector schema', flags, async () => {
    assertVersion(flags.version);
    const kind = parseKind(flags.kind);
    const resolvedVersion = await resolveCollectorVersion(flags.version);
    const schema = await getCollectorComponentSchema(
      kind,
      flags.name,
      resolvedVersion,
    );
    return {
      version: resolvedVersion,
      kind,
      name: flags.name,
      schema,
    };
  });
}

export async function runCollectorReadme(
  flags: InvestigateFlags & {
    version?: string;
    kind: string;
    name: string;
  },
): Promise<void> {
  await runStatic('collector readme', flags, async () => {
    assertVersion(flags.version);
    const kind = parseKind(flags.kind);
    const resolvedVersion = await resolveCollectorVersion(flags.version);
    const readme = await getCollectorComponentReadme(
      kind,
      flags.name,
      resolvedVersion,
    );
    return {
      version: resolvedVersion,
      kind,
      name: flags.name,
      readme,
    };
  });
}

export async function runCollectorValidateComponent(
  flags: InvestigateFlags & {
    version?: string;
    kind: string;
    name: string;
    configFile?: string;
  },
): Promise<void> {
  await runStatic('collector validate-component', flags, async () => {
    assertVersion(flags.version);
    const kind = parseKind(flags.kind);
    const resolvedVersion = await resolveCollectorVersion(flags.version);
    const config = JSON.parse(readTextFromStdinOrFile(flags.configFile));
    const result = await validateCollectorComponentConfig({
      kind,
      name: flags.name,
      version: resolvedVersion,
      config,
    });
    return {
      version: resolvedVersion,
      kind,
      name: flags.name,
      ...result,
    };
  });
}

export async function runCollectorRefresh(
  flags: InvestigateFlags,
): Promise<void> {
  await runStatic('collector refresh', flags, async () =>
    refreshCollectorCatalog(),
  );
}

export function registerCollectorCommands(program: Command): void {
  const collectorCmd = new Command('collector').description(
    'OpenTelemetry Collector config + schema commands (JSON)',
  );
  const validateCmd = addStaticFlags(new Command('validate'))
    .description('Validate an OTLP receiver config fragment')
    .option('--config-file <path>', 'Read JSON config (default: stdin)')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runCollectorValidate({
        ...staticFlagsFromOpts(o),
        configFile: stringOpt(o, 'configFile'),
      });
    });
  const suggestCmd = addStaticFlags(new Command('suggest'))
    .description('Print a minimal OTLP receiver config')
    .action(async function (this: Command) {
      await runCollectorSuggest(staticFlagsFromOpts(this.optsWithGlobals()));
    });
  const explainCmd = addStaticFlags(new Command('explain'))
    .description('Explain OTLP receiver config shape + defaults')
    .action(async function (this: Command) {
      await runCollectorExplain(staticFlagsFromOpts(this.optsWithGlobals()));
    });
  const versionsCmd = addStaticFlags(new Command('versions'))
    .description('List supported collector schema versions')
    .action(async function (this: Command) {
      await runCollectorVersions(staticFlagsFromOpts(this.optsWithGlobals()));
    });
  const componentsCmd = addStaticFlags(new Command('components'))
    .description('List components for a version (optionally filter by kind)')
    .option('--version <semver>', 'Collector version (e.g. 0.110.0)')
    .option(
      '--kind <kind>',
      'receiver | processor | exporter | connector | extension',
    )
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runCollectorComponents({
        ...staticFlagsFromOpts(o),
        version: stringOpt(o, 'version'),
        kind: stringOpt(o, 'kind'),
      });
    });
  const schemaCmd = addStaticFlags(new Command('schema'))
    .description('Get JSON Schema for a collector component')
    .requiredOption('--kind <kind>', 'Component kind')
    .requiredOption('--name <name>', 'Component name')
    .option('--version <semver>', 'Collector version')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runCollectorSchema({
        ...staticFlagsFromOpts(o),
        kind: stringOpt(o, 'kind') ?? '',
        name: stringOpt(o, 'name') ?? '',
        version: stringOpt(o, 'version'),
      });
    });
  const readmeCmd = addStaticFlags(new Command('readme'))
    .description('Get README for a collector component')
    .requiredOption('--kind <kind>', 'Component kind')
    .requiredOption('--name <name>', 'Component name')
    .option('--version <semver>', 'Collector version')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runCollectorReadme({
        ...staticFlagsFromOpts(o),
        kind: stringOpt(o, 'kind') ?? '',
        name: stringOpt(o, 'name') ?? '',
        version: stringOpt(o, 'version'),
      });
    });
  const validateComponentCmd = addStaticFlags(new Command('validate-component'))
    .description('Validate component config against upstream schema')
    .requiredOption('--kind <kind>', 'Component kind')
    .requiredOption('--name <name>', 'Component name')
    .option('--version <semver>', 'Collector version')
    .option('--config-file <path>', 'Read JSON config (default: stdin)')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runCollectorValidateComponent({
        ...staticFlagsFromOpts(o),
        kind: stringOpt(o, 'kind') ?? '',
        name: stringOpt(o, 'name') ?? '',
        version: stringOpt(o, 'version'),
        configFile: stringOpt(o, 'configFile'),
      });
    });
  const refreshCmd = addStaticFlags(new Command('refresh'))
    .description('Refresh in-memory collector metadata cache')
    .action(async function (this: Command) {
      await runCollectorRefresh(staticFlagsFromOpts(this.optsWithGlobals()));
    });
  collectorCmd.addCommand(validateCmd);
  collectorCmd.addCommand(suggestCmd);
  collectorCmd.addCommand(explainCmd);
  collectorCmd.addCommand(versionsCmd);
  collectorCmd.addCommand(componentsCmd);
  collectorCmd.addCommand(schemaCmd);
  collectorCmd.addCommand(readmeCmd);
  collectorCmd.addCommand(validateComponentCmd);
  collectorCmd.addCommand(refreshCmd);
  program.addCommand(collectorCmd);
}
