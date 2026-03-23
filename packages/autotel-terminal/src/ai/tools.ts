import { tool } from 'ai';
import { z } from 'zod';
import type { TerminalSpanEvent } from '../span-stream';
import type { TerminalLogEvent } from '../lib/log-model';
import type { TraceSummary, SpanStats } from '../lib/trace-model';
import type { ServiceStats } from '../lib/stats-model';
import type { ErrorSummary } from '../lib/error-model';
import type { InkSpec } from './types';
import { validateSpec } from '@json-render/core';
import { standardComponentDefinitions } from '@json-render/ink/catalog';

/** Valid component names from the Ink catalog */
const COMPONENT_NAMES = Object.keys(standardComponentDefinitions) as [
  string,
  ...string[],
];

// Helper: zod v4 schemas need to be cast for ai SDK v6's tool() which expects zod v3 types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t: (...args: any[]) => any = tool;

/**
 * Snapshot of dashboard state passed to tools at query time.
 * Tools read from this — they don't mutate dashboard state.
 */
export type ToolContext = {
  spans: TerminalSpanEvent[];
  logs: TerminalLogEvent[];
  traces: TraceSummary[];
  stats: SpanStats;
  serviceStats: ServiceStats[];
  errorSummaries: ErrorSummary[];
};

export function createTelemetryTools(
  ctx: ToolContext,
  onRenderUI?: (spec: InkSpec) => void,
) {
  return {
    getOverviewStats: t({
      description:
        'Get high-level stats: total spans, error count, average duration, p95 duration, and service count.',
      parameters: z.object({}),
      execute: async () => ({
        totalSpans: ctx.stats.total,
        errors: ctx.stats.errors,
        avgMs: Math.round(ctx.stats.avg),
        p95Ms: Math.round(ctx.stats.p95),
        serviceCount: ctx.serviceStats.length,
        traceCount: ctx.traces.length,
      }),
    }),

    listServices: t({
      description:
        'List all services with their span counts, error counts, and p95 latencies.',
      parameters: z.object({}),
      execute: async () =>
        ctx.serviceStats.map((s) => ({
          serviceName: s.serviceName,
          total: s.total,
          errors: s.errors,
          avgMs: Math.round(s.avgMs),
          p95Ms: Math.round(s.p95Ms),
        })),
    }),

    findSlowestSpans: t({
      description:
        'Find the slowest spans, optionally filtered by service name. Returns span name, duration, status, and key attributes.',
      parameters: z.object({
        service: z.string().optional().describe('Filter by service name'),
        limit: z.number().optional().describe('Max results (default 10)'),
      }),
      execute: async ({
        service,
        limit,
      }: {
        service?: string;
        limit?: number;
      }) => {
        const max = limit ?? 10;
        let filtered = ctx.spans;
        if (service) {
          filtered = filtered.filter(
            (s) => (s.attributes?.['service.name'] as string) === service,
          );
        }
        return filtered
          .toSorted((a, b) => b.durationMs - a.durationMs)
          .slice(0, max)
          .map((s) => ({
            name: s.name,
            durationMs: Math.round(s.durationMs),
            status: s.status,
            service: (s.attributes?.['service.name'] as string) ?? 'unknown',
            route: s.attributes?.['http.route'] as string | undefined,
            traceId: s.traceId.slice(0, 8),
          }));
      },
    }),

    findErrorTraces: t({
      description:
        'Find traces that contain errors, with root span name, service, route, and error count.',
      parameters: z.object({
        service: z.string().optional().describe('Filter by service name'),
        limit: z.number().optional().describe('Max results (default 10)'),
      }),
      execute: async ({
        service,
        limit,
      }: {
        service?: string;
        limit?: number;
      }) => {
        const max = limit ?? 10;
        let errors = ctx.errorSummaries;
        if (service) {
          errors = errors.filter((e) => e.serviceName === service);
        }
        return errors.slice(0, max).map((e) => ({
          traceId: e.traceId.slice(0, 8),
          rootName: e.rootName,
          serviceName: e.serviceName,
          route: e.route,
          errorCount: e.errorCount,
        }));
      },
    }),

    getTraceDetail: t({
      description:
        'Get full detail of a specific trace by trace ID prefix. Returns all spans with their parent relationships, durations, and attributes.',
      parameters: z.object({
        traceIdPrefix: z
          .string()
          .describe('First 8+ characters of the trace ID'),
      }),
      execute: async ({ traceIdPrefix }: { traceIdPrefix: string }) => {
        const trace = ctx.traces.find((t) =>
          t.traceId.startsWith(traceIdPrefix),
        );
        if (!trace) {
          return { error: `No trace found matching ${traceIdPrefix}` };
        }
        const traceLogs = ctx.logs.filter((l) => l.traceId === trace.traceId);
        return {
          traceId: trace.traceId.slice(0, 16),
          rootName: trace.rootName,
          durationMs: Math.round(trace.durationMs),
          hasError: trace.hasError,
          spanCount: trace.spanCount,
          spans: trace.spans.map((s) => ({
            name: s.name,
            durationMs: Math.round(s.durationMs),
            status: s.status,
            kind: s.kind,
            parentSpanId: s.parentSpanId?.slice(0, 8),
            attrs: Object.fromEntries(
              Object.entries(s.attributes ?? {}).filter(([k]) =>
                [
                  'http.method',
                  'http.route',
                  'http.status_code',
                  'db.operation',
                  'db.system',
                  'service.name',
                  'error.message',
                  'error.type',
                ].includes(k),
              ),
            ),
          })),
          logs: traceLogs.slice(0, 10).map((l) => ({
            level: l.level,
            message: l.message.slice(0, 100),
          })),
        };
      },
    }),

    searchSpans: t({
      description:
        'Search spans by name pattern (case-insensitive substring match). Returns matching spans with details.',
      parameters: z.object({
        query: z.string().describe('Search string to match against span names'),
        limit: z.number().optional().describe('Max results (default 20)'),
      }),
      execute: async ({ query, limit }: { query: string; limit?: number }) => {
        const max = limit ?? 20;
        const q = query.toLowerCase();
        return ctx.spans
          .filter((s) => s.name.toLowerCase().includes(q))
          .slice(0, max)
          .map((s) => ({
            name: s.name,
            durationMs: Math.round(s.durationMs),
            status: s.status,
            traceId: s.traceId.slice(0, 8),
            service: (s.attributes?.['service.name'] as string) ?? 'unknown',
          }));
      },
    }),

    searchLogs: t({
      description:
        'Search logs by message content (case-insensitive). Returns matching log entries.',
      parameters: z.object({
        query: z
          .string()
          .describe('Search string to match against log messages'),
        level: z
          .enum(['debug', 'info', 'warn', 'error'])
          .optional()
          .describe('Filter by log level'),
        limit: z.number().optional().describe('Max results (default 20)'),
      }),
      execute: async ({
        query,
        level,
        limit,
      }: {
        query: string;
        level?: string;
        limit?: number;
      }) => {
        const max = limit ?? 20;
        const q = query.toLowerCase();
        let filtered = ctx.logs.filter((l) =>
          l.message.toLowerCase().includes(q),
        );
        if (level) {
          filtered = filtered.filter((l) => l.level === level);
        }
        return filtered.slice(0, max).map((l) => ({
          level: l.level,
          message: l.message.slice(0, 200),
          traceId: l.traceId?.slice(0, 8),
          attrs: l.attributes,
        }));
      },
    }),

    renderUI: t({
      description:
        'Render rich terminal UI (tables, charts, badges) to display structured data. Use this when showing tabular data, comparisons, or metrics — not for short text answers. Available components: Table (columns + rows), KeyValue (key-value pairs), Badge (status labels: default/info/success/warning/error), BarChart (horizontal bars with labels), Card (grouped content with title), Heading (section title), Divider (separator), Text (styled text), Box (layout container).',
      parameters: z.object({
        spec: z
          .object({
            root: z.string().describe('ID of the root element'),
            elements: z
              .record(
                z.string(),
                z.object({
                  type: z.enum(COMPONENT_NAMES).describe('Component name'),
                  props: z.record(z.string(), z.unknown()).optional(),
                  children: z.array(z.string()).describe('Child element keys'),
                }),
              )
              .describe('Map of element ID to component definition'),
          })
          .describe('json-render spec defining the UI to display'),
      }),
      execute: async ({ spec }: { spec: InkSpec }) => {
        const validation = validateSpec(spec);
        if (!validation.valid) {
          return {
            rendered: false,
            error: validation.issues.map((i) => i.message).join('; '),
          };
        }
        onRenderUI?.(spec);
        return { rendered: true };
      },
    }),
  };
}
