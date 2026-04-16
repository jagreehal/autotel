import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry.js';
import type { TraceRecord } from '../types.js';
import {
  collectUsage,
  listModels,
  getModelStats,
  rankExpensiveTraces,
  rankSlowTraces,
  listToolUsage,
} from '../modules/llm-analytics.js';
import { respondJSON, toTraceSearchQuery } from './shared.js';

type AnalyticsInput = {
  startTime?: string;
  endTime?: string;
  serviceName?: string;
  genAiSystem?: string;
  genAiRequestModel?: string;
  genAiResponseModel?: string;
  limit?: number;
};

async function collectTracesForAnalytics(
  backend: TelemetryBackend,
  input: AnalyticsInput,
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

function parseDateToUnixMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function registerLlmAnalyticsTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'get_llm_usage',
    {
      description: 'Aggregate LLM token usage by model and service.',
      inputSchema: z.object({
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        serviceName: z.string().min(1).optional(),
        genAiSystem: z.string().min(1).optional(),
        genAiRequestModel: z.string().min(1).optional(),
        genAiResponseModel: z.string().min(1).optional(),
        limit: z.number().int().positive().max(1000).optional(),
      }),
    },
    async (input: {
      startTime?: string;
      endTime?: string;
      serviceName?: string;
      genAiSystem?: string;
      genAiRequestModel?: string;
      genAiResponseModel?: string;
      limit?: number;
    }) => {
      const traces = await collectTracesForAnalytics(backend, input);
      const report = collectUsage(traces);
      return respondJSON({
        period: {
          startTime: input.startTime ?? null,
          endTime: input.endTime ?? null,
        },
        filters: {
          serviceName: input.serviceName ?? null,
          genAiSystem: input.genAiSystem ?? null,
          genAiRequestModel: input.genAiRequestModel ?? null,
          genAiResponseModel: input.genAiResponseModel ?? null,
        },
        summary: {
          totalRequests: report.totalRequests,
          totalPromptTokens: report.totalPromptTokens,
          totalCompletionTokens: report.totalCompletionTokens,
          totalTokens: report.totalTokens,
        },
        byModel: report.byModel,
        byService: report.byService,
      });
    },
  );

  server.registerTool(
    'list_llm_models',
    {
      description: 'Discover LLM models in use and their usage frequency.',
      inputSchema: z.object({
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        serviceName: z.string().min(1).optional(),
        genAiSystem: z.string().min(1).optional(),
        limit: z.number().int().positive().max(1000).optional(),
      }),
    },
    async (input: {
      startTime?: string;
      endTime?: string;
      serviceName?: string;
      genAiSystem?: string;
      limit?: number;
    }) => {
      const traces = await collectTracesForAnalytics(backend, input);
      const models = listModels(traces).slice(0, input.limit ?? 1000);
      return respondJSON({ count: models.length, models });
    },
  );

  server.registerTool(
    'get_llm_model_stats',
    {
      description:
        'Get latency, token, and error statistics for one LLM model.',
      inputSchema: z.object({
        modelName: z.string().min(1),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        serviceName: z.string().min(1).optional(),
      }),
    },
    async (input: {
      modelName: string;
      startTime?: string;
      endTime?: string;
      serviceName?: string;
    }) => {
      const traces = await collectTracesForAnalytics(backend, input);
      const stats = getModelStats(traces, input.modelName);
      if (!stats) {
        return respondJSON({
          error: `No traces found for model '${input.modelName}' in the specified time range`,
        });
      }
      return respondJSON(stats);
    },
  );

  server.registerTool(
    'get_llm_expensive_traces',
    {
      description: 'Find traces with the highest total LLM token usage.',
      inputSchema: z.object({
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        serviceName: z.string().min(1).optional(),
        genAiRequestModel: z.string().min(1).optional(),
        genAiResponseModel: z.string().min(1).optional(),
        minTokens: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    },
    async (input: {
      startTime?: string;
      endTime?: string;
      serviceName?: string;
      genAiRequestModel?: string;
      genAiResponseModel?: string;
      minTokens?: number;
      limit?: number;
    }) => {
      const traces = await collectTracesForAnalytics(backend, input);
      let ranked = rankExpensiveTraces(traces);
      if (input.minTokens !== undefined) {
        ranked = ranked.filter(
          (trace) => trace.tokens.total >= input.minTokens!,
        );
      }
      ranked = ranked.slice(0, input.limit ?? 10);
      return respondJSON({ count: ranked.length, traces: ranked });
    },
  );

  server.registerTool(
    'get_llm_slow_traces',
    {
      description: 'Find the slowest traces that include LLM spans.',
      inputSchema: z.object({
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        serviceName: z.string().min(1).optional(),
        genAiRequestModel: z.string().min(1).optional(),
        genAiResponseModel: z.string().min(1).optional(),
        minDurationMs: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    },
    async (input: {
      startTime?: string;
      endTime?: string;
      serviceName?: string;
      genAiRequestModel?: string;
      genAiResponseModel?: string;
      minDurationMs?: number;
      limit?: number;
    }) => {
      const traces = await collectTracesForAnalytics(backend, input);
      let ranked = rankSlowTraces(traces);
      if (input.minDurationMs !== undefined) {
        ranked = ranked.filter(
          (trace) => trace.durationMs >= input.minDurationMs!,
        );
      }
      ranked = ranked.slice(0, input.limit ?? 10);
      return respondJSON({ count: ranked.length, traces: ranked });
    },
  );

  server.registerTool(
    'list_llm_tools',
    {
      description: 'Discover tool/function spans and group them by tool name.',
      inputSchema: z.object({
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        serviceName: z.string().min(1).optional(),
        genAiSystem: z.string().min(1).optional(),
        limit: z.number().int().positive().max(1000).optional(),
      }),
    },
    async (input: {
      startTime?: string;
      endTime?: string;
      serviceName?: string;
      genAiSystem?: string;
      limit?: number;
    }) => {
      const traces = await collectTracesForAnalytics(backend, input);
      const tools = listToolUsage(traces).slice(0, input.limit ?? 1000);
      return respondJSON({
        count: tools.length,
        totalCalls: tools.reduce((sum, tool) => sum + tool.usageCount, 0),
        tools,
      });
    },
  );
}
