import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  scoreSpan,
  suggestInstrumentationFixes,
} from '../modules/instrumentation';
import { buildInstrumentationGuide } from '../modules/docs';
import { READ_ONLY } from './shared';

export function registerInstrumentationTools(server: McpServer): void {
  server.registerTool(
    'score_span_instrumentation',
    {
      description:
        'Score a span for instrumentation quality and semantic convention coverage.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        span: z.object({
          operationName: z.string(),
          serviceName: z.string(),
          tags: z.record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean()]),
          ),
          hasError: z.boolean(),
        }),
      }),
    },
    async ({
      span,
    }: {
      span: {
        operationName: string;
        serviceName: string;
        tags: Record<string, string | number | boolean>;
        hasError: boolean;
      };
    }) => {
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
