import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, type AppConfig } from './config';
import type { TelemetryBackend } from './backends/telemetry';
import { createBackend } from './backends/factory';
import { registerTools } from './tools/index';
import { probeSignalAvailability } from './modules/signal-availability';
import { VERSION } from './version';

export interface App {
  config: AppConfig;
  server: McpServer;
  backend: TelemetryBackend;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createApp(): Promise<App> {
  const config = loadConfig();
  const {
    backend,
    start: startBackend,
    stop: stopBackend,
  } = await createBackend(config);

  const server = new McpServer({
    name: 'autotel-mcp',
    version: VERSION,
  });

  let toolsRegistered = false;

  return {
    config,
    server,
    backend,
    start: async () => {
      await startBackend();
      if (!toolsRegistered) {
        let availability;
        try {
          availability = await probeSignalAvailability(backend);
        } catch (error) {
          console.error(
            '[autotel-mcp] runtime signal probe failed:',
            error instanceof Error ? error.message : String(error),
          );
        }
        registerTools(server, backend, availability);
        toolsRegistered = true;
      }
    },
    stop: stopBackend,
  };
}
