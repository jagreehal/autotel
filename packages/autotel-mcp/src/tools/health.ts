import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import { buildCapabilitiesText } from '../modules/docs';
import { respondSafe, READ_ONLY } from './shared';

export function registerHealthTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'backend_health',
    {
      description:
        'Check backend health and readiness. Returns liveness plus the signal coverage map (traces / metrics / logs) so you can see at a glance what the backend can answer for, not just whether it is up.',
      annotations: READ_ONLY,
      inputSchema: z.object({}),
    },
    async () =>
      respondSafe(async () => {
        const [health, capabilities] = await Promise.all([
          backend.healthCheck(),
          Promise.resolve(backend.capabilities()),
        ]);
        return { ...health, signals: capabilities };
      }, 'backend_health'),
  );

  server.registerTool(
    'backend_capabilities',
    {
      description:
        'Describe which telemetry signals the active backend can serve.',
      annotations: READ_ONLY,
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
      annotations: READ_ONLY,
      inputSchema: z.object({}),
    },
    async () =>
      respondSafe(
        () => JSON.parse(buildCapabilitiesText('autotel-mcp')),
        'list_capabilities',
      ),
  );
}
