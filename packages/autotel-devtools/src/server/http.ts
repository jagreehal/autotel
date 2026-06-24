// src/server/http.ts
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOtlpTraces, parseOtlpLogs, parseOtlpMetrics, parseOtlpAgentEvents, countOtlpMetrics, readJsonBody, readRawBody, isProtobufContentType, sendJson } from './otlp'
import { decodeOtlpTraceRequest, decodeOtlpLogsRequest, decodeOtlpMetricsRequest } from './otlp-proto'
import { DEVTOOLS_IDENTITY } from './identity'
import { allowSensitiveRequest } from './origin-guard'
import type { DevtoolsServer } from './server'

type OtlpSignal = 'traces' | 'logs' | 'metrics'

// Reply to a failed OTLP ingest. Echoing the content-type we received turns the
// otherwise opaque "Invalid OTLP payload" into something a misconfigured
// exporter can act on (e.g. it shows up as `null` when no header was sent, or
// as a protobuf type the sender didn't expect to be using).
function sendOtlpError(res: ServerResponse, req: IncomingMessage, e: unknown): void {
  sendJson(res, 400, {
    error: 'Invalid OTLP payload',
    message: e instanceof Error ? e.message : String(e),
    contentType: req.headers['content-type'] ?? null,
  })
}

const PROTOBUF_DECODERS: Record<OtlpSignal, (body: Buffer) => Record<string, unknown>> = {
  traces: decodeOtlpTraceRequest,
  logs: decodeOtlpLogsRequest,
  metrics: decodeOtlpMetricsRequest,
}

// Read an OTLP request body as a plain object, transparently decoding both
// OTLP/JSON (`application/json`) and OTLP/protobuf (`application/x-protobuf`).
// Both shapes feed the same parsers, so callers don't care which the client sent.
async function readOtlpPayload(req: IncomingMessage, signal: OtlpSignal): Promise<unknown> {
  if (isProtobufContentType(req.headers['content-type'])) {
    return PROTOBUF_DECODERS[signal](await readRawBody(req))
  }
  return readJsonBody(req)
}

export interface HttpServerOptions {
  port?: number
  host?: string
}

function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir
    dir = dirname(dir)
  }
  return dir
}

const DEVTOOLS_FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f172a"/><text x="32" y="41" text-anchor="middle" font-size="32">🛰️</text></svg>'

