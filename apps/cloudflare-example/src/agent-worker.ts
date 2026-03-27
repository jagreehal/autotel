/**
 * Worker entrypoint for TaskAgent
 *
 * This worker demonstrates autotel-cloudflare/agents integration
 * for OpenTelemetry instrumentation of Agent operations.
 *
 * The TaskAgent class uses createOtelObservability() to convert
 * Agent events into OpenTelemetry spans.
 */

import { TaskAgent } from './agent';
import { instrument } from 'autotel-cloudflare';
import { parseError, withAutotelFetch } from 'autotel-adapters/cloudflare';
import { createEdgeLogger } from 'autotel-edge/logger';
import { routeAgentRequest } from 'agents';
import type { WorkerEnv } from './types';

const baseLogger = createEdgeLogger('agent-worker');

function parseHeaders(raw?: string): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Export the Agent class for Durable Object binding
export { TaskAgent };

// Type alias for the environment
interface Env extends WorkerEnv {
  TaskAgent: DurableObjectNamespace;
}

// Type for the TaskAgent stub (with callable methods exposed by PartyServer)
interface TaskAgentStub {
  processTask(
    taskName: string,
    priority: number,
  ): Promise<{ result: string; taskId: string }>;
  processTaskWithError(taskName: string): Promise<{ result: string }>;
  scheduledCleanup(): Promise<void>;
  callMcpServer(
    serverId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
  sendMessage(
    recipient: string,
    message: string,
  ): Promise<{ messageId: string }>;
  getStats(): Promise<{ taskCount: number; agentId: string }>;
}

/**
 * Helper to get an agent stub by name using the DO namespace
 */
function getAgentStub(
  namespace: DurableObjectNamespace,
  roomName: string,
): TaskAgentStub {
  const id = namespace.idFromName(roomName);
  const stub = namespace.get(id);
  return stub as unknown as TaskAgentStub;
}

// Default export is the fetch handler wrapped with instrument()
export default instrument(
  {
    fetch: withAutotelFetch(
      async (
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
      ): Promise<Response> => {
        const url = new URL(request.url);
        const log = baseLogger.child({
          route: url.pathname,
          method: request.method,
        });

        // API info
        if (url.pathname === '/') {
          return Response.json({
            message: 'TaskAgent Worker with OpenTelemetry Observability',
            info: 'This worker demonstrates autotel-cloudflare/agents integration',
            endpoints: {
              info: 'GET / - This info',
              agentsRoute:
                'GET/POST /agents/task-agent/{room-name}/... - Direct agent routing',
              processTask:
                'POST /process-task - Process a task (body: {taskName, priority, name?})',
              stats: 'GET /stats - Get agent statistics',
            },
            observability:
              'TaskAgent uses createOtelObservability() to trace RPC calls, schedules, and lifecycle events',
          });
        }

        // Try routeAgentRequest first for /agents/* paths
        if (url.pathname.startsWith('/agents/')) {
          const response = await routeAgentRequest(request, env, {
            cors: true,
          });
          if (response) return response;
        }

        // Get agent by name (or use default)
        const agentName = url.searchParams.get('name') || 'default-agent';

        // Process task endpoint
        if (url.pathname === '/process-task' && request.method === 'POST') {
          try {
            const body = (await request.json()) as {
              taskName?: string;
              priority?: number;
              name?: string;
            };
            const taskName = body.taskName || 'default-task';
            const priority = body.priority || 1;
            const roomName = body.name || agentName;

            // Get the agent stub and call the method directly
            const agent = getAgentStub(env.TaskAgent, roomName);
            const result = await agent.processTask(taskName, priority);
            log.info({ roomName, taskName, priority }, 'Processed task');
            return Response.json(result);
          } catch (error) {
            const parsed = parseError(error);
            log.error(
              {
                endpoint: '/process-task',
                errorStatus: parsed.status,
                errorCode: parsed.code,
              },
              parsed.message,
            );
            return Response.json(
              { error: parsed.message, code: parsed.code },
              { status: parsed.status },
            );
          }
        }

        // Stats endpoint
        if (url.pathname === '/stats') {
          try {
            const roomName = url.searchParams.get('name') || agentName;

            // Get the agent stub and call the method directly
            const agent = getAgentStub(env.TaskAgent, roomName);
            const result = await agent.getStats();
            log.info({ roomName }, 'Fetched stats');
            return Response.json(result);
          } catch (error) {
            const parsed = parseError(error);
            log.error(
              {
                endpoint: '/stats',
                errorStatus: parsed.status,
                errorCode: parsed.code,
              },
              parsed.message,
            );
            return Response.json(
              { error: parsed.message, code: parsed.code },
              { status: parsed.status },
            );
          }
        }

        log.warn('Route not found');
        return new Response('Not Found', { status: 404 });
      },
      {
        spanName: (request) =>
          `cloudflare.agent.${request.method?.toLowerCase() ?? 'request'}`,
      },
    ),
  },
  (env: Env & Record<string, string | undefined>) => ({
    service: { name: 'agent-worker' },
    exporter: {
      url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      headers: parseHeaders(env.OTLP_HEADERS),
    },
  }),
);
