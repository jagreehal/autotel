import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import { READ_ONLY, respondSafe } from './shared';
import {
  analyzeMcpSessions,
  type SessionOutcome,
  type McpSessionReport,
} from '../modules/mcp-sessions';
import type { SpanSearchQuery } from '../types';
import { resolveTimeRange } from '../modules/time-range';
import { sampleSpans } from '../modules/window-sample';

const OUTCOMES = [
  'completed',
  'recovered',
  'failed',
  'paused',
  'missing_tool',
] as const satisfies readonly SessionOutcome[];

interface McpSessionAnswer extends McpSessionReport {
  sampledSpans: number;
  totalSessions: number;
  hint?: string;
}

/**
 * Product analytics for an MCP server: how agents use its tools, read from the
 * tool-call spans autotel-mcp-instrumentation records.
 */
export function registerMcpSessionTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'mcp_sessions',
    {
      description:
        'How agents use an MCP server, rebuilt from its tool-call spans (autotel-mcp-instrumentation). Each session lists its calls in order with the agent-stated intent (mcp.tool.call.intent), the user, client and model, and an outcome read off how it ended: completed, recovered (errors, then success), failed (ended on an error), paused (waiting on user input) or missing_tool (the agent reported a capability the server lacks). patterns groups sessions that took the same path through the tools, with completion rate and example intents; endedOn shows where failed sessions stopped; missingTools lists what agents looked for. Sessions come from gen_ai.conversation.id (sessionHandles) or mcp.session.id; intents need captureIntent. Outcomes are inferred, so a session still running when the window ends reads as its latest call.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        serviceName: z.string().min(1).optional(),
        session: z.string().min(1).optional(),
        userId: z.string().min(1).optional(),
        outcome: z.enum(OUTCOMES).optional(),
        lookbackMinutes: z.coerce
          .number()
          .int()
          .positive()
          .max(7 * 24 * 60)
          .default(24 * 60),
        from: z.string().min(1).optional(),
        to: z.string().min(1).optional(),
        limit: z.coerce.number().int().positive().max(100).default(20),
      }),
    },
    async (input: {
      serviceName?: string;
      session?: string;
      userId?: string;
      outcome?: SessionOutcome;
      lookbackMinutes: number;
      from?: string;
      to?: string;
      limit: number;
    }) =>
      respondSafe(async () => {
        const range = resolveTimeRange({
          from: input.from,
          to: input.to,
          lookbackMinutes: input.lookbackMinutes,
          defaultLookbackMinutes: 24 * 60,
        });
        const query: SpanSearchQuery = {
          ...range,
          tags: { 'mcp.method.name': 'tools/call' },
        };
        if (input.serviceName) query.service = input.serviceName;
        const sample = await sampleSpans(backend, query);
        const report = analyzeMcpSessions(
          sample.items,
          (session) =>
            (input.session === undefined || session.id === input.session) &&
            (input.userId === undefined || session.userId === input.userId) &&
            (input.outcome === undefined || session.outcome === input.outcome),
        );
        const hints = [
          ...(sample.capped
            ? [
                'Computed from a sample that hit its cap, so some calls are missing and long sessions may be cut short. Narrow the window or filter by serviceName.',
              ]
            : []),
          ...(report.unsessionedCalls > 0 && report.sessions.length === 0
            ? [
                `${report.unsessionedCalls} tool calls carry no session. Turn on sessionHandles in instrumentMcpServer (or resolveSessionId) to group them.`,
              ]
            : []),
        ];
        const answer: McpSessionAnswer = {
          sampledSpans: sample.items.length,
          totalSessions: report.sessions.length,
          outcomes: report.outcomes,
          patterns: report.patterns.slice(0, input.limit),
          endedOn: report.endedOn.slice(0, input.limit),
          missingTools: report.missingTools.slice(0, input.limit),
          unsessionedCalls: report.unsessionedCalls,
          sessions: report.sessions.slice(0, input.limit),
        };
        if (hints.length > 0) answer.hint = hints.join(' ');
        return answer;
      }, 'mcp_sessions'),
  );
}
