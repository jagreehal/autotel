import {
  collectUsage,
  listModels,
  getModelStats,
  rankExpensiveTraces,
  rankSlowTraces,
  listToolUsage,
  toTraceSearchQuery,
  type TelemetryBackend,
  type TraceRecord,
} from 'autotel-mcp';
import { Command } from 'commander';
import { runInvestigate, type InvestigateFlags } from './runtime';
import {
  addBackendFlags,
  backendFlagsFromOpts,
  intArg,
} from './cli-helpers';

export interface LlmAnalyticsFlags extends InvestigateFlags {
  startTime?: string;
  endTime?: string;
  serviceName?: string;
  genAiSystem?: string;
  genAiRequestModel?: string;
  genAiResponseModel?: string;
  limit?: number;
}

function parseDateToUnixMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function collectTracesForAnalytics(
  backend: TelemetryBackend,
  input: LlmAnalyticsFlags,
): Promise<TraceRecord[]> {
  const result = await backend.searchTraces(
    toTraceSearchQuery({
      serviceName: input.serviceName,
      genAiSystem: input.genAiSystem,
      genAiRequestModel: input.genAiRequestModel,
      genAiResponseModel: input.genAiResponseModel,
      limit: input.limit ?? 1000,
    }),
  );

  let filtered = result.items;
  const startUnixMs = parseDateToUnixMs(input.startTime);
  const endUnixMs = parseDateToUnixMs(input.endTime);
  if (startUnixMs !== undefined) {
    filtered = filtered.filter((trace) =>
      trace.spans.some((span) => span.startTimeUnixMs >= startUnixMs),
    );
  }
  if (endUnixMs !== undefined) {
    filtered = filtered.filter((trace) =>
      trace.spans.some((span) => span.startTimeUnixMs <= endUnixMs),
    );
  }
  return filtered;
}

export async function runLlmUsage(flags: LlmAnalyticsFlags): Promise<void> {
  await runInvestigate('llm usage', flags, async (backend) => {
    const traces = await collectTracesForAnalytics(backend, flags);
    const report = collectUsage(traces);
    return {
      period: {
        startTime: flags.startTime ?? null,
        endTime: flags.endTime ?? null,
      },
      filters: {
        serviceName: flags.serviceName ?? null,
        genAiSystem: flags.genAiSystem ?? null,
        genAiRequestModel: flags.genAiRequestModel ?? null,
        genAiResponseModel: flags.genAiResponseModel ?? null,
      },
      summary: {
        totalRequests: report.totalRequests,
        totalPromptTokens: report.totalPromptTokens,
        totalCompletionTokens: report.totalCompletionTokens,
        totalTokens: report.totalTokens,
        totalCostUsd: report.totalCostUsd,
        unpricedRequests: report.unpricedRequests,
      },
      byModel: report.byModel,
      byService: report.byService,
    };
  });
}

export async function runLlmModels(flags: LlmAnalyticsFlags): Promise<void> {
  await runInvestigate('llm models', flags, async (backend) => {
    const traces = await collectTracesForAnalytics(backend, flags);
    const models = listModels(traces).slice(0, flags.limit ?? 1000);
    return { count: models.length, models };
  });
}

export async function runLlmModelStats(
  flags: LlmAnalyticsFlags & { modelName: string },
): Promise<void> {
  await runInvestigate('llm model-stats', flags, async (backend) => {
    const traces = await collectTracesForAnalytics(backend, flags);
    const stats = getModelStats(traces, flags.modelName);
    if (!stats) {
      return {
        error: `No traces found for model '${flags.modelName}' in the specified time range`,
      };
    }
    return stats;
  });
}

export async function runLlmExpensive(
  flags: LlmAnalyticsFlags & { minTokens?: number },
): Promise<void> {
  await runInvestigate('llm expensive', flags, async (backend) => {
    const traces = await collectTracesForAnalytics(backend, flags);
    let ranked = rankExpensiveTraces(traces);
    if (flags.minTokens !== undefined) {
      ranked = ranked.filter((t) => t.tokens.total >= flags.minTokens!);
    }
    ranked = ranked.slice(0, flags.limit ?? 10);
    return { count: ranked.length, traces: ranked };
  });
}

export async function runLlmSlow(
  flags: LlmAnalyticsFlags & { minDurationMs?: number },
): Promise<void> {
  await runInvestigate('llm slow', flags, async (backend) => {
    const traces = await collectTracesForAnalytics(backend, flags);
    let ranked = rankSlowTraces(traces);
    if (flags.minDurationMs !== undefined) {
      ranked = ranked.filter((t) => t.durationMs >= flags.minDurationMs!);
    }
    ranked = ranked.slice(0, flags.limit ?? 10);
    return { count: ranked.length, traces: ranked };
  });
}

