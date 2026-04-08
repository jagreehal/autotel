// src/server/http.ts
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOtlpTraces, parseOtlpLogs, countOtlpMetrics, readJsonBody, sendJson } from './otlp'
import type { DevtoolsServer } from './server'

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

const FULLPAGE_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>autotel-devtools</title><style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;width:100%;overflow:hidden}</style></head><body><script src="/widget.js?mode=fullpage"></script></body></html>`

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

export function attachDevtoolsRoutes(httpServer: Server, devtools: DevtoolsServer): void {
  httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

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

    // GET /healthz
    if (req.method === 'GET' && url === '/healthz') {
      sendJson(res, 200, { ok: true, clients: devtools.clientCount })
      return
    }

    // POST /v1/traces
    if (req.method === 'POST' && url === '/v1/traces') {
      try {
        const payload = await readJsonBody(req)
        const traces = parseOtlpTraces(payload)
        devtools.addTraces(traces)
        sendJson(res, 200, { acceptedTraces: traces.length })
      } catch (e) {
        sendJson(res, 400, { error: 'Invalid OTLP JSON', message: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    // POST /v1/logs
    if (req.method === 'POST' && url === '/v1/logs') {
      try {
        const payload = await readJsonBody(req)
        const logs = parseOtlpLogs(payload)
        devtools.addLogs(logs)
        sendJson(res, 200, { acceptedLogs: logs.length })
      } catch (e) {
        sendJson(res, 400, { error: 'Invalid OTLP JSON', message: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    // POST /v1/metrics
    if (req.method === 'POST' && url === '/v1/metrics') {
      try {
        const payload = await readJsonBody(req)
        const count = countOtlpMetrics(payload)
        sendJson(res, 200, { acceptedMetrics: count })
      } catch (e) {
        sendJson(res, 400, { error: 'Invalid OTLP JSON', message: e instanceof Error ? e.message : String(e) })
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
