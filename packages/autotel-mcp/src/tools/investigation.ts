import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import {
  respondSafe,
  traceQuerySchema,
  toTraceSearchQuery,
  toSpanSearchQuery,
  type TraceQueryInput,
  type SpanQueryInput,
  READ_ONLY,
  limitHint,
  TRUNCATED_TRACE_HINT,
} from './shared';
import {
  compactSpans,
  compactTrace,
  compactTraceResult,
} from '../modules/trace-payload';
import { registerTraceView, traceViewToolMeta } from '../apps/trace-view';

export function registerInvestigationTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  const traceUrl = backend.traceUrl?.bind(backend);

  server.registerTool(
    'search_traces',
    {
      description:
        'Search traces by service, operation, status, tags, time window, and error flag. Returns root spans and a spanCount per trace; pass includeSpans:true for the full span tree, or call get_trace on the one trace you want. A trace containing an N+1 carries hundreds of spans, so asking for them across a whole result set can exceed the response limit.',
      annotations: READ_ONLY,
      inputSchema: traceQuerySchema.extend({
        includeSpans: z.coerce.boolean().default(false),
      }),
    },
    async (input: TraceQueryInput & { includeSpans: boolean }) =>
      respondSafe(async () => {
        const limit = input.limit ?? 20;
        const result = compactTraceResult(
          await backend.searchTraces({ ...toTraceSearchQuery(input), limit }),
          { includeSpans: input.includeSpans, traceUrl },
        );
        return { ...result, ...limitHint(result.items.length, limit) };
      }, 'search_traces'),
  );

  server.registerTool(
    'search_spans',
    {
      description:
        'Search spans by service, operation, status, tags, time window, duration, and error flag.',
      annotations: READ_ONLY,
      inputSchema: traceQuerySchema.extend({
        minDurationMs: z.coerce.number().int().nonnegative().optional(),
        maxDurationMs: z.coerce.number().int().nonnegative().optional(),
      }),
    },
    async (input: SpanQueryInput) =>
      respondSafe(async () => {
        const limit = input.limit ?? 50;
        const found = await backend.searchSpans({
          ...toSpanSearchQuery(input),
          limit,
        });
        const result = compactSpans(found);
        return {
          ...result,
          ...limitHint(result.items.length, limit, 100, found.truncated),
        };
      }, 'search_spans'),
  );

  server.registerTool(
    'get_trace',
    {
      description: 'Get a trace by trace ID.',
      annotations: READ_ONLY,
      inputSchema: z.object({ traceId: z.string().min(1) }),
      // Hosts that render MCP Apps draw the trace as a waterfall.
      ...traceViewToolMeta(),
    },
    async ({ traceId }: { traceId: string }) =>
      respondSafe(async () => {
        const trace = await backend.getTrace(traceId);
        if (trace === null || trace === undefined) return trace;
        return {
          ...compactTrace(trace, { traceUrl }),
          ...(trace.truncated ? TRUNCATED_TRACE_HINT : {}),
        };
      }, 'get_trace'),
  );
  registerTraceView(server);

  server.registerTool(
    'summarize_trace',
    {
      description: 'Summarize a trace into a compact incident-friendly view.',
      annotations: READ_ONLY,
      inputSchema: z.object({ traceId: z.string().min(1) }),
    },
    async ({ traceId }: { traceId: string }) =>
      respondSafe(async () => {
        const summary = await backend.summarizeTrace(traceId);
        if (!summary) return summary;
        const url = traceUrl?.(traceId);
        return {
          ...summary,
          ...(url ? { url } : {}),
          ...(summary.truncated ? TRUNCATED_TRACE_HINT : {}),
        };
      }, 'summarize_trace'),
  );
}