export async function runLlmTools(flags: LlmAnalyticsFlags): Promise<void> {
  await runInvestigate('llm tools', flags, async (backend) => {
    const traces = await collectTracesForAnalytics(backend, flags);
    const tools = listToolUsage(traces).slice(0, flags.limit ?? 1000);
    return {
      count: tools.length,
      totalCalls: tools.reduce((sum, t) => sum + t.usageCount, 0),
      tools,
    };
  });
}

export function registerLlmCommands(program: Command): void {
  const llmCmd = new Command('llm').description(
    'LLM analytics (cost, models, expensive/slow traces, tools)',
  );
  const commonOpts = (cmd: Command): Command =>
    cmd
      .option('--start-time <iso>', 'Start of window (ISO 8601)')
      .option('--end-time <iso>', 'End of window (ISO 8601)')
      .option('--service-name <name>', 'Service filter')
      .option('--gen-ai-system <name>', 'gen_ai.system filter')
      .option('--gen-ai-request-model <name>', 'gen_ai.request.model filter')
      .option('--gen-ai-response-model <name>', 'gen_ai.response.model filter')
      .option('--limit <n>', 'Max results', intArg);

  const usageCmd = commonOpts(new Command('usage'))
    .description('Aggregate token usage by model and service')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runLlmUsage({
        ...backendFlagsFromOpts(o),
        startTime: o.startTime as string | undefined,
        endTime: o.endTime as string | undefined,
        serviceName: o.serviceName as string | undefined,
        genAiSystem: o.genAiSystem as string | undefined,
        genAiRequestModel: o.genAiRequestModel as string | undefined,
        genAiResponseModel: o.genAiResponseModel as string | undefined,
        limit: o.limit as number | undefined,
      });
    });

  const modelsCmd = commonOpts(new Command('models'))
    .description('Discover LLM models in use')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runLlmModels({
        ...backendFlagsFromOpts(o),
        startTime: o.startTime as string | undefined,
        endTime: o.endTime as string | undefined,
        serviceName: o.serviceName as string | undefined,
        genAiSystem: o.genAiSystem as string | undefined,
        limit: o.limit as number | undefined,
      });
    });

  const modelStatsCmd = commonOpts(new Command('model-stats'))
    .description('Latency/token/error stats for one LLM model')
    .requiredOption('--model-name <name>', 'Model to inspect')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runLlmModelStats({
        ...backendFlagsFromOpts(o),
        modelName: o.modelName as string,
        startTime: o.startTime as string | undefined,
        endTime: o.endTime as string | undefined,
        serviceName: o.serviceName as string | undefined,
      });
    });

  const expensiveCmd = commonOpts(new Command('expensive'))
    .description('Traces with highest total LLM token usage')
    .option('--min-tokens <n>', 'Minimum token threshold', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runLlmExpensive({
        ...backendFlagsFromOpts(o),
        startTime: o.startTime as string | undefined,
        endTime: o.endTime as string | undefined,
        serviceName: o.serviceName as string | undefined,
        genAiRequestModel: o.genAiRequestModel as string | undefined,
        genAiResponseModel: o.genAiResponseModel as string | undefined,
        minTokens: o.minTokens as number | undefined,
        limit: o.limit as number | undefined,
      });
    });

  const slowCmd = commonOpts(new Command('slow'))
    .description('Slowest traces that include LLM spans')
    .option('--min-duration-ms <n>', 'Minimum duration', intArg)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runLlmSlow({
        ...backendFlagsFromOpts(o),
        startTime: o.startTime as string | undefined,
        endTime: o.endTime as string | undefined,
        serviceName: o.serviceName as string | undefined,
        genAiRequestModel: o.genAiRequestModel as string | undefined,
        genAiResponseModel: o.genAiResponseModel as string | undefined,
        minDurationMs: o.minDurationMs as number | undefined,
        limit: o.limit as number | undefined,
      });
    });

  const toolsCmd = commonOpts(new Command('tools'))
    .description('Discover tool/function spans grouped by tool name')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runLlmTools({
        ...backendFlagsFromOpts(o),
        startTime: o.startTime as string | undefined,
        endTime: o.endTime as string | undefined,
        serviceName: o.serviceName as string | undefined,
        genAiSystem: o.genAiSystem as string | undefined,
        limit: o.limit as number | undefined,
      });
    });

  addBackendFlags(llmCmd);
  llmCmd.addCommand(usageCmd);
  llmCmd.addCommand(modelsCmd);
  llmCmd.addCommand(modelStatsCmd);
  llmCmd.addCommand(expensiveCmd);
  llmCmd.addCommand(slowCmd);
  llmCmd.addCommand(toolsCmd);
  program.addCommand(llmCmd);
}
