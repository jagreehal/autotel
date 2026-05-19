import { Command } from 'commander';
import type { InvestigateFlags } from './runtime';
import { runInvestigate } from './runtime';
import { addBackendFlags, backendFlagsFromOpts } from './cli-helpers';

export async function runHealth(flags: InvestigateFlags): Promise<void> {
  await runInvestigate('health', flags, async (backend) => {
    const [health, capabilities] = await Promise.all([
      backend.healthCheck(),
      Promise.resolve(backend.capabilities()),
    ]);
    return { ...health, signals: capabilities };
  });
}

export async function runCapabilities(flags: InvestigateFlags): Promise<void> {
  await runInvestigate('capabilities', flags, async (backend) =>
    backend.capabilities(),
  );
}

export function registerHealthCommands(program: Command): void {
  const healthCmd = new Command('health')
    .description('Backend health check + signal coverage (JSON)')
    .action(async function (this: Command) {
      await runHealth(backendFlagsFromOpts(this.opts()));
    });
  addBackendFlags(healthCmd);
  program.addCommand(healthCmd);

  const capabilitiesCmd = new Command('capabilities')
    .description('Which telemetry signals the active backend can serve (JSON)')
    .action(async function (this: Command) {
      await runCapabilities(backendFlagsFromOpts(this.opts()));
    });
  addBackendFlags(capabilitiesCmd);
  program.addCommand(capabilitiesCmd);
}
