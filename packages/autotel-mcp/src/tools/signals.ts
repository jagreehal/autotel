import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import {
  respondSafe,
  tagValueSchema,
  toMetricSearchQuery,
  toLogSearchQuery,
  type MetricsQueryInput,
  type LogsQueryInput,
  READ_ONLY,
} from './shared';

export function registerSignalTools(
  server: McpServer,
  backend: TelemetryBackend,
  enabled: { metrics: boolean; logs: boolean },
): void {
  if (enabled.metrics) registerMetricTools(server, backend);
  if (enabled.logs) registerLogTools(server, backend);
}

function registerMetricTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'list_metrics',
    {
      description: 'List metric series if the backend supports metrics.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        metricName: z.string().min(1).optional(),
        serviceName: z.string().min(1).optional(),
        lookbackMinutes: z.coerce
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .optional(),
        from: z.string().min(1).optional(),
        to: z.string().min(1).optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
      }),
    },
    async (input: MetricsQueryInput) =>
      respondSafe(
        () => backend.listMetrics(toMetricSearchQuery(input)),
        'list_metrics',
      ),
  );
}

function registerLogTools(server: McpServer, backend: TelemetryBackend): void {
  server.registerTool(
    'search_logs',
    {
      description: 'Search logs if the backend supports logs.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        serviceName: z.string().min(1).optional(),
        traceId: z.string().min(1).optional(),
        spanId: z.string().min(1).optional(),
        severityText: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
        lookbackMinutes: z.coerce
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .optional(),
        from: z.string().min(1).optional(),
        to: z.string().min(1).optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        attributes: z.record(z.string(), tagValueSchema).optional(),
      }),
    },
    async (input: LogsQueryInput) =>
      respondSafe(
        () => backend.searchLogs(toLogSearchQuery(input)),
        'search_logs',
      ),
  );
}
