import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry';
import {
  discoverLogFields,
  discoverServices,
  discoverTraceFields,
} from '../modules/discovery';
import { respondSafe } from './shared';

const searchSchema = z.string().min(1).optional();

export function registerDiscoveryTools(
  server: McpServer,
  backend: TelemetryBackend,
  enabled: { traces: boolean; logs: boolean; metrics: boolean },
): void {
  server.registerTool(
    'discover_services',
    {
      description:
        'Discover services with cross-signal metadata (operations, severities, metric names, and inferred language).',
      inputSchema: z.object({
        limitServices: z.coerce.number().int().positive().max(200).optional(),
        traceSample: z.coerce.number().int().positive().max(500).optional(),
        logSample: z.coerce.number().int().positive().max(500).optional(),
        metricSample: z.coerce.number().int().positive().max(500).optional(),
      }),
    },
    async ({
      limitServices = 100,
      traceSample = 200,
      logSample = 200,
      metricSample = 200,
    }) =>
      respondSafe(async () => {
        const servicesResult = await backend.listServices({
          limit: limitServices,
        });
        const services = servicesResult.services.slice(0, limitServices);

        const [traces, logs, metrics] = await Promise.all([
          enabled.traces
            ? backend.searchTraces({ limit: traceSample }).then((r) => r.items)
            : Promise.resolve([]),
          enabled.logs
            ? backend.searchLogs({ limit: logSample }).then((r) => r.items)
            : Promise.resolve([]),
          enabled.metrics
            ? backend.listMetrics({ limit: metricSample }).then((r) => r.items)
            : Promise.resolve([]),
        ]);

        const discovered = discoverServices({
          services,
          traces,
          logs,
          metrics,
        });
        return {
          count: discovered.length,
          services: discovered,
        };
      }, 'discover_services'),
  );

  if (enabled.traces) {
    server.registerTool(
      'discover_trace_fields',
      {
        description:
          'Discover trace/span field names, inferred types, and example values from sampled traces.',
        inputSchema: z.object({
          search: searchSchema,
          sampleSize: z.coerce.number().int().positive().max(500).optional(),
        }),
      },
      async ({ search, sampleSize = 200 }) =>
        respondSafe(async () => {
          const traces = await backend
            .searchTraces({ limit: sampleSize })
            .then((result) => result.items);
          return {
            search: search ?? null,
            sampleSize: traces.length,
            ...discoverTraceFields(traces, search),
          };
        }, 'discover_trace_fields'),
    );
  }

  if (enabled.logs) {
    server.registerTool(
      'discover_log_fields',
      {
        description:
          'Discover log field names, inferred types, and example values from sampled logs.',
        inputSchema: z.object({
          search: searchSchema,
          sampleSize: z.coerce.number().int().positive().max(500).optional(),
        }),
      },
      async ({ search, sampleSize = 200 }) =>
        respondSafe(async () => {
          const logs = await backend
            .searchLogs({ limit: sampleSize })
            .then((result) => result.items);
          return {
            search: search ?? null,
            sampleSize: logs.length,
            ...discoverLogFields(logs, search),
          };
        }, 'discover_log_fields'),
    );
  }
}
