// src/index.ts
import { createServer } from 'node:http'
import { DevtoolsServer } from './server/server'
import { attachDevtoolsRoutes } from './server/http'
import { listenLoopbackDualStack } from './server/listen'
import { DevtoolsSpanExporter } from './server/exporter'
import type { Server } from 'node:http'

export interface CreateDevtoolsOptions {
  port?: number
  host?: string
  verbose?: boolean
  maxHistory?: number
  maxTraceCount?: number
  maxLogCount?: number
  maxMetricCount?: number
}

export interface DevtoolsInstance {
  server: DevtoolsServer
  httpServer: Server
  exporter: DevtoolsSpanExporter
  port: number
  close: () => Promise<void>
}

export function createDevtools(options: CreateDevtoolsOptions = {}): DevtoolsInstance {
  const port = options.port ?? 4318
  const host = options.host ?? '127.0.0.1'

  const httpServer = createServer()
  const wsServer = new DevtoolsServer({
    server: httpServer,
    verbose: options.verbose,
    maxHistory: options.maxHistory,
    maxTraceCount: options.maxTraceCount,
    maxLogCount: options.maxLogCount,
    maxMetricCount: options.maxMetricCount,
  })
  attachDevtoolsRoutes(httpServer, wsServer)

  // Bind both loopback families when host is loopback, so a `localhost` client
  // reaches us whether it resolves to 127.0.0.1 or ::1. Stays synchronous:
  // listening completes via callbacks just like the previous bare listen().
  const listeners = listenLoopbackDualStack({
    primary: httpServer,
    port,
    host,
    attachSecondary: (s) => attachDevtoolsRoutes(s, wsServer),
  })
  if (options.verbose) {
    listeners.ready.then(({ warnings }) => {
      for (const w of warnings) console.warn(`[autotel-devtools] ${w}`)
    })
  }

  const exporter = new DevtoolsSpanExporter(wsServer)

  return {
    server: wsServer,
    httpServer,
    exporter,
    port,
    close: async () => {
      await wsServer.close()
      await listeners.closeSibling()
    },
  }
}

// Re-export server components
export { DevtoolsServer } from './server/server'
export { DevtoolsSpanExporter } from './server/exporter'
export { DevtoolsLogExporter } from './server/log-exporter'
export { DevtoolsRemoteExporter } from './server/remote-exporter'
export { ErrorAggregator } from './server/error-aggregator'
export type {
  SpanData, TraceData, LogData, MetricData,
  ErrorGroup, DevtoolsData,
} from './server/types'