const FULLPAGE_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>autotel-devtools</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;width:100%;overflow:hidden}</style></head><body><script src="/widget.js?mode=fullpage"></script></body></html>`

let cachedVersion: string | null = null
function getVersion(): string {
  if (cachedVersion !== null) return cachedVersion
  let version = 'unknown'
  try {
    const pkg = JSON.parse(readFileSync(resolve(findPackageRoot(), 'package.json'), 'utf8'))
    if (typeof pkg.version === 'string') version = pkg.version
  } catch {
    /* keep 'unknown' */
  }
  cachedVersion = version
  return version
}

let cachedWidgetJs: string | null = null
function getWidgetJs(): string {
  if (!cachedWidgetJs) {
    const pkgRoot = findPackageRoot()
    const candidates = [
      resolve(pkgRoot, 'dist', 'widget.global.js'),
      resolve(pkgRoot, 'widget.global.js'),
    ]
    for (const candidate of candidates) {
      try {
        cachedWidgetJs = readFileSync(candidate, 'utf8')
        break
      } catch { /* try next */ }
    }
    if (!cachedWidgetJs) {
      cachedWidgetJs = '// widget bundle not found - run pnpm build first'
    }
  }
  return cachedWidgetJs
}

export interface DevtoolsRoutesOptions {
  /** Bound to a loopback host (the default). Enables the DNS-rebinding `Host`
   *  check on read endpoints; an explicit non-loopback bind opts out. */
  loopbackOnly?: boolean
}

export function attachDevtoolsRoutes(
  httpServer: Server,
  devtools: DevtoolsServer,
  options: DevtoolsRoutesOptions = {},
): void {
  const loopbackOnly = options.loopbackOnly ?? true
  httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    // WebSocket upgrade requests are handled by the 'upgrade' event (via the
    // ws library's WebSocketServer). Responding here would close the connection
    // before the upgrade can complete.
    if (req.headers.upgrade?.toLowerCase() === 'websocket') return

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    // Identity stamp on every response: lets a client confirm it is really
    // talking to autotel-devtools (and not, say, an IDE's OTLP collector that
    // happens to share the port) without guessing from the body shape.
    res.setHeader('x-autotel-devtools', getVersion())
    res.setHeader('Access-Control-Expose-Headers', 'x-autotel-devtools')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = req.url || '/'

    // GET / — fullpage HTML
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(FULLPAGE_HTML) })
      res.end(FULLPAGE_HTML)
      return
    }

    // GET /widget.js — widget bundle
    if (req.method === 'GET' && url.startsWith('/widget.js')) {
      const js = getWidgetJs()
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Content-Length': Buffer.byteLength(js) })
      res.end(js)
      return
    }

    if (req.method === 'GET' && (url === '/favicon.svg' || url === '/favicon.ico')) {
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': Buffer.byteLength(DEVTOOLS_FAVICON_SVG),
      })
      res.end(DEVTOOLS_FAVICON_SVG)
      return
    }

    // GET /healthz — also the canonical identity probe: `service` + `version`
    // let a caller positively confirm this is autotel-devtools.
    if (req.method === 'GET' && url === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        service: DEVTOOLS_IDENTITY,
        version: getVersion(),
        clients: devtools.clientCount,
      })
      return
    }

    // GET /v1/traces — read back what the collector has actually received.
    // This is the verification primitive for tests: poll the collector over
    // HTTP and assert receipt, instead of only asserting "the client tried to
    // send" (which a browser-level route intercept can fake). Bypasses the UI's
    // WebSocket entirely.
    if (req.method === 'GET' && url === '/v1/traces') {
      if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
        sendJson(res, 403, { error: 'Forbidden' })
        return
      }
      const data = devtools.getCurrentData()
      sendJson(res, 200, { traces: data.traces, count: data.traces.length })
      return
    }

    // DELETE /v1/traces — clear captured telemetry (test isolation / reset).
    // Clears traces, logs, metrics and aggregated errors so each test starts clean.
    if (req.method === 'DELETE' && url === '/v1/traces') {
      if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
        sendJson(res, 403, { error: 'Forbidden' })
        return
      }
      devtools.clearData()
      sendJson(res, 200, { cleared: true })
      return
    }

    // POST /v1/traces — accepts OTLP/JSON or OTLP/protobuf
    if (req.method === 'POST' && url === '/v1/traces') {
      try {
        const payload = await readOtlpPayload(req, 'traces')
        const traces = parseOtlpTraces(payload)
        devtools.addTraces(traces)
        sendJson(res, 200, { acceptedTraces: traces.length })
      } catch (e) {
        sendOtlpError(res, req, e)
      }
      return
    }

    // POST /v1/logs — accepts OTLP/JSON or OTLP/protobuf
    if (req.method === 'POST' && url === '/v1/logs') {
      try {
        const payload = await readOtlpPayload(req, 'logs')
        const logs = parseOtlpLogs(payload)
        devtools.addLogs(logs)
        // Coding-agent events arrive as logs too — fold them into agent sessions.
        devtools.ingestAgentEvents(parseOtlpAgentEvents(payload))
        sendJson(res, 200, { acceptedLogs: logs.length })
      } catch (e) {
        sendOtlpError(res, req, e)
      }
      return
    }

    // POST /v1/metrics — accepts OTLP/JSON or OTLP/protobuf
    if (req.method === 'POST' && url === '/v1/metrics') {
      try {
        const payload = await readOtlpPayload(req, 'metrics')
        // Fold coding-agent metric-only signals (lines, commits, active time, …).
        devtools.ingestAgentMetrics(parseOtlpMetrics(payload))
        sendJson(res, 200, { acceptedMetrics: countOtlpMetrics(payload) })
      } catch (e) {
        sendOtlpError(res, req, e)
      }
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  })
}

export function createDevtoolsHttpServer(devtools: DevtoolsServer, _options: HttpServerOptions = {}): Server {
  const server = createServer()
  attachDevtoolsRoutes(server, devtools)
  return server
}
