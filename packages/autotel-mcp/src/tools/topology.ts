import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry.js';
import { respondJSON } from './shared.js';

export function registerTopologyTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'list_services',
    { description: 'List known services.', inputSchema: z.object({}) },
    async () => respondJSON(await backend.listServices()),
  );

  server.registerTool(
    'list_operations',
    {
      description: 'List operations for a service.',
      inputSchema: z.object({ serviceName: z.string().min(1) }),
    },
    async ({ serviceName }: { serviceName: string }) =>
      respondJSON(await backend.listOperations(serviceName)),
  );

  server.registerTool(
    'service_map',
    {
      description:
        'Build a service dependency map with node and edge health metrics.',
      inputSchema: z.object({
        lookbackMinutes: z
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    },
    async ({
      lookbackMinutes = 60,
      limit = 20,
    }: {
      lookbackMinutes?: number;
      limit?: number;
    }) => respondJSON(await backend.serviceMap(lookbackMinutes, limit)),
  );
}
