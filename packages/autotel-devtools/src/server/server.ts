// src/server/server.ts
import { WebSocketServer, WebSocket } from 'ws';
import { encodeTraces } from '../wire/wire';
import type { Server as HTTPServer } from 'node:http';
import { createServer } from 'node:http';
import { ErrorAggregator } from './error-aggregator';
import { foldWebMcpTools, type WebMcpInventory } from './webmcp-aggregator';
import {
  ingestAgentEvents,
  ingestAgentMetrics,
  type AgentSessionStore,
  type AgentRawEvent,
  type OtelMetricRecord,
} from 'autotel-agents';
import type { TraceData, LogData, DevtoolsData, ErrorGroup } from './types';
import type { QueryError } from '../query/ast';
import {
  appendManyWithLimit,
  appendWithLimit,
  resolveTelemetryLimits,
  type TelemetryLimits,
} from './telemetry-limits';
import { allowSensitiveRequest, hostHeaderIsLoopback } from './origin-guard';
import { pickRoot } from './trace-root';
import {
  DevtoolsStore,
  type QueryLogsArgs,
  type QueryLogsResult,
  type MetricCatalogEntry,
  type MetricSeries,
  type QueryMetricSeriesArgs,
  type QueryTracesArgs,
  type QueryTracesResult,
} from './store/store';
import type { MetricStreamRecord } from './metric-streams';
import {
  countOtlpMetrics,
  parseOtlpAgentEvents,
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
} from './otlp';
import { parseOtlpMetricStreams } from './metric-streams';

export interface DevtoolsServerOptions {
  port?: number;
  server?: HTTPServer;
  path?: string;
  verbose?: boolean;
  maxHistory?: number;
  maxTraceCount?: number;
  maxLogCount?: number;
  maxMetricCount?: number;
  /**
   * Bind host, used only to decide the WebSocket origin policy. A loopback host
   * (the default) enables the DNS-rebinding `Host` check on the live stream; an
   * explicit non-loopback bind opts out, leaving just the cross-origin check.
   */
  host?: string;
  /**
   * Called after each ingest, with the incremental data just broadcast to WS
   * clients. Lets an embedder (e.g. the VS Code extension) react to new
   * telemetry — refresh its own tree views — while the server owns the buffer.
   */
  onData?: (incremental: DevtoolsData) => void;
  /**
   * Path to the sqlite database backing the store. Omit for in-memory, which
   * is the default so existing embedders keep their previous behaviour: they
   * get querying and paging, but nothing is written to disk unless asked for.
   */
  dbPath?: string;
  /** Maximum traces retained in the store before the oldest are pruned. */
  maxTraces?: number;
  /** Maximum logs retained in the store before the oldest are pruned. */
  maxLogs?: number;
  /** Maximum logical sqlite size before oldest telemetry is pruned. */
  maxDbBytes?: number;
  /**
   * How often to prune the store past its caps, in ms. `0` disables the loop.
   *
   * Retention has to run on a timer, not only on ingest: a session that stops
   * receiving telemetry should not keep whatever it accumulated forever, and
   * pruning inside the ingest path would put a delete on the hot path of every
   * batch.
   */
  retentionIntervalMs?: number;
}

/** How often the store is pruned past its caps. */
const DEFAULT_RETENTION_INTERVAL_MS = 30_000;

/**
 * Traces read when aggregating errors.
 *
 * Deliberately large: an error group's count is only right if every occurrence
 * in the window is seen, and a page-sized read would under-report the common
 * failures most — the ones with occurrences past the page boundary.
 */
