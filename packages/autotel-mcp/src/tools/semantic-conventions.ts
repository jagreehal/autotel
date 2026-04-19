import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  clearSemanticConventionCache,
  getSemanticConventionNamespace,
  listSemanticConventionNamespaces,
} from '../modules/semantic-conventions';
import { respondSafe } from './shared';

export function registerSemanticConventionTools(server: McpServer): void {
  server.registerTool(
    'semconv_list_namespaces',
    {
      description:
        'List OpenTelemetry semantic-convention namespaces available from upstream.',
      inputSchema: z.object({}),
    },
    async () =>
      respondSafe(async () => ({
        namespaces: await listSemanticConventionNamespaces(),
      })),
  );

  server.registerTool(
    'semconv_get_namespace',
    {
      description:
        'Get semantic-convention groups for one namespace (for example: http, rpc, database).',
      inputSchema: z.object({
        namespace: z.string().min(1),
      }),
    },
    async ({ namespace }) =>
      respondSafe(async () => getSemanticConventionNamespace(namespace)),
  );

  server.registerTool(
    'semconv_refresh_cache',
    {
      description:
        'Clear semantic-conventions cache so subsequent calls fetch fresh upstream content.',
      inputSchema: z.object({}),
    },
    async () =>
      respondSafe(async () => {
        clearSemanticConventionCache();
        return { cleared: true };
      }),
  );
}
