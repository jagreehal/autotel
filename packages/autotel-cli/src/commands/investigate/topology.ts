import { Command } from 'commander';
import { runInvestigate, type InvestigateFlags } from './runtime';
import {
  addBackendFlags,
  backendFlagsFromOpts,
  intArg,
} from './cli-helpers';

export async function runListServices(flags: InvestigateFlags): Promise<void> {
  await runInvestigate('topology services', flags, async (backend) =>
    backend.listServices(),
  );
}

export async function runListOperations(
  flags: InvestigateFlags & { serviceName: string },
): Promise<void> {
  await runInvestigate('topology operations', flags, async (backend) =>
    backend.listOperations(flags.serviceName),
  );
}

export async function runServiceMap(
  flags: InvestigateFlags & { lookbackMinutes?: number; limit?: number },
): Promise<void> {
  await runInvestigate('topology map', flags, async (backend) =>
    backend.serviceMap(flags.lookbackMinutes ?? 60, flags.limit ?? 20),
  );
}

export function registerTopologyCommands(program: Command): void {
  const topologyCmd = new Command('topology').description(
    'Service topology commands (JSON)',
  );
  const servicesCmd = new Command('services')
    .description('List known services')
    .action(async function (this: Command) {
      await runListServices(backendFlagsFromOpts(this.optsWithGlobals()));
    });
  const operationsCmd = new Command('operations')
    .description('List operations for a service')
    .argument('<serviceName>', 'Service name')
    .action(async function (this: Command, serviceName: string) {
      await runListOperations({
        ...backendFlagsFromOpts(this.optsWithGlobals()),
        serviceName,
      });
    });
  const mapCmd = new Command('map')
    .description('Build a service dependency map')
    .option('--lookback-minutes <n>', 'Lookback in minutes', intArg)
    .option('--limit <n>', 'Max services', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runServiceMap({
        ...backendFlagsFromOpts(o),
        lookbackMinutes: o.lookbackMinutes as number | undefined,
        limit: o.limit as number | undefined,
      });
    });
  addBackendFlags(topologyCmd);
  topologyCmd.addCommand(servicesCmd);
  topologyCmd.addCommand(operationsCmd);
  topologyCmd.addCommand(mapCmd);
  program.addCommand(topologyCmd);
}
