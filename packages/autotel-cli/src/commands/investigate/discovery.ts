import { Command } from 'commander';
import {
  discoverServices,
  discoverTraceFields,
  discoverLogFields,
  type TelemetryBackend,
} from 'autotel-mcp';
import { runInvestigate, type InvestigateFlags } from './runtime';
import {
  addBackendFlags,
  backendFlagsFromOpts,
  intArg,
} from './cli-helpers';

export interface DiscoverServicesFlags extends InvestigateFlags {
  limitServices?: number;
  traceSample?: number;
  logSample?: number;
  metricSample?: number;
}

export async function runDiscoverServices(
  flags: DiscoverServicesFlags,
): Promise<void> {
  await runInvestigate('discover services', flags, async (backend) => {
    const limitServices = flags.limitServices ?? 100;
    const traceSample = flags.traceSample ?? 200;
    const logSample = flags.logSample ?? 200;
    const metricSample = flags.metricSample ?? 200;

    const caps = backend.capabilities();
    const servicesResult = await backend.listServices({ limit: limitServices });
    const services = servicesResult.services.slice(0, limitServices);

    const [traces, logs, metrics] = await Promise.all([
      caps.traces === 'available'
        ? backend.searchTraces({ limit: traceSample }).then((r) => r.items)
        : Promise.resolve([]),
      caps.logs === 'available'
        ? backend.searchLogs({ limit: logSample }).then((r) => r.items)
        : Promise.resolve([]),
      caps.metrics === 'available'
        ? backend.listMetrics({ limit: metricSample }).then((r) => r.items)
        : Promise.resolve([]),
    ]);

    const discovered = discoverServices({ services, traces, logs, metrics });
    return { count: discovered.length, services: discovered };
  });
}

export interface DiscoverFieldsFlags extends InvestigateFlags {
  search?: string;
  sampleSize?: number;
}

export async function runDiscoverTraceFields(
  flags: DiscoverFieldsFlags,
): Promise<void> {
  await runInvestigate('discover trace-fields', flags, async (backend) => {
    return discoverFields(backend, flags, 'traces');
  });
}

export async function runDiscoverLogFields(
  flags: DiscoverFieldsFlags,
): Promise<void> {
  await runInvestigate('discover log-fields', flags, async (backend) => {
    return discoverFields(backend, flags, 'logs');
  });
}

async function discoverFields(
  backend: TelemetryBackend,
  flags: DiscoverFieldsFlags,
  signal: 'traces' | 'logs',
): Promise<unknown> {
  const sampleSize = flags.sampleSize ?? 200;
  if (signal === 'traces') {
    const traces = await backend
      .searchTraces({ limit: sampleSize })
      .then((r) => r.items);
    return {
      search: flags.search ?? null,
      sampleSize: traces.length,
      ...discoverTraceFields(traces, flags.search),
    };
  }
  const logs = await backend
    .searchLogs({ limit: sampleSize })
    .then((r) => r.items);
  return {
    search: flags.search ?? null,
    sampleSize: logs.length,
    ...discoverLogFields(logs, flags.search),
  };
}

export function registerDiscoveryCommands(program: Command): void {
  const discoverCmd = new Command('discover').description(
    'Discover services and field shapes from the active backend (JSON)',
  );
  const servicesCmd = new Command('services')
    .description('Discover services with cross-signal metadata')
    .option('--limit-services <n>', 'Max services', intArg)
    .option('--trace-sample <n>', 'Trace sample size', intArg)
    .option('--log-sample <n>', 'Log sample size', intArg)
    .option('--metric-sample <n>', 'Metric sample size', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runDiscoverServices({
        ...backendFlagsFromOpts(o),
        limitServices: o.limitServices as number | undefined,
        traceSample: o.traceSample as number | undefined,
        logSample: o.logSample as number | undefined,
        metricSample: o.metricSample as number | undefined,
      });
    });
  const traceFieldsCmd = new Command('trace-fields')
    .description('Discover trace/span field names from sampled traces')
    .option('--search <text>', 'Filter field names by substring')
    .option('--sample-size <n>', 'Trace sample size', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runDiscoverTraceFields({
        ...backendFlagsFromOpts(o),
        search: o.search as string | undefined,
        sampleSize: o.sampleSize as number | undefined,
      });
    });
  const logFieldsCmd = new Command('log-fields')
    .description('Discover log field names from sampled logs')
    .option('--search <text>', 'Filter field names by substring')
    .option('--sample-size <n>', 'Log sample size', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runDiscoverLogFields({
        ...backendFlagsFromOpts(o),
        search: o.search as string | undefined,
        sampleSize: o.sampleSize as number | undefined,
      });
    });
  addBackendFlags(discoverCmd);
  discoverCmd.addCommand(servicesCmd);
  discoverCmd.addCommand(traceFieldsCmd);
  discoverCmd.addCommand(logFieldsCmd);
  program.addCommand(discoverCmd);
}
