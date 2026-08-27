// src/index.ts
import { createServer } from 'node:http';
import { DevtoolsServer } from './server/server';
import { attachDevtoolsRoutes } from './server/http';
import { listenLoopbackDualStack } from './server/listen';
import { DevtoolsSpanExporter } from './server/exporter';
import { hostHeaderIsLoopback } from './server/origin-guard';
import { resolveSourceRoot } from './server/source-file';
import type { Server } from 'node:http';

export interface CreateDevtoolsOptions {
  port?: number;
  host?: string;
  verbose?: boolean;
  maxHistory?: number;
  maxTraceCount?: number;
  maxLogCount?: number;
  maxMetricCount?: number;
  /**
   * Project root the Errors tab may read source from, so a stack frame can show
   * the line that threw.
   *
   * Same default as the CLI: the working directory on a loopback bind, off
   * otherwise. `false` disables it. See `resolveSourceRoot`.
   */
  sourceRoot?: string | false;
  /**
   * Path to the sqlite file backing the store.
   *
   * Omit for in-memory, which is the default: an embedder gets querying and
   * paging without this call suddenly writing a database file it did not ask
   * for. Set it to keep telemetry across restarts.
   */
  dbPath?: string;
  /** Maximum traces retained in the store before the oldest are pruned. */
  maxTraces?: number;
  /** Maximum logs retained in the store before the oldest are pruned. */
  maxLogs?: number;
  /** Maximum logical sqlite size before oldest telemetry is pruned. */
  maxDbBytes?: number;
  /** How often to prune the store past its caps, in ms. `0` disables it. */
  retentionIntervalMs?: number;
}

export interface DevtoolsInstance {
  server: DevtoolsServer;
  httpServer: Server;
  exporter: DevtoolsSpanExporter;
  /** The port that was *requested*. See `ready` for the one actually bound. */
  port: number;
  /**
   * Resolves once both loopback listeners are up, carrying the bound port,
   * every address bound, and any warnings raised while binding.
   */
  ready: Promise<{ addresses: string[]; port: number; warnings: string[] }>;
  close: () => Promise<void>;
}

export function createDevtools(
  options: CreateDevtoolsOptions = {},
): DevtoolsInstance {
  const port = options.port ?? 4318;
  const host = options.host ?? '127.0.0.1';
  // Loopback bind (the default) gets DNS-rebinding protection on the read/stream
  // surface; an explicit non-loopback bind is an opt-in to network exposure.
  const loopbackOnly = hostHeaderIsLoopback(host);

  const httpServer = createServer();
  const wsServer = new DevtoolsServer({
    server: httpServer,
    host,
    verbose: options.verbose,
    maxHistory: options.maxHistory,
    maxTraceCount: options.maxTraceCount,
    maxLogCount: options.maxLogCount,
    maxMetricCount: options.maxMetricCount,
    dbPath: options.dbPath,
    maxTraces: options.maxTraces,
    maxLogs: options.maxLogs,
    maxDbBytes: options.maxDbBytes,
    retentionIntervalMs: options.retentionIntervalMs,
  });
  // `false` and the env var's "off" spellings are the same answer, so both go
  // through one resolver rather than being special-cased here.
  const sourceRoot = resolveSourceRoot(
    options.sourceRoot === false
      ? 'false'
      : (options.sourceRoot ?? process.env.AUTOTEL_DEVTOOLS_SOURCE_ROOT),
    process.cwd(),
    loopbackOnly,
  );
  attachDevtoolsRoutes(httpServer, wsServer, { loopbackOnly, sourceRoot });

  // Bind both loopback families when host is loopback, so a `localhost` client
  // reaches us whether it resolves to 127.0.0.1 or ::1. Stays synchronous:
  // listening completes via callbacks just like the previous bare listen().
  const listeners = listenLoopbackDualStack({
    primary: httpServer,
    port,
    host,
    attachSecondary: (s) => {
      attachDevtoolsRoutes(s, wsServer, { loopbackOnly, sourceRoot });
      // The live tail has to answer on this family too, or a client using the
      // other form of `localhost` sees telemetry over HTTP and no stream.
      wsServer.attachWebSocket(s);
    },
  });
  if (options.verbose) {
    listeners.ready.then(({ warnings }) => {
      for (const w of warnings) console.warn(`[autotel-devtools] ${w}`);
    });
  }

  const exporter = new DevtoolsSpanExporter(wsServer);

  return {
    server: wsServer,
    httpServer,
    exporter,
    port,
    /**
     * Resolves once both loopback listeners are up, with the port actually
     * bound.
     *
     * `port` above is what was *asked for*, which is not the same thing: pass
     * `port: 0` and it stays 0, and a busy port falls forward to the next free
     * one. An embedder that wants to print a URL or point an exporter at this
     * receiver needs the resolved value, and until now had no way to get it.
     */
    ready: listeners.ready,
    close: async () => {
      await wsServer.close();
      await listeners.closeSibling();
    },
  };
}

// Re-export server components
export { DevtoolsServer } from './server/server';
export { DevtoolsSpanExporter } from './server/exporter';
export { DevtoolsLogExporter } from './server/log-exporter';
export { DevtoolsRemoteExporter } from './server/remote-exporter';
export { ErrorAggregator } from './server/error-aggregator';
export type {
  SpanData,
  TraceData,
  LogData,
  ErrorGroup,
  DevtoolsData,
} from './server/types';

export type { AttributeValue, SpanAttributes } from './widget/types';
