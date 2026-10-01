import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import { detectAnomalies } from '../modules/anomaly';
import { findRootCause } from '../modules/correlator';
import { findRepeatedQueries } from '../modules/repeated-queries';
import { compactTrace } from '../modules/trace-payload';
import { issueContext, loadIssues } from '../modules/issues';
import { respondJSON, READ_ONLY } from './shared';
import { nonEmptyString } from '../lib/values';

/**
 * Extract the most informative error message from span tags. OTel
 * semantic conventions prefer `exception.message`, but real-world spans
 * carry errors under `error.message`, `otel.status_description`, or
 * domain-specific keys like `validation.error`. Exported so tests can
 * pin the precedence without spinning up an MCP server.
 */
export function pickErrorMessage(
  tags: Record<string, string | number | boolean>,
): string | undefined {
  const ordered = [
    'exception.message',
    'error.message',
    'validation.error',
    'otel.status_description',
    'error.description',
    'rpc.grpc.status_message',
  ];
  for (const key of ordered) {
    const value = tags[key];
    const text = nonEmptyString(value);
    if (text !== undefined) return text;
  }
  return undefined;
}

export function registerDiagnosisTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'find_anomalies',
    {
      description:
        'Scan for statistical outliers: latency spikes, error rate jumps. Use after list_services to check a specific service.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        serviceName: z.string().min(1).optional(),
        operation: z.string().min(1).optional(),
        lookbackMinutes: z.coerce
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .default(60),
      }),
    },
    async ({
      serviceName: service,
      operation,
      lookbackMinutes,
    }: {
      serviceName?: string;
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
      annotations: READ_ONLY,
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
      // The bottleneck span otherwise carries the whole service, host and
      // process identity, which is the same on every span in the trace.
      const { resource } = compactTrace(trace, { includeSpans: false });
      const tags = Object.fromEntries(
        Object.entries(result.bottleneck.tags).filter(
          ([key]) => !(key in resource),
        ),
      );
      return respondJSON({
        ...result,
        resource,
        bottleneck: { ...result.bottleneck, tags },
      });
    },
  );

  server.registerTool(
    'find_repeated_queries',
    {
      description:
        "Group a trace's database spans by statement and report the ones that ran more than once. Use for N+1 detection: find_root_cause names the single slowest span, which on an N+1 is one cheap query among hundreds, so the repeat count is the finding rather than the duration.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        traceId: z.string().min(1),
      }),
    },
    async ({ traceId }: { traceId: string }) => {
      const trace = await backend.getTrace(traceId);
      if (!trace) {
        return respondJSON({ error: `Trace not found: ${traceId}` });
      }
      return respondJSON(findRepeatedQueries(trace));
    },
  );

  server.registerTool(
    'find_errors',
    {
      description:
        'Aggregate error spans grouped by service and operation. Use to get an overview of what is failing.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        serviceName: z.string().min(1).optional(),
        lookbackMinutes: z.coerce
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .default(60),
        limit: z.coerce.number().int().positive().max(100).default(20),
      }),
    },
    async ({
      serviceName: service,
      lookbackMinutes,
      limit,
    }: {
      serviceName?: string;
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

          // Pull the most informative error message we can find. OTel
          // semantic conventions prefer `exception.message`, but real-world
          // spans also use `error.message`, `otel.status_description`, and
          // domain-specific keys like `validation.error`.
          const msgCandidate = pickErrorMessage(span.tags);
          if (msgCandidate && !group.errorMessages.includes(msgCandidate)) {
            group.errorMessages.push(msgCandidate);
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

  const issueWindow = {
    serviceName: z.string().min(1).optional(),
    lookbackMinutes: z.coerce
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60)
      .default(24 * 60),
    quietMinutes: z.coerce.number().int().positive().default(60),
  };

  server.registerTool(
    'list_issues',
    {
      description:
        'Failures grouped into issues by fingerprint (service + exception type + top app stack frames, or the normalised message when there is no stack) — the same key autotel-devtools uses. Covers thrown and handled exceptions, HTTP 5xx, error logs, and autotel log-flood / runaway-alarm reports. Each issue has status (active/resolved/ignored; stored by devtools, otherwise active), count, first/last seen, trend buckets, regression (came back after quietMinutes of silence), versions, affected users/accounts/sessions and sample trace IDs. Use to triage what is broken; follow with get_issue.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        ...issueWindow,
        status: z
          .enum(['active', 'resolved', 'ignored', 'all'])
          .default('active'),
        minCount: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20),
      }),
    },
    async ({
      serviceName,
      lookbackMinutes,
      quietMinutes,
      status,
      minCount,
      limit,
    }: {
      serviceName?: string;
      lookbackMinutes: number;
      quietMinutes: number;
      status: 'active' | 'resolved' | 'ignored' | 'all';
      minCount: number;
      limit: number;
    }) => {
      const result = await loadIssues(backend, {
        service: serviceName,
        lookbackMinutes,
        quietMinutes,
        status,
      });
      const issues = result.issues
        .filter((issue) => issue.count >= minCount)
        .slice(0, limit)
        // The stack belongs in get_issue; the list stays scannable.
        .map(({ latestStack: _stack, ...issue }) => issue);
      return respondJSON({ ...result, issues });
    },
  );

  server.registerTool(
    'get_issue',
    {
      description:
        'Everything needed to fix one issue from list_issues: the grouped summary, latest stack trace, the latest occurrence trace (compacted) and its logs, plus the service logs just before and after it. Hand this to a coding agent.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        fingerprint: z.string().min(1),
        ...issueWindow,
        contextSeconds: z.coerce.number().int().positive().max(600).default(30),
      }),
    },
    async ({
      fingerprint,
      serviceName,
      lookbackMinutes,
      quietMinutes,
      contextSeconds,
    }: {
      fingerprint: string;
      serviceName?: string;
      lookbackMinutes: number;
      quietMinutes: number;
      contextSeconds: number;
    }) => {
      const { issues } = await loadIssues(backend, {
        service: serviceName,
        lookbackMinutes,
        quietMinutes,
      });
      const issue = issues.find((i) => i.fingerprint === fingerprint);
      if (!issue) {
        return respondJSON({
          error: `Issue not found in the last ${lookbackMinutes} minutes: ${fingerprint}`,
        });
      }
      return respondJSON(await issueContext(backend, issue, contextSeconds));
    },
  );

  server.registerTool(
    'check_slos',
    {
      description:
        'Report SLO violations. Provide p99 latency and error rate targets.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        serviceName: z.string().min(1),
        p99LatencyMs: z.coerce.number().positive().optional(),
        maxErrorRate: z.coerce.number().min(0).max(1).optional(),
        lookbackMinutes: z.coerce
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .default(60),
      }),
    },
    async ({
      serviceName: service,
      p99LatencyMs,
      maxErrorRate,
      lookbackMinutes,
    }: {
      serviceName: string;
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
