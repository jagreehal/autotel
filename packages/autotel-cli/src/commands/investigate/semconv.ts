import {
  clearSemanticConventionCache,
  getSemanticConventionNamespace,
  listSemanticConventionNamespaces,
} from 'autotel-mcp';
import { Command } from 'commander';
import { runStatic, type InvestigateFlags } from './runtime';
import { addStaticFlags, staticFlagsFromOpts } from './cli-helpers';

export async function runSemconvList(flags: InvestigateFlags): Promise<void> {
  await runStatic('semconv list', flags, async () => ({
    namespaces: await listSemanticConventionNamespaces(),
  }));
}

export async function runSemconvGet(
  flags: InvestigateFlags & { namespace: string },
): Promise<void> {
  await runStatic('semconv get', flags, async () =>
    getSemanticConventionNamespace(flags.namespace),
  );
}

export async function runSemconvRefresh(
  flags: InvestigateFlags,
): Promise<void> {
  await runStatic('semconv refresh', flags, async () => {
    clearSemanticConventionCache();
    return { cleared: true };
  });
}

export function registerSemconvCommands(program: Command): void {
  const semconvCmd = new Command('semconv').description(
    'OpenTelemetry semantic conventions lookup (JSON)',
  );
  const listCmd = addStaticFlags(new Command('list'))
    .description('List semconv namespaces')
    .action(async function (this: Command) {
      await runSemconvList(staticFlagsFromOpts(this.optsWithGlobals()));
    });
  const getCmd = addStaticFlags(new Command('get'))
    .description('Get groups for one namespace')
    .argument('<namespace>', 'Namespace (e.g. http, rpc, database)')
    .action(async function (this: Command, namespace: string) {
      await runSemconvGet({
        ...staticFlagsFromOpts(this.optsWithGlobals()),
        namespace,
      });
    });
  const refreshCmd = addStaticFlags(new Command('refresh'))
    .description('Clear semconv cache')
    .action(async function (this: Command) {
      await runSemconvRefresh(staticFlagsFromOpts(this.optsWithGlobals()));
    });
  semconvCmd.addCommand(listCmd);
  semconvCmd.addCommand(getCmd);
  semconvCmd.addCommand(refreshCmd);
  program.addCommand(semconvCmd);
}
