#!/usr/bin/env node
// src/cli.ts
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DevtoolsServer } from './server/server'
import { attachDevtoolsRoutes } from './server/http'

interface CliOptions {
  port: number
  host: string
  title?: string
}

function printHelp(): void {
  process.stdout.write(
    `autotel-devtools - Standalone OTLP receiver with web devtools UI

Usage: autotel-devtools [options]

Options:
  -p, --port <port>    Port to listen on (default: 4318, env: AUTOTEL_DEVTOOLS_PORT)
  -H, --host <host>    Host to bind to (default: 127.0.0.1, env: AUTOTEL_DEVTOOLS_HOST)
  -t, --title <title>  Dashboard title (env: AUTOTEL_DEVTOOLS_TITLE)
  Env limits:          AUTOTEL_MAX_TRACE_COUNT, AUTOTEL_MAX_LOG_COUNT, AUTOTEL_MAX_METRIC_COUNT
  -h, --help           Show this help message
  -v, --version        Show version number

Endpoints:
  GET  /               Web devtools UI (fullpage)
  GET  /widget.js      Widget bundle (embed in your app)
  POST /v1/traces      Receive OTLP JSON trace data
  POST /v1/logs        Receive OTLP JSON log data
  POST /v1/metrics     Receive OTLP JSON metric data
  WS   /ws             WebSocket stream for real-time updates
  GET  /healthz        Health check

Examples:
  npx autotel-devtools
  npx autotel-devtools -p 4319

Then point your app:
  OTEL_EXPORTER_OTLP_PROTOCOL=http/json OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node app.js

View in browser:
  http://localhost:4318

Or embed widget in your app:
  <script src="http://localhost:4318/widget.js"></script>
` + '\n',
  )
}

function printVersion(): void {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const pkgPath = resolve(dir, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    process.stdout.write(`${pkg.version}\n`)
  } catch {
    process.stdout.write('unknown\n')
  }
}

function parseArgs(argv: string[]): CliOptions | null {
  const options: CliOptions = {
    port: Number(process.env.AUTOTEL_DEVTOOLS_PORT || 4318),
    host: process.env.AUTOTEL_DEVTOOLS_HOST || '127.0.0.1',
    title: process.env.AUTOTEL_DEVTOOLS_TITLE,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--help' || arg === '-h') { printHelp(); return null }
    if (arg === '--version' || arg === '-v') { printVersion(); return null }
    if ((arg === '--port' || arg === '-p') && next) { options.port = Number(next); i++; continue }
    if ((arg === '--host' || arg === '-H') && next) { options.host = next; i++; continue }
    if ((arg === '--title' || arg === '-t') && next) { options.title = next; i++; continue }
  }

  return options
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!options) { process.exit(0) }

  const httpServer = createServer()
  const wsServer = new DevtoolsServer({ server: httpServer, verbose: true })
  attachDevtoolsRoutes(httpServer, wsServer)

  httpServer.listen(options.port, options.host, () => {
    const title = options.title || 'autotel-devtools'
    process.stdout.write(`\n  ${title}\n\n`)
    process.stdout.write(`  UI:        http://${options.host}:${options.port}\n`)
    process.stdout.write(`  Widget:    <script src="http://${options.host}:${options.port}/widget.js"></script>\n`)
    process.stdout.write(`  WebSocket: ws://${options.host}:${options.port}/ws\n`)
    process.stdout.write(`  OTLP:      http://${options.host}:${options.port}/v1/traces\n\n`)
    process.stdout.write(`  Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json\n`)
    process.stdout.write(`  Set OTEL_EXPORTER_OTLP_ENDPOINT=http://${options.host}:${options.port}\n\n`)
  })

  const shutdown = () => {
    wsServer.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  process.stderr.write(`[autotel-devtools] failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
