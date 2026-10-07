import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TelemetryBackend } from '../backends/telemetry';
import { respondSafe, READ_ONLY } from './shared';

/**
 * The telemetry a service actually sent, checked against upstream semantic
 * conventions: deprecated attributes, names no convention defines. The
 * `semconv_*` lookup tools say what a convention is; this says whether the
 * running code follows it.
 */
export function registerLiveValidationTools(
  server: McpServer,
  backend: TelemetryBackend,
): void {
  server.registerTool(
    'semconv_validate',
    {
      description:
        'Check the telemetry autotel-devtools has received against OpenTelemetry semantic conventions (via weaver live-check): deprecated attributes with their replacement, attributes no convention defines, unstable ones. run=true starts a fresh check (seconds); otherwise returns the latest result. A result with stale=true predates telemetry received since; re-run before relying on it. status "unavailable" means weaver is not installed on the devtools host.',
      // A run spawns weaver but changes no telemetry: still a read.
      annotations: READ_ONLY,
      inputSchema: z.object({ run: z.boolean().optional() }),
    },
    async ({ run }) =>
      respondSafe(async () => {
        const result = await backend.semconvValidation?.(run ?? false);
        return (
          result ?? {
            status: 'unavailable',
            reason:
              'This backend does not validate telemetry. Point autotel-mcp at autotel-devtools with weaver on its PATH.',
          }
        );
      }, 'semconv_validate'),
  );
}
