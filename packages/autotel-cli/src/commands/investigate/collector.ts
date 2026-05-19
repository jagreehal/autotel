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

type ComponentKind =
  | 'receiver'
  | 'processor'
  | 'exporter'
  | 'connector'
  | 'extension';

function readJsonFromStdinOrFile(file?: string): unknown {
  const raw = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
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
    const config = readJsonFromStdinOrFile(flags.configFile);
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
  flags: InvestigateFlags & { version?: string; kind?: ComponentKind },
): Promise<void> {
  await runStatic('collector components', flags, async () => {
    assertVersion(flags.version);
    const resolvedVersion = await resolveCollectorVersion(flags.version);
    const components = await listCollectorComponents(resolvedVersion);
    if (flags.kind) {
      return {
        version: resolvedVersion,
        kind: flags.kind,
        components: components[flags.kind],
      };
    }
    return { version: resolvedVersion, components };
  });
}

export async function runCollectorSchema(
  flags: InvestigateFlags & {
    version?: string;
    kind: ComponentKind;
    name: string;
  },
): Promise<void> {
  await runStatic('collector schema', flags, async () => {
    assertVersion(flags.version);
    const resolvedVersion = await resolveCollectorVersion(flags.version);
    const schema = await getCollectorComponentSchema(
      flags.kind,
      flags.name,
      resolvedVersion,
    );
    return { version: resolvedVersion, kind: flags.kind, name: flags.name, schema };
  });
}

export async function runCollectorReadme(
  flags: InvestigateFlags & {
    version?: string;
    kind: ComponentKind;
    name: string;
  },
): Promise<void> {
  await runStatic('collector readme', flags, async () => {
    assertVersion(flags.version);
    const resolvedVersion = await resolveCollectorVersion(flags.version);
    const readme = await getCollectorComponentReadme(
      flags.kind,
      flags.name,
      resolvedVersion,
    );
    return { version: resolvedVersion, kind: flags.kind, name: flags.name, readme };
  });
}

export async function runCollectorValidateComponent(
  flags: InvestigateFlags & {
    version?: string;
    kind: ComponentKind;
    name: string;
    configFile?: string;
  },
): Promise<void> {
  await runStatic('collector validate-component', flags, async () => {
    assertVersion(flags.version);
    const resolvedVersion = await resolveCollectorVersion(flags.version);
    const config = readJsonFromStdinOrFile(flags.configFile);
    const result = await validateCollectorComponentConfig({
      kind: flags.kind,
      name: flags.name,
      version: resolvedVersion,
      config,
    });
    return { version: resolvedVersion, kind: flags.kind, name: flags.name, ...result };
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
        configFile: o.configFile as string | undefined,
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
        version: o.version as string | undefined,
        kind: o.kind as
          | 'receiver'
          | 'processor'
          | 'exporter'
          | 'connector'
          | 'extension'
          | undefined,
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
        kind: o.kind as
          | 'receiver'
          | 'processor'
          | 'exporter'
          | 'connector'
          | 'extension',
        name: o.name as string,
        version: o.version as string | undefined,
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
        kind: o.kind as
          | 'receiver'
          | 'processor'
          | 'exporter'
          | 'connector'
          | 'extension',
        name: o.name as string,
        version: o.version as string | undefined,
      });
    });
  const validateComponentCmd = addStaticFlags(
    new Command('validate-component'),
  )
    .description('Validate component config against upstream schema')
    .requiredOption('--kind <kind>', 'Component kind')
    .requiredOption('--name <name>', 'Component name')
    .option('--version <semver>', 'Collector version')
    .option('--config-file <path>', 'Read JSON config (default: stdin)')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runCollectorValidateComponent({
        ...staticFlagsFromOpts(o),
        kind: o.kind as
          | 'receiver'
          | 'processor'
          | 'exporter'
          | 'connector'
          | 'extension',
        name: o.name as string,
        version: o.version as string | undefined,
        configFile: o.configFile as string | undefined,
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
