import {
  LATEST_PROTOCOL_VERSION,
  McpServer,
  type McpServerFactory,
} from '@modelcontextprotocol/server';
import { loadConfig, type AppConfig, type Env } from './config';
import type { TelemetryBackend } from './backends/telemetry';
import { createBackend } from './backends/factory';
import { registerTools } from './tools/index';
import {
  probeSignalAvailability,
  type RuntimeSignalAvailability,
} from './modules/signal-availability';
import { VERSION } from './version';

/**
 * The revision this server speaks.
 *
 * Written out rather than imported: the v2 SDK keeps the modern revision
 * internal, and its `LATEST_PROTOCOL_VERSION` means the latest *2025-era* one
 * the legacy path answers — reporting that would name the wrong protocol.
 * `test/protocol.test.ts` connects with a client pinned to this exact string,
 * so it cannot drift from what the server actually negotiates.
 */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

export interface App {
  config: AppConfig;
  backend: TelemetryBackend;
  /** The MCP revision this build speaks. */
  protocolVersion: string;
  /** The newest 2025-era revision the SDK's legacy path still answers. */
  legacyProtocolVersion: string;
  /**
   * Builds a server instance. Protocol 2026-07-28 has no handshake and no
   * session, so an instance holds nothing worth keeping between requests and
   * the HTTP entry calls this per request; stdio calls it per connection.
   */
  createServer: McpServerFactory;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateAppOptions {
  /**
   * Command-line flags to apply over the environment. The CLI passes
   * `process.argv.slice(2)`; embedders leave this empty and configure through
   * the environment, or pass `config` directly.
   */
  argv?: readonly string[];
  env?: Env;
  /** Skips resolution entirely when you already have a config. */
  config?: AppConfig;
}

/**
 * The tool catalog is fixed once the backend has been probed, and identical
 * for every caller. Saying so lets a client hold it instead of re-fetching on
 * every connection — which matters more now that there is no session to
 * amortise the cost over — and keeps the tool block at the head of the model
 * prompt stable, so upstream prompt caches survive a reconnect.
 */
const CATALOG_CACHE_HINT = { ttlMs: 300_000, cacheScope: 'public' } as const;

export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  const config =
    options.config ??
    loadConfig(options.argv ?? [], options.env ?? process.env);
  const {
    backend,
    start: startBackend,
    stop: stopBackend,
  } = await createBackend(config);

  // Probed once at startup, not per request: it costs a round trip to the
  // backend, and which signals exist does not change between two tool calls.
  let availability: RuntimeSignalAvailability | undefined;

  const createServer: McpServerFactory = () => {
    const server = new McpServer(
      { name: 'autotel-mcp', version: VERSION },
      {
        capabilities: { tools: {}, resources: {} },
        cacheHints: {
          'tools/list': CATALOG_CACHE_HINT,
          'resources/list': CATALOG_CACHE_HINT,
          'server/discover': CATALOG_CACHE_HINT,
        },
      },
    );
    registerTools(server, backend, availability);
    return server;
  };

  return {
    config,
    backend,
    protocolVersion: MCP_PROTOCOL_VERSION,
    legacyProtocolVersion: LATEST_PROTOCOL_VERSION,
    createServer,
    start: async () => {
      await startBackend();
      try {
        availability = await probeSignalAvailability(backend);
      } catch (error) {
        console.error(
          '[autotel-mcp] runtime signal probe failed:',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    stop: stopBackend,
  };
}
