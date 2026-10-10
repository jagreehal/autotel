import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import type { LogRecord, SpanRecord, SpanSearchQuery } from '../types';
import {
  READ_ONLY,
  respondSafe,
  toLogSearchQuery,
  toSpanSearchQuery,
  traceQuerySchema,
  type TraceQueryInput,
} from './shared';
import {
  aggregateLogs,
  aggregateSpans,
  whatChanged,
} from '../modules/span-aggregate';
import { resolveTimeRange } from '../modules/time-range';

/**
 * Samples the whole window in four slices, so an early spike or version
 * change shows up alongside the newest records. Four keeps the request count
 * inside Datadog's spans limit of five a minute.
 */
const SLICES = 4;
const PER_SLICE = 250;

/**
 * Adjacent slices share their boundary instant, and a backend with inclusive
 * bounds returns a record sitting on it from both. Count each record by the
 * slice that returned the most copies of it: a boundary record seen once in
 * each slice counts once, while identical records within one slice (a log
 * line repeated in the same millisecond) all still count.
 */
export function mergeSlices<T>(
  slices: readonly (readonly T[])[],
  identity: (item: T) => string,
): T[] {
  const kept = new Map<string, T[]>();
  for (const slice of slices) {
    const local = new Map<string, T[]>();
    for (const item of slice) {
      const key = identity(item);
      const list = local.get(key);
      if (list) list.push(item);
      else local.set(key, [item]);
    }
    for (const [key, items] of local) {
      if (items.length > (kept.get(key)?.length ?? 0)) kept.set(key, items);
    }
  }
  return Array.from(kept.values()).flat();
}

const spanIdentity = (span: SpanRecord) => `${span.traceId}:${span.spanId}`;
const logIdentity = (log: LogRecord) =>
  JSON.stringify([
    log.timestampUnixMs,
    log.serviceName,
    log.traceId,
    log.spanId,
    log.severityText,
    log.body,
  ]);

export async function sampleAcrossWindow<T>(
  startMs: number,
  endMs: number,
  identity: (item: T) => string,
  fetch: (
    from: number,
    to: number,
    limit: number,
  ) => Promise<{ items: T[]; truncated?: boolean }>,
): Promise<{ items: T[]; capped: boolean }> {
  const width = (endMs - startMs) / SLICES;
  const slices = await Promise.all(
    Array.from({ length: SLICES }, (_, index) =>
      fetch(
        Math.round(startMs + index * width),
        Math.round(startMs + (index + 1) * width),
        PER_SLICE,
      ),
    ),
  );
  return {
    items: mergeSlices(
      slices.map((slice) => slice.items),
      identity,
    ),
    capped: slices.some(
      (slice) => slice.truncated ?? slice.items.length >= PER_SLICE,
    ),
  };
}

function window(query: { startTimeUnixMs?: number; endTimeUnixMs?: number }) {
  const endMs = query.endTimeUnixMs ?? Date.now();
  return { startMs: query.startTimeUnixMs ?? endMs - 60 * 60_000, endMs };
}

async function sampleSpans(
  backend: TelemetryBackend,
  query: SpanSearchQuery,
): Promise<{ items: SpanRecord[]; capped: boolean }> {
  const { startMs, endMs } = window(query);
  return sampleAcrossWindow(
    startMs,
    endMs,
    spanIdentity,
    async (from, to, limit) => {
      return backend.searchSpans({
        ...query,
        startTimeUnixMs: from,
        endTimeUnixMs: to,
        limit,
      });
    },
  );
}

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
        if (backend.aggregateSpans && input.bucketMinutes === undefined) {
          const rows = await backend.aggregateSpans({
            ...query,
            groupBy: input.groupBy,
            limit: input.limit,
          });
          if (rows) return { source: 'backend', groupBy: input.groupBy, rows };
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
        };
      }, 'aggregate_spans'),
  );

  server.registerTool(
    'what_changed',
    {
      description:
        'Deployments as the spans record them: every service whose service.version changed inside the window, when, and its error rate and p95 latency before and after. Use first when something broke recently: a regression that lines up with a version change is usually the answer. Needs no deploy events, so it works on every backend; services that report no version are listed as unversioned.',
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
        const sample = await sampleSpans(backend, {
          ...(input.serviceName ? { service: input.serviceName } : {}),
          startTimeUnixMs: range.startTimeUnixMs,
          endTimeUnixMs: range.endTimeUnixMs,
        });
        const result = whatChanged(sample.items);
        return {
          sampledSpans: sample.items.length,
          ...result,
          ...(result.unversioned.length > 0
            ? {
                hint: `${result.unversioned.join(', ')} report no service.version, so a deploy of them cannot be seen. Set the version in the SDK resource (autotel init({ version }) or OTEL_RESOURCE_ATTRIBUTES=service.version=...).`,
              }
            : {}),
        };
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
        const { startMs, endMs } = window(query);
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
