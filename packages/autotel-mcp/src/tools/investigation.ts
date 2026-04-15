import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry.js';
import {
  respondJSON,
  traceQuerySchema,
  toTraceSearchQuery,
  toSpanSearchQuery,
  type TraceQueryInput,
  type SpanQueryInput,
} from './shared.js';

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
      respondJSON(await backend.searchTraces(toTraceSearchQuery(input))),
  );

  server.registerTool(
    'search_spans',
    {
      description:
        'Search spans by service, operation, status, tags, time window, duration, and error flag.',
      inputSchema: traceQuerySchema.extend({
        minDurationMs: z.number().int().nonnegative().optional(),
        maxDurationMs: z.number().int().nonnegative().optional(),
      }),
    },
    async (input: SpanQueryInput) =>
      respondJSON(await backend.searchSpans(toSpanSearchQuery(input))),
  );

  server.registerTool(
    'get_trace',
    {
      description: 'Get a trace by trace ID.',
      inputSchema: z.object({ traceId: z.string().min(1) }),
    },
    async ({ traceId }: { traceId: string }) =>
      respondJSON(await backend.getTrace(traceId)),
  );

  server.registerTool(
    'summarize_trace',
    {
      description: 'Summarize a trace into a compact incident-friendly view.',
      inputSchema: z.object({ traceId: z.string().min(1) }),
    },
    async ({ traceId }: { traceId: string }) =>
      respondJSON(await backend.summarizeTrace(traceId)),
  );
}
