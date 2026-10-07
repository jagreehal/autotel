import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import { respondSafe, READ_ONLY } from './shared';

/**
 * "How many tokens did that task use?" for coding agents (Claude Code, Codex,
 * opencode) whose telemetry reaches autotel-devtools. Each total carries
 * `cost` / `tokens` completeness: `unknown` means nothing was measured, so a
 * zero there is not a measurement and must not be reported as one.
 */
export function registerAgentUsageTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'agent_usage',
    {
      description:
        'Token and cost usage of coding-agent sessions (Claude Code, Codex, opencode) seen by autotel-devtools. Filter by session, prompt (Claude prompt.id / Codex turn.id), repository name or path, or agent; latest="prompt" answers "what did my last request cost". Report `cost`/`tokens` completeness with the numbers: "partial" is a lower bound, "unknown" is not zero. `uncorrelatedSessions` counts sessions a repository filter excluded because they never reported a repository.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        session: z.string().optional(),
        prompt: z.string().optional(),
        repository: z.string().optional(),
        agent: z.enum(['claude-code', 'codex', 'opencode']).optional(),
        latest: z.enum(['session', 'prompt']).optional(),
      }),
    },
    async (query) =>
      respondSafe(async () => {
        const report = await backend.agentUsage?.(query);
        return (
          report ?? {
            status: 'unavailable',
            reason:
              'This backend keeps no coding-agent sessions. Point autotel-mcp at autotel-devtools and route the agent there with `npx autotel-devtools agents enable`.',
          }
        );
      }, 'agent_usage'),
  );
}
