import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  validateOtlpReceiverConfig,
  suggestCollectorConfig,
} from '../modules/collector-config';
import { buildCollectorGuide } from '../modules/docs';
import { respondSafe } from './shared';

export function registerCollectorConfigTools(server: McpServer): void {
  server.registerTool(
    'validate_collector_config',
    {
      description: 'Validate an OTLP receiver collector config fragment.',
      inputSchema: z.object({ config: z.any() }),
    },
    async (args) =>
      respondSafe(
        () => validateOtlpReceiverConfig(args.config),
        'validate_collector_config',
      ),
  );

  server.registerTool(
    'suggest_collector_config',
    {
      description: 'Suggest a minimal OTLP receiver collector config.',
      inputSchema: z.object({}),
    },
    async () =>
      respondSafe(
        () => ({ suggestion: suggestCollectorConfig() }),
        'suggest_collector_config',
      ),
  );

  server.registerTool(
    'explain_collector_config',
    {
      description:
        'Explain the OTLP receiver collector config shape and defaults.',
      inputSchema: z.object({}),
    },
    async () =>
      respondSafe(
        () => ({ guide: buildCollectorGuide() }),
        'explain_collector_config',
      ),
  );
}
