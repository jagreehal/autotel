import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry.js';
import { detectAnomalies } from '../modules/anomaly.js';
import { findRootCause } from '../modules/correlator.js';
import { respondJSON } from './shared.js';

export function registerDiagnosisTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'find_anomalies',
    {
      description:
        'Scan for statistical outliers: latency spikes, error rate jumps. Use after list_services to check a specific service.',
      inputSchema: z.object({
        service: z.string().min(1).optional(),
        operation: z.string().min(1).optional(),
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
      operation,
      lookbackMinutes,
    }: {
      service?: string;
      operation?: string;
      lookbackMinutes: number;
    }) => {
      const nowMs = Date.now();
      const result = await backend.searchTraces({
        service,
        startTimeUnixMs: nowMs - lookbackMinutes * 60 * 1000,
        endTimeUnixMs: nowMs,
        limit: 100,
      });
      const anomalies = detectAnomalies(result.items, { service, operation });
      return respondJSON(anomalies);
    },
  );

  server.registerTool(
    'find_root_cause',
    {
      description:
        'Walk a trace span tree to identify the bottleneck span. Use after get_trace or search_traces when investigating a slow/errored trace.',
      inputSchema: z.object({
        traceId: z.string().min(1),
      }),
    },
    async ({ traceId }: { traceId: string }) => {
      const trace = await backend.getTrace(traceId);
      if (!trace) {
        return respondJSON({ error: `Trace not found: ${traceId}` });
      }
      const result = findRootCause(trace);
      return respondJSON(result);
    },
  );

  server.registerTool(
    'find_errors',
    {
      description:
        'Aggregate error spans grouped by service and operation. Use to get an overview of what is failing.',
      inputSchema: z.object({
        service: z.string().min(1).optional(),
        lookbackMinutes: z
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .default(60),
        limit: z.number().int().positive().max(100).default(20),
      }),
    },
    async ({
      service,
      lookbackMinutes,
      limit,
    }: {
      service?: string;
      lookbackMinutes: number;
      limit: number;
    }) => {
      const nowMs = Date.now();
      const result = await backend.searchTraces({
        service,
        hasError: true,
        startTimeUnixMs: nowMs - lookbackMinutes * 60 * 1000,
        endTimeUnixMs: nowMs,
        limit,
      });

      // Group error spans by service/operation
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
          if (service && span.serviceName !== service) continue;

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

          const msg =
            span.tags['error.message'] ?? span.tags['exception.message'];
          if (
            msg &&
            typeof msg === 'string' &&
            !group.errorMessages.includes(msg)
          ) {
            group.errorMessages.push(msg);
          }
          if (!group.traceIds.includes(trace.traceId)) {
            group.traceIds.push(trace.traceId);
          }
        }
      }

      const aggregated = [...groups.values()].sort((a, b) => b.count - a.count);
      return respondJSON({
        totalTraces: result.totalCount,
        groups: aggregated,
      });
    },
  );

  server.registerTool(
    'check_slos',
    {
      description:
        'Report SLO violations. Provide p99 latency and error rate targets.',
      inputSchema: z.object({
        service: z.string().min(1),
        p99LatencyMs: z.number().positive().optional(),
        maxErrorRate: z.number().min(0).max(1).optional(),
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
      p99LatencyMs,
      maxErrorRate,
      lookbackMinutes,
    }: {
      service: string;
      p99LatencyMs?: number;
      maxErrorRate?: number;
      lookbackMinutes: number;
    }) => {
      const nowMs = Date.now();
      const result = await backend.searchTraces({
        service,
        startTimeUnixMs: nowMs - lookbackMinutes * 60 * 1000,
        endTimeUnixMs: nowMs,
        limit: 100,
      });

      const spans = result.items.flatMap((t) =>
        t.spans.filter((s) => s.serviceName === service),
      );

      const violations: Array<{
        type: string;
        target: number;
        actual: number;
        description: string;
      }> = [];

      if (spans.length === 0) {
        return respondJSON({
          service,
          totalSpans: 0,
          violations,
          message: 'No spans found for the given service and time window.',
        });
      }

      // Calculate p99 latency
      const durations = spans.map((s) => s.durationMs).sort((a, b) => a - b);
      const p99Index = Math.floor(durations.length * 0.99);
      const actualP99 = durations[Math.min(p99Index, durations.length - 1)];

      if (p99LatencyMs !== undefined && actualP99 > p99LatencyMs) {
        violations.push({
          type: 'p99_latency',
          target: p99LatencyMs,
          actual: actualP99,
          description: `p99 latency ${actualP99.toFixed(1)}ms exceeds target ${p99LatencyMs}ms`,
        });
      }

      // Calculate error rate
      const errorCount = spans.filter((s) => s.hasError).length;
      const actualErrorRate = errorCount / spans.length;

      if (maxErrorRate !== undefined && actualErrorRate > maxErrorRate) {
        violations.push({
          type: 'error_rate',
          target: maxErrorRate,
          actual: actualErrorRate,
          description: `Error rate ${(actualErrorRate * 100).toFixed(2)}% exceeds target ${(maxErrorRate * 100).toFixed(2)}%`,
        });
      }

      return respondJSON({
        service,
        totalSpans: spans.length,
        p99LatencyMs: actualP99,
        errorRate: actualErrorRate,
        violations,
      });
    },
  );
}
