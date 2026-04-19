import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry';
import {
  respondSafe,
  traceQuerySchema,
  toTraceSearchQuery,
  toSpanSearchQuery,
  type TraceQueryInput,
  type SpanQueryInput,
} from './shared';

export function registerInvestigationTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'search_traces',
    {
      description:
        'Search traces by service, operation, status, tags, time window, and error flag.',
      inputSchema: traceQuerySchema,
    },
    async (input: TraceQueryInput) =>
      respondSafe(
        () => backend.searchTraces(toTraceSearchQuery(input)),
        'search_traces',
      ),
  );

  server.registerTool(
    'search_spans',
    {
      description:
        'Search spans by service, operation, status, tags, time window, duration, and error flag.',
      inputSchema: traceQuerySchema.extend({
        minDurationMs: z.coerce.number().int().nonnegative().optional(),
        maxDurationMs: z.coerce.number().int().nonnegative().optional(),
      }),
    },
    async (input: SpanQueryInput) =>
      respondSafe(
        () => backend.searchSpans(toSpanSearchQuery(input)),
        'search_spans',
      ),
  );

  server.registerTool(
    'get_trace',
    {
      description: 'Get a trace by trace ID.',
      inputSchema: z.object({ traceId: z.string().min(1) }),
    },
    async ({ traceId }: { traceId: string }) =>
      respondSafe(() => backend.getTrace(traceId), 'get_trace'),
  );

  server.registerTool(
    'summarize_trace',
    {
      description: 'Summarize a trace into a compact incident-friendly view.',
      inputSchema: z.object({ traceId: z.string().min(1) }),
    },
    async ({ traceId }: { traceId: string }) =>
      respondSafe(() => backend.summarizeTrace(traceId), 'summarize_trace'),
  );
}
