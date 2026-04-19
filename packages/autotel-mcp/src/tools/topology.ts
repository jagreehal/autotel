import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry';
import { respondSafe } from './shared';

export function registerTopologyTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'list_services',
    { description: 'List known services.', inputSchema: z.object({}) },
    async () => respondSafe(() => backend.listServices(), 'list_services'),
  );

  server.registerTool(
    'list_operations',
    {
      description: 'List operations for a service.',
      inputSchema: z.object({ serviceName: z.string().min(1) }),
    },
    async ({ serviceName }: { serviceName: string }) =>
      respondSafe(() => backend.listOperations(serviceName), 'list_operations'),
  );

  server.registerTool(
    'service_map',
    {
      description:
        'Build a service dependency map with node and edge health metrics.',
      inputSchema: z.object({
        lookbackMinutes: z.coerce
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
      }),
    },
    async ({
      lookbackMinutes = 60,
      limit = 20,
    }: {
      lookbackMinutes?: number;
      limit?: number;
    }) =>
      respondSafe(
        () => backend.serviceMap(lookbackMinutes, limit),
        'service_map',
      ),
  );
}
