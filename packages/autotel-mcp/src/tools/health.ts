import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry';
import { buildCapabilitiesText } from '../modules/docs';
import { respondSafe } from './shared';

export function registerHealthTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'backend_health',
    {
      description: 'Check backend health and readiness.',
      inputSchema: z.object({}),
    },
    async () => respondSafe(() => backend.healthCheck(), 'backend_health'),
  );

  server.registerTool(
    'backend_capabilities',
    {
      description:
        'Describe which telemetry signals the active backend can serve.',
      inputSchema: z.object({}),
    },
    async () =>
      respondSafe(() => backend.capabilities(), 'backend_capabilities'),
  );

  server.registerTool(
    'list_capabilities',
    {
      description:
        'List the server capabilities, transports, tools, resources, and backend signals.',
      inputSchema: z.object({}),
    },
    async () =>
      respondSafe(
        () => JSON.parse(buildCapabilitiesText('autotel-mcp')),
        'list_capabilities',
      ),
  );
}
