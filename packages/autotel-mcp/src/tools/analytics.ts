import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import type { LogRecord, SpanSearchQuery } from '../types';
import {
  READ_ONLY,
  respondSafe,
  toLogSearchQuery,
  toSpanSearchQuery,
  traceQuerySchema,
  unresolvedFilterHint,
  type TraceQueryInput,
} from './shared';
import {
  aggregateLogs,
  aggregateSpans,
  whatChanged,
} from '../modules/span-aggregate';
import { resolveTimeRange } from '../modules/time-range';

import {
  sampleAcrossWindow,
  sampleSpans,
  queryWindow,
} from '../modules/window-sample';

const logIdentity = (log: LogRecord) =>
  JSON.stringify([
    log.timestampUnixMs,
    log.serviceName,
    log.traceId,
    log.spanId,
    log.severityText,
    log.body,
  ]);

const SAMPLE_HINT =
  'Computed from a sample: up to 250 spans from each quarter of the window, and at least one quarter hit that cap (counted before any tag or duration filter), so older matches may be missing. Narrow the window or add filters (serviceName, operationName, errorOnly) for numbers closer to exact.';

const spanFilterSchema = traceQuerySchema.omit({ limit: true });

export function registerAnalyticsTools(
  server: McpServer,
  backend: TelemetryBackend,
  signals: { traces: boolean; logs: boolean },
): void {
  if (signals.traces) registerSpanAnalytics(server, backend);
  if (signals.logs) registerLogAnalytics(server, backend);
}

function registerSpanAnalytics(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'aggregate_spans',
    {
      description:
        'Count, error rate and latency (avg, p50, p95, p99, max) over spans, grouped by any fields: service, operation, version, or any span attribute (http.route, db.system.name, gen_ai.request.model...). bucketMinutes adds a time series per group. Use instead of reading raw traces to answer "which endpoint is slowest", "which version errors most", "p95 by route". Exact when the backend aggregates server-side (source: "backend"), otherwise computed from a sample across the window (source: "sample").',
      annotations: READ_ONLY,
      inputSchema: spanFilterSchema.extend({
        groupBy: z
          .array(z.string().min(1))
          .max(4)
          .default(['service', 'operation']),
        bucketMinutes: z.coerce.number().int().positive().max(1440).optional(),
        limit: z.coerce.number().int().positive().max(100).default(20),
      }),
    },
    async (
      input: Omit<TraceQueryInput, 'limit'> & {
        groupBy: string[];
        bucketMinutes?: number;
        limit: number;
      },
    ) =>
      respondSafe(async () => {
        const query = toSpanSearchQuery(input);
        const filterHint = (found: number) =>
          unresolvedFilterHint(query, found, (unfiltered) =>
            backend.searchSpans(unfiltered),
          );
        if (backend.aggregateSpans && input.bucketMinutes === undefined) {
          const rows = await backend.aggregateSpans({
            ...query,
            groupBy: input.groupBy,
            limit: input.limit,
          });
          if (rows) {
            return {
              source: 'backend',
              groupBy: input.groupBy,
              rows,
              ...(await filterHint(rows.length)),
            };
          }
        }
        const sample = await sampleSpans(backend, query);
        const rows = aggregateSpans(sample.items, {
          groupBy: input.groupBy,
          bucketMinutes: input.bucketMinutes,
        }).slice(0, input.limit);
        return {
          source: 'sample',
          sampledSpans: sample.items.length,
          groupBy: input.groupBy,
          rows,
          ...(sample.capped ? { hint: SAMPLE_HINT } : {}),
          ...(await filterHint(sample.items.length)),
        };
      }, 'aggregate_spans'),
  );

  server.registerTool(
    'what_changed',
    {
      description:
        'Deployments as the spans record them: every service whose service.version changed inside the window, when, and its error rate and p95 latency before and after. Use first when something broke recently: a regression that lines up with a version change is usually the answer. Needs no deploy events, so it works on every backend; services that report no version are listed as unversioned. flagChanges does the same for feature flags: every flag whose feature_flag.version changed (a rollout widened, a kill switch flipped), per service that evaluated it, with error rate and p95 before and after. With feature flags behaviour changes without a deploy, so check flagChanges whenever changes is empty.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        serviceName: z.string().min(1).optional(),
        lookbackMinutes: z.coerce
          .number()
          .int()
          .positive()
          .max(7 * 24 * 60)
          .default(24 * 60),
        from: z.string().min(1).optional(),
        to: z.string().min(1).optional(),
      }),
    },
    async (input: {
      serviceName?: string;
      lookbackMinutes: number;
      from?: string;
      to?: string;
    }) =>
      respondSafe(async () => {
        const range = resolveTimeRange({
          from: input.from,
          to: input.to,
          lookbackMinutes: input.lookbackMinutes,
          defaultLookbackMinutes: 24 * 60,
        });
        const query: SpanSearchQuery = {
          startTimeUnixMs: range.startTimeUnixMs,
          endTimeUnixMs: range.endTimeUnixMs,
        };
        if (input.serviceName) query.service = input.serviceName;
        const sample = await sampleSpans(
          backend,
          query,
          // A change is a boundary between two versions, and a capped quarter
          // returns only the side after it. Refining costs up to 16 more
          // requests, so it is skipped on backends with aggregateSpans:
          // Datadog is the one, and its 5 req/min spans budget cannot afford
          // them.
          { refine: backend.aggregateSpans === undefined },
        );
        const result = whatChanged(sample.items);
        const hints = [
          ...(result.unversioned.length > 0
            ? [
                `${result.unversioned.join(', ')} report no service.version, so a deploy of them cannot be seen. Set the version in the SDK resource (autotel init({ version }) or OTEL_RESOURCE_ATTRIBUTES=service.version=...).`,
              ]
            : []),
          ...(sample.capped
            ? [
                'Computed from a sample that hit its cap, so a version seen only briefly, or the side of a change before it, may be missing. Narrow the window around the time you suspect for a complete answer.',
              ]
            : []),
        ];
        const answer: typeof result & { sampledSpans: number; hint?: string } =
          { sampledSpans: sample.items.length, ...result };
        if (hints.length > 0) answer.hint = hints.join(' ');
        return answer;
      }, 'what_changed'),
  );
}

