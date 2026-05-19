import { Command } from 'commander';
import {
  detectAnomalies,
  findRootCause,
  pickErrorMessage,
} from 'autotel-mcp';
import { runInvestigate, type InvestigateFlags } from './runtime';
import {
  addBackendFlags,
  backendFlagsFromOpts,
  floatArg,
  intArg,
} from './cli-helpers';

export interface AnomaliesFlags extends InvestigateFlags {
  service?: string;
  operation?: string;
  lookbackMinutes?: number;
}

export async function runDiagnoseAnomalies(
  flags: AnomaliesFlags,
): Promise<void> {
  await runInvestigate('diagnose anomalies', flags, async (backend) => {
    const lookback = flags.lookbackMinutes ?? 60;
    const nowMs = Date.now();
    const result = await backend.searchTraces({
      service: flags.service,
      startTimeUnixMs: nowMs - lookback * 60 * 1000,
      endTimeUnixMs: nowMs,
      limit: 100,
    });
    return detectAnomalies(result.items, {
      service: flags.service,
      operation: flags.operation,
    });
  });
}

export async function runDiagnoseRootCause(
  flags: InvestigateFlags & { traceId: string },
): Promise<void> {
  await runInvestigate('diagnose root-cause', flags, async (backend) => {
    const trace = await backend.getTrace(flags.traceId);
    if (!trace) return { error: `Trace not found: ${flags.traceId}` };
    return findRootCause(trace);
  });
}

export interface DiagnoseErrorsFlags extends InvestigateFlags {
  service?: string;
  lookbackMinutes?: number;
  limit?: number;
}

export async function runDiagnoseErrors(
  flags: DiagnoseErrorsFlags,
): Promise<void> {
  await runInvestigate('diagnose errors', flags, async (backend) => {
    const lookback = flags.lookbackMinutes ?? 60;
    const limit = flags.limit ?? 20;
    const nowMs = Date.now();
    const result = await backend.searchTraces({
      service: flags.service,
      hasError: true,
      startTimeUnixMs: nowMs - lookback * 60 * 1000,
      endTimeUnixMs: nowMs,
      limit,
    });

    const groups = new Map<
      string,
      {
        service: string;
        operation: string;
        count: number;
        errorMessages: string[];
        traceIds: string[];
      }
    >();

    for (const trace of result.items) {
      for (const span of trace.spans) {
        if (!span.hasError) continue;
        if (flags.service && span.serviceName !== flags.service) continue;

        const key = `${span.serviceName}::${span.operationName}`;
        if (!groups.has(key)) {
          groups.set(key, {
            service: span.serviceName,
            operation: span.operationName,
            count: 0,
            errorMessages: [],
            traceIds: [],
          });
        }
        const group = groups.get(key)!;
        group.count++;

        const msg = pickErrorMessage(span.tags);
        if (msg && !group.errorMessages.includes(msg)) {
          group.errorMessages.push(msg);
        }
        if (!group.traceIds.includes(trace.traceId)) {
          group.traceIds.push(trace.traceId);
        }
      }
    }

    return {
      totalTraces: result.totalCount,
      groups: [...groups.values()].toSorted((a, b) => b.count - a.count),
    };
  });
}

export interface DiagnoseSlosFlags extends InvestigateFlags {
  service: string;
  p99LatencyMs?: number;
  maxErrorRate?: number;
  lookbackMinutes?: number;
}

