import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  scoreSpan,
  suggestInstrumentationFixes,
} from '../modules/instrumentation';
import { buildInstrumentationGuide } from '../modules/docs';
import type { TelemetryBackend } from '../backends/telemetry';
import { READ_ONLY, respondError } from './shared';

const spanShape = z.object({
  operationName: z.string(),
  serviceName: z.string(),
  tags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  hasError: z.boolean(),
});

export function registerInstrumentationTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'score_span_instrumentation',
    {
      description:
        'Score a span for instrumentation quality and semantic convention coverage. Pass the traceId and spanId another tool returned, or a span object.',
      annotations: READ_ONLY,
      // The ids are what every search and diagnosis tool hands back, so they
      // are the shape an agent already holds. The raw object stays for spans
      // that never reached a backend.
      inputSchema: z.union([
        z.object({ traceId: z.string().min(1), spanId: z.string().min(1) }),
        z.object({ span: spanShape }),
      ]),
    },
    async (input) => {
      let span: z.infer<typeof spanShape>;
      if ('span' in input) {
        span = input.span;
      } else {
        const trace = await backend.getTrace(input.traceId);
        const found = trace?.spans.find((s) => s.spanId === input.spanId);
        if (!found) {
          return respondError({
            message: `No span ${input.spanId} in trace ${input.traceId}`,
            code: 'SPAN_NOT_FOUND',
            status: 404,
          });
        }
        span = found;
      }
      const result = scoreSpan(span);
      const suggestions = suggestInstrumentationFixes(span);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ...result, suggestions }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'explain_instrumentation_score',
    {
      description: 'Explain the instrumentation scoring rubric and fix ideas.',
      annotations: READ_ONLY,
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: 'text' as const, text: buildInstrumentationGuide() }],
    }),
  );
}
