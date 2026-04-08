// src/index.ts
import { createServer } from 'node:http'
import { DevtoolsServer } from './server/server'
import { attachDevtoolsRoutes } from './server/http'
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

  httpServer.listen(port, host)

  const exporter = new DevtoolsSpanExporter(wsServer)

  return {
    server: wsServer,
    httpServer,
    exporter,
    port,
    close: async () => {
      await wsServer.close()
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
