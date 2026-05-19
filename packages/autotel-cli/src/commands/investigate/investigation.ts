import { Command } from 'commander';
import {
  toTraceSearchQuery,
  toSpanSearchQuery,
  type TraceQueryInput,
  type SpanQueryInput,
} from 'autotel-mcp';
import { runInvestigate, type InvestigateFlags } from './runtime';
import {
  addBackendFlags,
  addTimeWindowFlags,
  backendFlagsFromOpts,
  intArg,
} from './cli-helpers';
import { runQueryMetrics, runQueryLogs } from './signals';

export type QueryTracesFlags = InvestigateFlags & TraceQueryInput;
export type QuerySpansFlags = InvestigateFlags & SpanQueryInput;

export async function runQueryTraces(flags: QueryTracesFlags): Promise<void> {
  await runInvestigate('query traces', flags, async (backend) =>
    backend.searchTraces(toTraceSearchQuery(flags)),
  );
}

export async function runQuerySpans(flags: QuerySpansFlags): Promise<void> {
  await runInvestigate('query spans', flags, async (backend) =>
    backend.searchSpans(toSpanSearchQuery(flags)),
  );
}

export async function runTraceGet(
  flags: InvestigateFlags & { traceId: string },
): Promise<void> {
  await runInvestigate('trace get', flags, async (backend) =>
    backend.getTrace(flags.traceId),
  );
}

export async function runTraceSummary(
  flags: InvestigateFlags & { traceId: string },
): Promise<void> {
  await runInvestigate('trace summary', flags, async (backend) =>
    backend.summarizeTrace(flags.traceId),
  );
}

export function registerQueryCommands(program: Command): void {
  const queryCmd = new Command('query').description(
    'Query traces, spans, metrics, or logs (JSON)',
  );

  const tracesCmd = addTimeWindowFlags(new Command('traces'))
    .description('Search traces by service, op, status, tags, time, error')
    .option('--error-only', 'Only traces with errors')
    .option('--status-code <code>', 'OK | ERROR | UNSET')
    .option('--min-duration-ms <n>', 'Minimum duration', intArg)
    .option('--max-duration-ms <n>', 'Maximum duration', intArg)
    .option('--gen-ai-system <name>', 'gen_ai.system')
    .option('--gen-ai-request-model <name>', 'gen_ai.request.model')
    .option('--gen-ai-response-model <name>', 'gen_ai.response.model')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runQueryTraces({
        ...backendFlagsFromOpts(o),
        serviceName: o.serviceName as string | undefined,
        operationName: o.operationName as string | undefined,
        lookbackMinutes: o.lookbackMinutes as number | undefined,
        from: o.from as string | undefined,
        to: o.to as string | undefined,
        limit: o.limit as number | undefined,
        errorOnly: o.errorOnly as boolean | undefined,
        statusCode: o.statusCode as 'OK' | 'ERROR' | 'UNSET' | undefined,
        minDurationMs: o.minDurationMs as number | undefined,
        maxDurationMs: o.maxDurationMs as number | undefined,
        genAiSystem: o.genAiSystem as string | undefined,
        genAiRequestModel: o.genAiRequestModel as string | undefined,
        genAiResponseModel: o.genAiResponseModel as string | undefined,
      });
    });

  const spansCmd = addTimeWindowFlags(new Command('spans'))
    .description('Search individual spans by service/op/status/tags/duration')
    .option('--error-only', 'Only spans with errors')
    .option('--status-code <code>', 'OK | ERROR | UNSET')
    .option('--min-duration-ms <n>', 'Minimum span duration', intArg)
    .option('--max-duration-ms <n>', 'Maximum span duration', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runQuerySpans({
        ...backendFlagsFromOpts(o),
        serviceName: o.serviceName as string | undefined,
        operationName: o.operationName as string | undefined,
        lookbackMinutes: o.lookbackMinutes as number | undefined,
        from: o.from as string | undefined,
        to: o.to as string | undefined,
        limit: o.limit as number | undefined,
        errorOnly: o.errorOnly as boolean | undefined,
        statusCode: o.statusCode as 'OK' | 'ERROR' | 'UNSET' | undefined,
        minDurationMs: o.minDurationMs as number | undefined,
        maxDurationMs: o.maxDurationMs as number | undefined,
      });
    });

  const metricsCmd = addTimeWindowFlags(new Command('metrics'))
    .description('List metric series')
    .option('--metric-name <name>', 'Filter by metric name')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runQueryMetrics({
        ...backendFlagsFromOpts(o),
        metricName: o.metricName as string | undefined,
        serviceName: o.serviceName as string | undefined,
        lookbackMinutes: o.lookbackMinutes as number | undefined,
        from: o.from as string | undefined,
        to: o.to as string | undefined,
        limit: o.limit as number | undefined,
      });
    });

  const logsCmd = addTimeWindowFlags(new Command('logs'))
    .description('Search logs')
    .option('--trace-id <id>', 'Filter by trace id')
    .option('--span-id <id>', 'Filter by span id')
    .option('--severity-text <text>', 'Severity text')
    .option('--text <text>', 'Free-text search')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runQueryLogs({
        ...backendFlagsFromOpts(o),
        serviceName: o.serviceName as string | undefined,
        traceId: o.traceId as string | undefined,
        spanId: o.spanId as string | undefined,
        severityText: o.severityText as string | undefined,
        text: o.text as string | undefined,
        lookbackMinutes: o.lookbackMinutes as number | undefined,
        from: o.from as string | undefined,
        to: o.to as string | undefined,
        limit: o.limit as number | undefined,
      });
    });

  addBackendFlags(queryCmd);
  queryCmd.addCommand(tracesCmd);
  queryCmd.addCommand(spansCmd);
  queryCmd.addCommand(metricsCmd);
  queryCmd.addCommand(logsCmd);
  program.addCommand(queryCmd);
}

export function registerTraceCommands(program: Command): void {
  const traceLookupCmd = new Command('trace').description(
    'Trace lookup commands (JSON)',
  );
  const getCmd = new Command('get')
    .description('Get a trace by ID')
    .argument('<traceId>', 'Trace ID')
    .action(async function (this: Command, traceId: string) {
      await runTraceGet({
        ...backendFlagsFromOpts(this.optsWithGlobals()),
        traceId,
      });
    });
  const summaryCmd = new Command('summary')
    .description('Compact incident-friendly trace summary')
    .argument('<traceId>', 'Trace ID')
    .action(async function (this: Command, traceId: string) {
      await runTraceSummary({
        ...backendFlagsFromOpts(this.optsWithGlobals()),
        traceId,
      });
    });
  addBackendFlags(traceLookupCmd);
  traceLookupCmd.addCommand(getCmd);
  traceLookupCmd.addCommand(summaryCmd);
  program.addCommand(traceLookupCmd);
}
