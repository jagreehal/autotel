import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry.js';
import { detectAnomalies } from '../modules/anomaly.js';
import { findRootCause } from '../modules/correlator.js';
import { respondJSON } from './shared.js';

export function registerCorrelationTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'correlate',
    {
      description:
        'Given a trace ID, return the trace + metrics from involved services + correlated logs. One call for the full picture.',
      inputSchema: z.object({
        traceId: z.string().min(1),
      }),
    },
    async ({ traceId }: { traceId: string }) => {
      const signals = await backend.getCorrelatedSignals(traceId);
      return respondJSON(signals);
    },
  );

  server.registerTool(
    'explain_slowdown',
    {
      description:
        'Identify when and why a service degraded. Combines anomaly detection with cross-signal correlation.',
      inputSchema: z.object({
        service: z.string().min(1),
        lookbackMinutes: z
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .default(60),
      }),
    },
    async ({
      service,
      lookbackMinutes,
    }: {
      service: string;
      lookbackMinutes: number;
    }) => {
      const nowMs = Date.now();
      const result = await backend.searchTraces({
        service,
        startTimeUnixMs: nowMs - lookbackMinutes * 60 * 1000,
        endTimeUnixMs: nowMs,
        limit: 100,
      });

      const anomalies = detectAnomalies(result.items, { service });

      const enriched = await Promise.all(
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

      return respondJSON({
        service,
        lookbackMinutes,
        anomalyCount: anomalies.length,
        findings: enriched,
      });
    },
  );
}