function registerLogAnalytics(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'aggregate_logs',
    {
      description:
        'Count logs grouped by service, severity or any log attribute, with the most frequent message patterns per group (ids, numbers, quoted values and emails masked so "user 42 not found" and "user 97 not found" count as one). Use to see what a service is saying without reading thousands of lines; follow a pattern with search_logs text to get examples.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        serviceName: z.string().min(1).optional(),
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
        groupBy: z
          .array(z.string().min(1))
          .max(4)
          .default(['service', 'severity']),
        patternsPerGroup: z.coerce.number().int().positive().max(20).default(5),
        limit: z.coerce.number().int().positive().max(100).default(20),
      }),
    },
    async (input: {
      serviceName?: string;
      severityText?: string;
      text?: string;
      lookbackMinutes?: number;
      from?: string;
      to?: string;
      groupBy: string[];
      patternsPerGroup: number;
      limit: number;
    }) =>
      respondSafe(async () => {
        const query = toLogSearchQuery(input);
        const { startMs, endMs } = queryWindow(query);
        const sample = await sampleAcrossWindow<LogRecord>(
          startMs,
          endMs,
          logIdentity,
          async (from, to, limit) => {
            return backend.searchLogs({
              ...query,
              startTimeUnixMs: from,
              endTimeUnixMs: to,
              limit,
            });
          },
        );
        return {
          sampledLogs: sample.items.length,
          groupBy: input.groupBy,
          rows: aggregateLogs(sample.items, {
            groupBy: input.groupBy,
            patternsPerGroup: input.patternsPerGroup,
          }).slice(0, input.limit),
          ...(sample.capped
            ? {
                hint: 'Computed from up to 250 logs per quarter of the window, and at least one quarter hit that cap. Narrow the window or filter by serviceName or severityText for fuller counts.',
              }
            : {}),
        };
      }, 'aggregate_logs'),
  );
}