export async function runDiagnoseSlos(flags: DiagnoseSlosFlags): Promise<void> {
  await runInvestigate('diagnose slos', flags, async (backend) => {
    const lookback = flags.lookbackMinutes ?? 60;
    const nowMs = Date.now();
    const result = await backend.searchTraces({
      service: flags.service,
      startTimeUnixMs: nowMs - lookback * 60 * 1000,
      endTimeUnixMs: nowMs,
      limit: 100,
    });

    const spans = result.items.flatMap((t) =>
      t.spans.filter((s) => s.serviceName === flags.service),
    );

    const violations: Array<{
      type: string;
      target: number;
      actual: number;
      description: string;
    }> = [];

    if (spans.length === 0) {
      return {
        service: flags.service,
        totalSpans: 0,
        violations,
        message: 'No spans found for the given service and time window.',
      };
    }

    const durations = spans
      .map((s) => s.durationMs)
      .toSorted((a, b) => a - b);
    const p99Index = Math.floor(durations.length * 0.99);
    const actualP99 = durations[Math.min(p99Index, durations.length - 1)];

    if (flags.p99LatencyMs !== undefined && actualP99 > flags.p99LatencyMs) {
      violations.push({
        type: 'p99_latency',
        target: flags.p99LatencyMs,
        actual: actualP99,
        description: `p99 latency ${actualP99.toFixed(1)}ms exceeds target ${flags.p99LatencyMs}ms`,
      });
    }

    const errorCount = spans.filter((s) => s.hasError).length;
    const actualErrorRate = errorCount / spans.length;

    if (flags.maxErrorRate !== undefined && actualErrorRate > flags.maxErrorRate) {
      violations.push({
        type: 'error_rate',
        target: flags.maxErrorRate,
        actual: actualErrorRate,
        description: `Error rate ${(actualErrorRate * 100).toFixed(2)}% exceeds target ${(flags.maxErrorRate * 100).toFixed(2)}%`,
      });
    }

    return {
      service: flags.service,
      totalSpans: spans.length,
      p99LatencyMs: actualP99,
      errorRate: actualErrorRate,
      violations,
    };
  });
}

export function registerDiagnoseCommands(program: Command): void {
  const diagnoseCmd = new Command('diagnose').description(
    'Anomaly / root-cause / errors / SLO diagnosis (JSON)',
  );
  const anomaliesCmd = new Command('anomalies')
    .description('Detect latency/error-rate outliers')
    .option('--service <name>', 'Service filter')
    .option('--operation <name>', 'Operation filter')
    .option('--lookback-minutes <n>', 'Lookback in minutes', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runDiagnoseAnomalies({
        ...backendFlagsFromOpts(o),
        service: o.service as string | undefined,
        operation: o.operation as string | undefined,
        lookbackMinutes: o.lookbackMinutes as number | undefined,
      });
    });
  const rootCauseCmd = new Command('root-cause')
    .description('Walk a trace tree to identify the bottleneck span')
    .argument('<traceId>', 'Trace ID')
    .action(async function (this: Command, traceId: string) {
      await runDiagnoseRootCause({
        ...backendFlagsFromOpts(this.optsWithGlobals()),
        traceId,
      });
    });
  const errorsCmd = new Command('errors')
    .description('Aggregate error spans by service/operation')
    .option('--service <name>', 'Service filter')
    .option('--lookback-minutes <n>', 'Lookback in minutes', intArg)
    .option('--limit <n>', 'Max traces to scan', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runDiagnoseErrors({
        ...backendFlagsFromOpts(o),
        service: o.service as string | undefined,
        lookbackMinutes: o.lookbackMinutes as number | undefined,
        limit: o.limit as number | undefined,
      });
    });
  const slosCmd = new Command('slos')
    .description('Report SLO violations for a service')
    .requiredOption('--service <name>', 'Service to check')
    .option('--p99-latency-ms <n>', 'p99 latency target', floatArg)
    .option('--max-error-rate <n>', 'Error-rate target (0..1)', floatArg)
    .option('--lookback-minutes <n>', 'Lookback in minutes', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runDiagnoseSlos({
        ...backendFlagsFromOpts(o),
        service: o.service as string,
        p99LatencyMs: o.p99LatencyMs as number | undefined,
        maxErrorRate: o.maxErrorRate as number | undefined,
        lookbackMinutes: o.lookbackMinutes as number | undefined,
      });
    });
  addBackendFlags(diagnoseCmd);
  diagnoseCmd.addCommand(anomaliesCmd);
  diagnoseCmd.addCommand(rootCauseCmd);
  diagnoseCmd.addCommand(errorsCmd);
  diagnoseCmd.addCommand(slosCmd);
  program.addCommand(diagnoseCmd);
}
