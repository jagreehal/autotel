import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import { resolveTimeRange } from '../modules/time-range';
import {
  respondSafe,
  tagValueSchema,
  toMetricSearchQuery,
  toLogSearchQuery,
  type MetricsQueryInput,
  type LogsQueryInput,
  READ_ONLY,
  limitHint,
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
      description:
        'List the metrics a service emits (counters, gauges, histograms): name, unit, kind and description, without data points. Filter by metric name substring or service. Read values with get_metric_series.',
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

  server.registerTool(
    'get_metric_series',
    {
      description:
        'Read the data points of one metric over a time window, one series per attribute set (e.g. request rate, latency or error count per route). Use list_metrics to find the name. A histogram point reports its count.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        metricName: z.string().min(1),
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
    async (input: MetricsQueryInput & { metricName: string }) =>
      respondSafe(async () => {
        const window = resolveTimeRange({
          from: input.from,
          to: input.to,
          lookbackMinutes: input.lookbackMinutes,
          defaultLookbackMinutes: 60,
        });
        const series = await backend.getMetricSeries(input.metricName, {
          ...window,
          serviceName: input.serviceName,
          limit: input.limit ?? 20,
        });
        return { series, totalCount: series.length };
      }, 'get_metric_series'),
  );
}

function registerLogTools(server: McpServer, backend: TelemetryBackend): void {
  server.registerTool(
    'search_logs',
    {
      description:
        'Search log records by service, severity (e.g. ERROR), free text in the message, trace or span id, or attribute values, newest first. Use a traceId to read the logs written during one request.',
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
      respondSafe(async () => {
        const limit = input.limit ?? 50;
        const result = await backend.searchLogs({
          ...toLogSearchQuery(input),
          limit,
        });
        return { ...result, ...limitHint(result.items.length, limit) };
      }, 'search_logs'),
  );
}
