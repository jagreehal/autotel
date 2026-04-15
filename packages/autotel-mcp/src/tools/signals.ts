import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry.js';
import {
  respondJSON,
  tagValueSchema,
  toMetricSearchQuery,
  toLogSearchQuery,
  type MetricsQueryInput,
  type LogsQueryInput,
} from './shared.js';

export function registerSignalTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'list_metrics',
    {
      description: 'List metric series if the backend supports metrics.',
      inputSchema: z.object({
        metricName: z.string().min(1).optional(),
        serviceName: z.string().min(1).optional(),
        lookbackMinutes: z
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    },
    async (input: MetricsQueryInput) =>
      respondJSON(await backend.listMetrics(toMetricSearchQuery(input))),
  );

  server.registerTool(
    'search_logs',
    {
      description: 'Search logs if the backend supports logs.',
      inputSchema: z.object({
        serviceName: z.string().min(1).optional(),
        traceId: z.string().min(1).optional(),
        spanId: z.string().min(1).optional(),
        severityText: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
        lookbackMinutes: z
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .optional(),
        limit: z.number().int().positive().max(100).optional(),
        attributes: z.record(tagValueSchema).optional(),
      }),
    },
    async (input: LogsQueryInput) =>
      respondJSON(await backend.searchLogs(toLogSearchQuery(input))),
  );
}
