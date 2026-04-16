import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, type AppConfig } from './config.js';
import type { TelemetryBackend } from './backends/telemetry.js';
import { CollectorBackend } from './backends/collector/index.js';
import { JaegerBackend } from './backends/jaeger/index.js';
import { FixtureBackend } from './backends/fixture/index.js';
import { registerTools } from './tools/index.js';

export interface App {
  config: AppConfig;
  server: McpServer;
  backend: TelemetryBackend;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createApp(): Promise<App> {
  const config = loadConfig();

  let backend: TelemetryBackend;
  let startBackend: () => Promise<void> = async () => {};
  let stopBackend: () => Promise<void> = async () => {};

  switch (config.backend) {
    case 'collector': {
      const collector = new CollectorBackend({
        port: config.collectorPort,
        maxTraces: config.maxTraces,
        retentionMs: config.retentionMs!,
        persist: config.persist,
      });
      backend = collector;
      startBackend = () => collector.start();
      stopBackend = () => collector.stop();
      break;
    }
    case 'jaeger': {
      backend = new JaegerBackend(config.jaegerBaseUrl);
      break;
    }
    default: {
      backend = new FixtureBackend(config.fixturePath);
      break;
    }
  }

  const server = new McpServer({
    name: 'autotel-mcp',
    version: '0.1.0',
  });

  registerTools(server, backend);

  return {
    config,
    server,
    backend,
    start: startBackend,
    stop: stopBackend,
  };
}
