import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TelemetryBackend } from '../backends/telemetry.js';
import { buildCapabilitiesText } from '../modules/docs.js';

function respondJSON(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

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
    async () => respondJSON(await backend.healthCheck()),
  );

  server.registerTool(
    'backend_capabilities',
    {
      description:
        'Describe which telemetry signals the active backend can serve.',
      inputSchema: z.object({}),
    },
    async () => respondJSON(backend.capabilities()),
  );

  server.registerTool(
    'list_capabilities',
    {
      description:
        'List the server capabilities, transports, tools, resources, and backend signals.',
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        { type: 'text' as const, text: buildCapabilitiesText('autotel-mcp') },
      ],
    }),
  );
}
