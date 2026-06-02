#!/usr/bin/env node
// src/cli.ts
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DevtoolsServer } from './server/server'
import { attachDevtoolsRoutes } from './server/http'
import { listenLoopbackDualStack } from './server/listen'
import { probePortHolder } from './server/identity'

interface CliOptions {
  port: number
  host: string
  title?: string
}

function printHelp(): void {
  process.stdout.write(
    `autotel-devtools - Standalone OTLP receiver with web devtools UI

Usage: autotel-devtools [port] [options]

Arguments:
  port                 Port to listen on (shorthand for --port; must be a positive integer)

Options:
  -p, --port <port>    Port to listen on (default: 4318, env: AUTOTEL_DEVTOOLS_PORT).
                       If the port is taken, the next free port is used and a warning is shown.
  -H, --host <host>    Host to bind to (default: 127.0.0.1, env: AUTOTEL_DEVTOOLS_HOST)
  -t, --title <title>  Dashboard title (env: AUTOTEL_DEVTOOLS_TITLE)
  Env limits:          AUTOTEL_MAX_TRACE_COUNT, AUTOTEL_MAX_LOG_COUNT, AUTOTEL_MAX_METRIC_COUNT
  -h, --help           Show this help message
  -v, --version        Show version number

Endpoints:
  GET    /             Web devtools UI (fullpage)
  GET    /widget.js    Widget bundle (embed in your app)
  POST   /v1/traces    Receive OTLP JSON trace data
  GET    /v1/traces    Read back received traces (verify ingestion in tests)
  DELETE /v1/traces    Clear captured telemetry (test reset)
  POST   /v1/logs      Receive OTLP JSON log data
  POST   /v1/metrics   Receive OTLP JSON metric data
  WS     /ws           WebSocket stream for real-time updates
  GET    /healthz      Health check

Examples:
  npx autotel-devtools
  npx autotel-devtools 4319
  npx autotel-devtools -p 4319 -H 0.0.0.0

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
    port: parsePort(process.env.AUTOTEL_DEVTOOLS_PORT || '4318'),
    host: process.env.AUTOTEL_DEVTOOLS_HOST || '127.0.0.1',
    title: process.env.AUTOTEL_DEVTOOLS_TITLE,
  }

  // An explicit `--port`/`-p` always wins, regardless of where it sits in
  // argv. A bare numeric positional is shorthand for `--port`, but only when
  // no explicit flag was given — and only the first positional counts, so a
  // stray "4318" can't override an earlier positional either.
  let portWasExplicit = false
  let positionalPortConsumed = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--help' || arg === '-h') { printHelp(); return null }
    if (arg === '--version' || arg === '-v') { printVersion(); return null }
    if ((arg === '--port' || arg === '-p') && next) { options.port = parsePort(next); portWasExplicit = true; i++; continue }
    if ((arg === '--host' || arg === '-H') && next) { options.host = next; i++; continue }
    if ((arg === '--title' || arg === '-t') && next) { options.title = next; i++; continue }
    if (/^\d+$/.test(arg) && !positionalPortConsumed) {
      if (!portWasExplicit) options.port = parsePort(arg)
      positionalPortConsumed = true
      continue
    }
  }

  return options
}

function parsePort(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    process.stderr.write(`[autotel-devtools] invalid port: ${value}\n`)
    process.exit(2)
  }
  return n
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!options) { process.exit(0) }

  const httpServer = createServer()
  const wsServer = new DevtoolsServer({ server: httpServer, verbose: true })
  attachDevtoolsRoutes(httpServer, wsServer)

  const listeners = listenLoopbackDualStack({
    primary: httpServer,
    port: options.port,
    host: options.host,
    attachSecondary: (s) => attachDevtoolsRoutes(s, wsServer),
  })

  const { addresses, warnings, port: boundPort } = await listeners.ready

  // Falling forward to a different port means the one we wanted is held by
  // someone else. Classify them: another autotel-devtools (benign) versus a
  // foreign process. The foreign case is the silent footgun — apps keep
  // exporting OTLP to the requested port and reach that process, not us, so
  // this UI stays empty while they see export errors. Say so, with the fix.
  if (boundPort !== options.port) {
    const holder = await probePortHolder(options.host, options.port)
    if (holder === 'autotel-devtools') {
      warnings.push(
        `another autotel-devtools is already running on port ${options.port}; ` +
          `this instance is on ${boundPort}. Use the existing one, or stop it and restart here.`,
      )
    } else {
      warnings.push(
        `port ${options.port} is held by another process that is NOT autotel-devtools. ` +
          `Anything exporting OTLP to :${options.port} is reaching that process, not this devtools. ` +
          `Point your exporter at :${boundPort}, or free :${options.port} and restart.`,
      )
    }
  }

  const uiBase = `http://${options.host === 'localhost' ? '127.0.0.1' : options.host}:${boundPort}`
  const title = options.title || 'autotel-devtools'
  process.stdout.write(`\n  ${title}\n\n`)
  process.stdout.write(`  Listening: ${addresses.join('  +  ')}\n`)
  process.stdout.write(`  UI:        ${uiBase}   (open in a browser)\n`)
  process.stdout.write(`  OTLP:      ${uiBase}/v1/traces\n`)
  process.stdout.write(`  WebSocket: ${uiBase.replace('http', 'ws')}/ws\n\n`)
  // The widget bundle auto-mounts on load, so the bare <script> tag is all the
  // user needs — spell that out, plus the two opt-in variations, so nobody
  // wonders whether they also have to add an element by hand.
  process.stdout.write(
    `  Embed in your app — paste into your HTML; a floating panel appears automatically:\n`,
  )
  process.stdout.write(`    <script src="${uiBase}/widget.js"></script>\n\n`)
  process.stdout.write(
    `    full screen instead:  <script src="${uiBase}/widget.js?mode=fullpage"></script>\n`,
  )
  process.stdout.write(
    `    choose where it goes: add <autotel-devtools></autotel-devtools> to your markup\n\n`,
  )
  process.stdout.write(`  Or point any OTLP exporter at this receiver:\n`)
  process.stdout.write(`    OTEL_EXPORTER_OTLP_PROTOCOL=http/json\n`)
  process.stdout.write(`    OTEL_EXPORTER_OTLP_ENDPOINT=${uiBase}\n\n`)
  // Self-check: confirm the collector is reachable AND that ingestion works,
  // not just that something is listening. Reading /v1/traces back is the same
  // check a test should make instead of trusting "the client tried to send".
  process.stdout.write(`  Verify ingestion: curl -s ${uiBase}/v1/traces\n\n`)
  for (const w of warnings) {
    process.stdout.write(`  ⚠ ${w}\n`)
  }
  if (warnings.length > 0) process.stdout.write('\n')

  const shutdown = () => {
    Promise.all([wsServer.close(), listeners.closeSibling()]).then(() =>
      process.exit(0),
    )
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  process.stderr.write(`[autotel-devtools] failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