export class DevtoolsServer {
  private wss: WebSocketServer;
  private readonly wsPath: string;
  private readonly loopbackOnly: boolean;
  private clients = new Set<WebSocket>();
  private httpServer: HTTPServer;
  private traces: TraceData[] = [];
  private logs: LogData[] = [];
  // Canonical agent-session store. Rollups are kept indefinitely; the package's
  // reducers ring-buffer each session's raw timeline. We broadcast the full set
  // (full-state, like errors) so late/reconnecting clients converge.
  private agentSessions: AgentSessionStore = new Map();
  private errorAggregator = new ErrorAggregator();
  private limits: TelemetryLimits;
  private verbose: boolean;
  private _port: number;
  private onData?: (incremental: DevtoolsData) => void;
  /**
   * Durable store. The in-memory `traces`/`logs` arrays above remain the live
   * tail — what a freshly-connected client is handed and what streams over WS —
   * while the store answers queries and outlives the process. Both are written
   * on every ingest; neither is derived from the other.
   */
  private store: DevtoolsStore;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DevtoolsServerOptions = {}) {
    this.limits = resolveTelemetryLimits(options);
    this.verbose = options.verbose ?? false;
    this._port = options.port ?? 4318;
    this.onData = options.onData;
    this.store = new DevtoolsStore({
      path: options.dbPath,
      maxTraces: options.maxTraces,
      maxLogs: options.maxLogs,
      maxBytes: options.maxDbBytes,
    });
    this.startRetentionLoop(options.retentionIntervalMs);

    this.httpServer = options.server ?? createServer();
    // Reject a live-stream subscription from a page that isn't same-machine —
    // a browser tab on evil.com opening `ws://127.0.0.1:PORT/ws` would otherwise
    // receive every captured span. Mirrors the read-back HTTP guard.
    const loopbackOnly =
      options.host == null || hostHeaderIsLoopback(options.host);
    this.wsPath = options.path ?? '/ws';
    this.loopbackOnly = loopbackOnly;
    this.wss = new WebSocketServer({
      // `noServer` rather than `{ server }`: a loopback bind creates a second
      // listener for the other IP family (see `listen.ts`), and one
      // `WebSocketServer` can only attach itself to one of them. Owning the
      // upgrade lets both listeners feed the same client set, which is what
      // the broadcast fan-out depends on — two servers would mean a client
      // that only ever hears from one of them.
      noServer: true,
      // The live tail is the biggest thing this server sends, and a trace
      // payload is mostly repeated keys and near-identical ids: a 4,891-span
      // trace measures 2,078 KiB raw against 41 KiB deflated. `ws` leaves this
      // off by default, so the stream was going out uncompressed.
      //
      // Context takeover stays on (the default), which is what lets the
      // dictionary carry across messages and makes the second trace on the
      // wire cheaper than the first. The cost is a zlib context per client,
      // which for a local dev tool with a handful of tabs is nothing.
      perMessageDeflate: { threshold: 1024 },
    });
    this.attachWebSocket(this.httpServer);

    // The `ws` library re-emits the http server's `error` event onto the
    // WebSocketServer itself. During the bind phase (EADDRINUSE etc.) the
    // http server's own listener owns recovery, and the re-emission here has
    // no listener — it would crash the process. Swallow ONLY that bind-phase
    // re-emission (server not yet listening). Anything emitted once the server
    // is live is a genuine WSS fault — re-throw so it surfaces.
    this.wss.on('error', (err) => {
      if (this.httpServer.listening) throw err;
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.log(`Client connected (${this.clients.size} total)`);

      // Send history to late-connecting clients
      const data = this.getCurrentData();
      if (
        data.traces.length > 0 ||
        data.logs.length > 0 ||
        data.errors.length > 0 ||
        (data.agents?.length ?? 0) > 0
      ) {
        ws.send(JSON.stringify(data));
      }

      ws.on('close', () => {
        this.clients.delete(ws);
        this.log(`Client disconnected (${this.clients.size} total)`);
      });
    });

    // Only start listening if no external server was provided
    if (!options.server) {
      // Bind the host the caller asked for. Listening on every interface while
      // the caller said `127.0.0.1` publishes their captured telemetry to the
      // network, and it also lets the kernel hand out a port whose loopback
      // twin belongs to another process, which reads as a server that started
      // and then would not answer.
      const listening = () => {
        const addr = this.httpServer.address();
        if (addr && typeof addr === 'object') this._port = addr.port;
        this.log(`WebSocket server listening on port ${this._port}`);
      };
      if (options.host == null) this.httpServer.listen(this._port, listening);
      else this.httpServer.listen(this._port, options.host, listening);
    }
  }

  get port(): number {
    const addr = this.httpServer.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this._port;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  addTrace(trace: TraceData): void {
    // Merge if trace already exists (out-of-order spans). Spans for one trace
    // arrive across multiple batches and services, so the root span and timing
    // must be recomputed from the merged span set — the first batch to arrive
    // (e.g. a downstream service) may not contain the parentless root span.
    const existing = this.traces.find((t) => t.traceId === trace.traceId);
    const merged = existing ?? trace;
    let newSpans = trace.spans;
    if (existing) {
      const existingSpanIds = new Set(existing.spans.map((s) => s.spanId));
      newSpans = [];
      for (const span of trace.spans) {
        if (!existingSpanIds.has(span.spanId)) {
          existing.spans.push(span);
          newSpans.push(span);
        }
      }
      existing.startTime = Math.min(existing.startTime, trace.startTime);
      existing.endTime = Math.max(existing.endTime, trace.endTime);
      existing.duration = existing.endTime - existing.startTime;
      if (trace.status === 'ERROR') existing.status = 'ERROR';

      // Recompute the root from the merged set. `partial` is a fact about the
      // spans held, not about a batch: a complete trace whose children arrived
      // first is flagged partial until its root lands, so this has to clear the
      // flag as well as set it.
      existing.spans.sort((a, b) => a.startTime - b.startTime);
      const { rootSpan, partial } = pickRoot(existing.spans);
      existing.rootSpan = rootSpan;
      if (partial) {
        existing.partial = true;
      } else {
        delete existing.partial;
        const rootService = rootSpan.attributes?.['service.name'];
        if (typeof rootService === 'string' && rootService.length > 0) {
          existing.service = rootService;
        }
      }
    } else {
      this.traces = appendWithLimit(
        this.traces,
        trace,
        this.limits.maxTraceCount,
      );
    }

    // Exporters retry batches. Only newly observed span identities contribute
    // error occurrences; the durable store follows the same idempotent rule.
    if (newSpans.length > 0) {
      this.errorAggregator.addErrorsFromTrace({ ...trace, spans: newSpans });
    }
    // Persist the merged trace, not the incoming batch: the store's upsert
    // widens a trace's bounds as spans arrive, and handing it the merged view
    // keeps the stored root span in step with the one clients were shown.
    this.store.ingestTraces([merged]);
    // Broadcast the merged trace (not just the incoming batch) so live clients
    // and any client that reconnects mid-trace converge on the full picture.
    this.broadcast({
      traces: [merged],
      logs: [],
      errors: this.errorAggregator.getErrorGroups(),
    });
  }

  addTraces(traces: TraceData[]): void {
    for (const trace of traces) this.addTrace(trace);
  }

  // `errors` is full-state on every broadcast (the client replaces, not appends),
  // so non-trace broadcasts must echo the current error groups rather than `[]` —
  // otherwise a log/metric arriving after an error would wipe it from the UI.
  addLog(log: LogData): void {
    this.logs = appendWithLimit(this.logs, log, this.limits.maxLogCount);
    this.store.ingestLogs([log]);
    this.broadcast({
      traces: [],
      logs: [log],
      errors: this.errorAggregator.getErrorGroups(),
    });
  }

  addLogs(logs: LogData[]): void {
    this.logs = appendManyWithLimit(this.logs, logs, this.limits.maxLogCount);
    this.store.ingestLogs(logs);
    this.broadcast({
      traces: [],
      logs,
      errors: this.errorAggregator.getErrorGroups(),
    });
  }

  /** Ingest one decoded OTLP request, regardless of its transport. */
  /**
   * Serve the live tail on another HTTP listener.
   *
   * A loopback bind produces two listeners, one per IP family, because
   * `localhost` resolves to `::1` on macOS and `127.0.0.1` elsewhere. The HTTP
   * routes were attached to both from the start and the WebSocket was not, so
   * the widget connected over one address and silently failed over the other:
   * telemetry visible, live tail dead, and nothing in the UI saying why.
   *
   * Both listeners hand their upgrades to the same `WebSocketServer`, so there
   * is still one client set and one broadcast.
   */
  attachWebSocket(server: HTTPServer): void {
    server.on('upgrade', (req, socket, head) => {
      // Path is compared without the query string, the way `ws` does it.
      const path = (req.url ?? '/').split('?')[0];
      if (path !== this.wsPath) {
        // Matches what `ws` does for an unhandled path when it owns the
        // upgrade: refuse rather than leave the socket hanging open.
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      // The same guard the read-back routes use: a tab on evil.com opening
      // `ws://127.0.0.1:PORT/ws` would otherwise receive every captured span.
      if (
        !allowSensitiveRequest(
          { origin: req.headers.origin, host: req.headers.host },
          this.loopbackOnly,
        )
      ) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });
  }

  ingestOtlp(signal: 'traces' | 'logs' | 'metrics', payload: unknown): number {
    if (signal === 'traces') {
      const traces = parseOtlpTraces(payload);
      this.addTraces(traces);
      return traces.length;
    }
    if (signal === 'logs') {
      const logs = parseOtlpLogs(payload);
      this.addLogs(logs);
      this.ingestAgentEvents(parseOtlpAgentEvents(payload));
      return logs.length;
    }
    this.ingestAgentMetrics(parseOtlpMetrics(payload));
    this.ingestMetricStreams(parseOtlpMetricStreams(payload));
    return countOtlpMetrics(payload);
  }

  /** Fold decoded agent log events into sessions and broadcast the full set. */
  ingestAgentEvents(records: AgentRawEvent[]): void {
    if (records.length === 0) return;
    ingestAgentEvents(this.agentSessions, records);
    this.broadcastAgents();
  }

  /**
   * Store decoded metric streams for the Metrics tab.
   *
   * Separate from `ingestAgentMetrics`: that folds the same OTLP batch into
   * coding-agent sessions through a counter-shaped model, while this keeps the
   * full data points — buckets, quantiles, exemplars — that charts need.
   */
  ingestMetricStreams(streams: MetricStreamRecord[]): void {
    if (streams.length === 0) return;
    this.store.ingestMetrics(streams);
  }

  /** Metric catalogue: every metric name held, with its kind and series count. */
  listMetricNames(): MetricCatalogEntry[] {
    return this.store.listMetricNames();
  }

  queryMetricCatalog(query: string) {
    return this.store.queryMetricCatalog(query);
  }

  /** The series for one metric, with their points. */
  queryMetricSeries(args: QueryMetricSeriesArgs): MetricSeries[] {
    return this.store.queryMetricSeries(args);
  }

  /** Fold decoded agent metric records into sessions and broadcast the full set. */
  ingestAgentMetrics(records: OtelMetricRecord[]): void {
    if (records.length === 0) return;
    ingestAgentMetrics(this.agentSessions, records);
    this.broadcastAgents();
  }

  private broadcastAgents(): void {
    this.broadcast({
      traces: [],
      logs: [],
      errors: this.errorAggregator.getErrorGroups(),
      agents: [...this.agentSessions.values()],
    });
  }

  /**
   * Run a query against the durable store.
   *
   * Distinct from `getCurrentData()`, which returns the live tail: this reaches
   * the whole retained history, which is normally far larger than the tail and
   * is the only way to see anything from before the process restarted.
   */
  queryTraces(args: QueryTracesArgs): QueryTracesResult {
    return this.store.queryTraces(args);
  }

  /** Route and span-name counts, for the instrumentation coverage join. */
  observedSpans(): ReturnType<DevtoolsStore['observedSpans']> {
    return this.store.observedSpans();
  }

  /** One row per matching span, as the population for a cohort comparison. */
  cohortRows(args: QueryTracesArgs): Array<Record<string, unknown>> {
    return this.store.cohortRows(args);
  }

  /**
   * Aggregate errors from the store for a window and query.
   *
   * A fresh aggregator over whatever the store returns, rather than a second
   * implementation: the grouping, fingerprinting and sampling rules are the
   * same ones the live path uses, so the two cannot describe the same failure
   * differently.
   *
   * The live `errorAggregator` stays as it is — it backs the WS full-state
   * broadcast, which has no window and needs none.
   */
  queryErrors(args: QueryTracesArgs): {
    errors: ErrorGroup[];
    errors_parse?: QueryError[];
  } {
    const aggregator = new ErrorAggregator();
    const seenCursors = new Set<string>();
    let cursor = args.cursor;
    do {
      const result = this.store.queryTraces({ ...args, cursor });
      if (result.errors) return { errors: [], errors_parse: result.errors };
      for (const trace of result.traces) aggregator.addErrorsFromTrace(trace);
      cursor = result.nextCursor ?? undefined;
      if (cursor && seenCursors.has(cursor)) break;
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return { errors: aggregator.getErrorGroups() };
  }

  /**
   * Fold WebMCP lifecycle history through the window end into the tool surface
   * an agent is offered, while counting executions only inside the window.
   *
   * Drains every page rather than folding the first one: an inventory built
   * from a page of results does not fail, it *under-reports* — "2 tools dropped
   * annotations" when the answer is 6 — and gets more wrong the more traffic
   * there is, which is backwards for an observability answer.
   *
   * The span-name filter is composed here rather than accepted from the client:
   * this endpoint answers one question, and a caller-supplied predicate could
   * only narrow it into a wrong answer.
   */
  queryWebMcp(args: {
    window?: { start: number; end: number };
    limit?: number;
  }): {
    webmcp: WebMcpInventory;
    errors_parse?: QueryError[];
  } {
    const traces: TraceData[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = this.store.queryTraces({
        query: 'name ^ "webmcp."',
        window: args.window ? { start: 0, end: args.window.end } : undefined,
        limit: args.limit,
        cursor,
      });
      if (result.errors)
        return {
          webmcp: foldWebMcpTools([]),
          errors_parse: result.errors,
        };
      traces.push(...result.traces);
      cursor = result.nextCursor ?? undefined;
      if (cursor && seenCursors.has(cursor)) break;
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return { webmcp: foldWebMcpTools(traces, args.window) };
  }

  /** Run a log query against the durable store. */
  queryLogs(args: QueryLogsArgs): QueryLogsResult {
    return this.store.queryLogs(args);
  }

  listQueryFields(signal: 'traces' | 'logs'): string[] {
    return this.store.listQueryFields(signal);
  }

  pairedAttributeValues(
    signal: 'traces' | 'logs',
    key: string,
    pairedKey: string,
    limit?: number,
  ) {
    return this.store.pairedAttributeValues(signal, key, pairedKey, limit);
  }

  searchAttributes(signal: 'traces' | 'logs', value: string, limit?: number) {
    return this.store.searchAttributes(signal, value, limit);
  }

  getStoreStats() {
    return this.store.getStats();
  }

  describeTrace(traceId: string) {
    return this.store.describeTrace(traceId);
  }

  findSlowestTraces(limit?: number) {
    return this.store.findSlowest(limit);
  }

  /** Prune the store to its retention cap. Safe to call on a timer. */
  enforceRetention(): void {
    this.store.enforceRetention();
  }

  /**
   * Prune periodically for the life of the server.
   *
   * `unref` matters: without it this timer alone keeps the Node process alive,
   * so a CLI that has finished its work would hang instead of exiting. A
   * failure is logged rather than thrown — an interval callback that throws
   * takes the process down, and a missed prune is not worth that.
   */
  private startRetentionLoop(intervalMs = DEFAULT_RETENTION_INTERVAL_MS): void {
    if (intervalMs <= 0) return;
    this.retentionTimer = setInterval(() => {
      try {
        this.store.enforceRetention();
      } catch (error) {
        this.log(`retention failed: ${String(error)}`);
      }
    }, intervalMs);
    this.retentionTimer.unref?.();
  }

  getCurrentData(): DevtoolsData {
    return {
      traces: this.traces,
      logs: this.logs,
      errors: this.errorAggregator.getErrorGroups(),
      agents: [...this.agentSessions.values()],
    };
  }

  clearData(): void {
    this.traces = [];
    this.logs = [];
    this.agentSessions.clear();
    this.errorAggregator.clear();
    this.store.clear();
  }

  clearSignal(signal: 'traces' | 'logs' | 'metrics'): void {
    this.store.clearSignal(signal);
    if (signal === 'traces') {
      this.traces = [];
      this.errorAggregator.clear();
    } else if (signal === 'logs') {
      this.logs = [];
    }
  }

  deleteMetric(name: string): number {
    return this.store.deleteMetric(name);
  }

  deleteTraces(traceIds: string[]): number {
    const ids = new Set(traceIds);
    this.traces = this.traces.filter((trace) => !ids.has(trace.traceId));
    const deleted = this.store.deleteTraces(traceIds);
    this.errorAggregator.clear();
    let cursor: string | undefined;
    do {
      const page = this.store.queryTraces({ query: '', limit: 1_000, cursor });
      for (const trace of page.traces)
        this.errorAggregator.addErrorsFromTrace(trace);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return deleted;
  }

  private broadcast(data: DevtoolsData): void {
    // Encode once for every client. `onData` embedders below still receive the
    // in-memory `TraceData`, since they never crossed a wire.
    const msg = JSON.stringify(
      data.traces?.length
        ? { ...data, traces: encodeTraces(data.traces) }
        : data,
    );
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
    // Notify embedders after WS fan-out; never let a listener throw break ingest.
    if (this.onData) {
      try {
        this.onData(data);
      } catch {
        /* embedder listener errors are their own concern */
      }
    }
  }

  private log(message: string): void {
    if (this.verbose) console.log(`[autotel-devtools] ${message}`);
  }

  async close(): Promise<void> {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
    for (const client of this.clients) client.close();
    this.clients.clear();
    this.wss.close();
    await new Promise<void>((resolve) =>
      this.httpServer.close(() => resolve()),
    );
    // Close the store last: an in-flight ingest holds it, and closing before
    // the HTTP server has stopped accepting requests would race a write.
    this.store.close();
  }
}
