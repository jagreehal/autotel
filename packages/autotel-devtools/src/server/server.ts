// src/server/server.ts
import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HTTPServer } from 'node:http'
import { createServer } from 'node:http'
import { ErrorAggregator } from './error-aggregator'
import type {
  TraceData,
  LogData,
  MetricData,
  DevtoolsData,
} from './types'
import {
  appendManyWithLimit,
  appendWithLimit,
  resolveTelemetryLimits,
  type TelemetryLimits,
} from './telemetry-limits'

export interface DevtoolsServerOptions {
  port?: number
  server?: HTTPServer
  path?: string
  verbose?: boolean
  maxHistory?: number
  maxTraceCount?: number
  maxLogCount?: number
  maxMetricCount?: number
  /**
   * Called after each ingest, with the incremental data just broadcast to WS
   * clients. Lets an embedder (e.g. the VS Code extension) react to new
   * telemetry — refresh its own tree views — while the server owns the buffer.
   */
  onData?: (incremental: DevtoolsData) => void
}

export class DevtoolsServer {
  private wss: WebSocketServer
  private clients = new Set<WebSocket>()
  private httpServer: HTTPServer
  private traces: TraceData[] = []
  private logs: LogData[] = []
  private metrics: MetricData[] = []
  private errorAggregator = new ErrorAggregator()
  private limits: TelemetryLimits
  private verbose: boolean
  private _port: number
  private onData?: (incremental: DevtoolsData) => void

  constructor(options: DevtoolsServerOptions = {}) {
    this.limits = resolveTelemetryLimits(options)
    this.verbose = options.verbose ?? false
    this._port = options.port ?? 4318
    this.onData = options.onData

    this.httpServer = options.server ?? createServer()
    this.wss = new WebSocketServer({ server: this.httpServer, path: options.path ?? '/ws' })

    // The `ws` library re-emits the http server's `error` event onto the
    // WebSocketServer itself. During the bind phase (EADDRINUSE etc.) the
    // http server's own listener owns recovery, and the re-emission here has
    // no listener — it would crash the process. Swallow ONLY that bind-phase
    // re-emission (server not yet listening). Anything emitted once the server
    // is live is a genuine WSS fault — re-throw so it surfaces.
    this.wss.on('error', (err) => {
      if (this.httpServer.listening) throw err
    })

    this.wss.on('connection', (ws) => {
      this.clients.add(ws)
      this.log(`Client connected (${this.clients.size} total)`)

      // Send history to late-connecting clients
      const data = this.getCurrentData()
      if (data.traces.length > 0 || data.logs.length > 0 || data.errors.length > 0) {
        ws.send(JSON.stringify(data))
      }

      ws.on('close', () => {
        this.clients.delete(ws)
        this.log(`Client disconnected (${this.clients.size} total)`)
      })
    })

    // Only start listening if no external server was provided
    if (!options.server) {
      this.httpServer.listen(this._port, () => {
        const addr = this.httpServer.address()
        if (addr && typeof addr === 'object') this._port = addr.port
        this.log(`WebSocket server listening on port ${this._port}`)
      })
    }
  }

  get port(): number {
    const addr = this.httpServer.address()
    if (addr && typeof addr === 'object') return addr.port
    return this._port
  }

  get clientCount(): number {
    return this.clients.size
  }

  addTrace(trace: TraceData): void {
    // Merge if trace already exists (out-of-order spans)
    const existing = this.traces.find(t => t.traceId === trace.traceId)
    if (existing) {
      const existingSpanIds = new Set(existing.spans.map(s => s.spanId))
      for (const span of trace.spans) {
        if (!existingSpanIds.has(span.spanId)) {
          existing.spans.push(span)
        }
      }
      existing.startTime = Math.min(existing.startTime, trace.startTime)
      existing.endTime = Math.max(existing.endTime, trace.endTime)
      existing.duration = existing.endTime - existing.startTime
      if (trace.status === 'ERROR') existing.status = 'ERROR'
    } else {
      this.traces = appendWithLimit(
        this.traces,
        trace,
        this.limits.maxTraceCount,
      )
    }

    this.errorAggregator.addErrorsFromTrace(trace)
    this.broadcast({ traces: [trace], metrics: [], logs: [], errors: this.errorAggregator.getErrorGroups() })
  }

  addTraces(traces: TraceData[]): void {
    for (const trace of traces) this.addTrace(trace)
  }

  // `errors` is full-state on every broadcast (the client replaces, not appends),
  // so non-trace broadcasts must echo the current error groups rather than `[]` —
  // otherwise a log/metric arriving after an error would wipe it from the UI.
  addLog(log: LogData): void {
    this.logs = appendWithLimit(this.logs, log, this.limits.maxLogCount)
    this.broadcast({ traces: [], metrics: [], logs: [log], errors: this.errorAggregator.getErrorGroups() })
  }

  addLogs(logs: LogData[]): void {
    this.logs = appendManyWithLimit(this.logs, logs, this.limits.maxLogCount)
    this.broadcast({ traces: [], metrics: [], logs, errors: this.errorAggregator.getErrorGroups() })
  }

  addMetric(metric: MetricData): void {
    this.metrics = appendWithLimit(
      this.metrics,
      metric,
      this.limits.maxMetricCount,
    )
    this.broadcast({ traces: [], metrics: [metric], logs: [], errors: this.errorAggregator.getErrorGroups() })
  }

  getCurrentData(): DevtoolsData {
    return {
      traces: this.traces,
      metrics: this.metrics,
      logs: this.logs,
      errors: this.errorAggregator.getErrorGroups(),
    }
  }

  clearData(): void {
    this.traces = []
    this.logs = []
    this.metrics = []
    this.errorAggregator.clear()
  }

  private broadcast(data: DevtoolsData): void {
    const msg = JSON.stringify(data)
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    }
    // Notify embedders after WS fan-out; never let a listener throw break ingest.
    if (this.onData) {
      try {
        this.onData(data)
      } catch {
        /* embedder listener errors are their own concern */
      }
    }
  }

  private log(message: string): void {
    if (this.verbose) console.log(`[autotel-devtools] ${message}`)
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.close()
    this.clients.clear()
    this.wss.close()
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()))
  }
}
