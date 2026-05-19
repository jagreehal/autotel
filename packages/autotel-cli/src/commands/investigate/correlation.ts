import { Command } from 'commander';
import { detectAnomalies, findRootCause } from 'autotel-mcp';
import { runInvestigate, type InvestigateFlags } from './runtime';
import {
  addBackendFlags,
  backendFlagsFromOpts,
  intArg,
} from './cli-helpers';

export async function runCorrelate(
  flags: InvestigateFlags & { traceId: string },
): Promise<void> {
  await runInvestigate('correlate trace', flags, async (backend) =>
    backend.getCorrelatedSignals(flags.traceId),
  );
}

export async function runExplainSlowdown(
  flags: InvestigateFlags & { service: string; lookbackMinutes?: number },
): Promise<void> {
  await runInvestigate('correlate explain-slowdown', flags, async (backend) => {
    const lookback = flags.lookbackMinutes ?? 60;
    const nowMs = Date.now();
    const result = await backend.searchTraces({
      service: flags.service,
      startTimeUnixMs: nowMs - lookback * 60 * 1000,
      endTimeUnixMs: nowMs,
      limit: 100,
    });

    const anomalies = detectAnomalies(result.items, { service: flags.service });

    const findings = await Promise.all(
      anomalies.map(async (anomaly) => {
        const sampleTraceId = anomaly.affectedTraceIds[0];
        if (!sampleTraceId) {
          return { anomaly, rootCause: null, correlatedSignals: null };
        }
        const trace = await backend.getTrace(sampleTraceId);
        const rootCause = trace ? findRootCause(trace) : null;
        const correlatedSignals =
          await backend.getCorrelatedSignals(sampleTraceId);
        return { anomaly, rootCause, correlatedSignals };
      }),
    );

    return {
      service: flags.service,
      lookbackMinutes: lookback,
      anomalyCount: anomalies.length,
      findings,
    };
  });
}

export function registerCorrelateCommands(program: Command): void {
  const correlateCmd = new Command('correlate').description(
    'Cross-signal correlation (JSON)',
  );
  const traceCmd = new Command('trace')
    .description('Trace + metrics + correlated logs for a trace ID')
    .argument('<traceId>', 'Trace ID')
    .action(async function (this: Command, traceId: string) {
      await runCorrelate({
        ...backendFlagsFromOpts(this.optsWithGlobals()),
        traceId,
      });
    });
  const slowdownCmd = new Command('explain-slowdown')
    .description('Identify when/why a service degraded')
    .requiredOption('--service <name>', 'Service name')
    .option('--lookback-minutes <n>', 'Lookback in minutes', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runExplainSlowdown({
        ...backendFlagsFromOpts(o),
        service: o.service as string,
        lookbackMinutes: o.lookbackMinutes as number | undefined,
      });
    });
  addBackendFlags(correlateCmd);
  correlateCmd.addCommand(traceCmd);
  correlateCmd.addCommand(slowdownCmd);
  program.addCommand(correlateCmd);
}
