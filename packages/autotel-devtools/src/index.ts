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
}

export interface DevtoolsInstance {
  server: DevtoolsServer;
  httpServer: Server;
  exporter: DevtoolsSpanExporter;
  port: number;
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
    attachSecondary: (s) =>
      attachDevtoolsRoutes(s, wsServer, { loopbackOnly, sourceRoot }),
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
  MetricData,
  ErrorGroup,
  DevtoolsData,
} from './server/types';

export type { AttributeValue, SpanAttributes } from './widget/types';
