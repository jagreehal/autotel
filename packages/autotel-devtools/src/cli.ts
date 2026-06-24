#!/usr/bin/env node
// src/cli.ts
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DevtoolsServer } from './server/server'
import { attachDevtoolsRoutes } from './server/http'
import { hostHeaderIsLoopback } from './server/origin-guard'
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
       autotel-devtools claude [claude args] [--print-env] [--log-prompts]

Subcommands:
  claude               Start the receiver AND launch Claude Code wired to it
                       (HTTP/protobuf → this receiver, 1s intervals, session id on).
                       Open the "Agents" tab to watch sessions, tokens, cost,
                       tool / MCP / sub-agent / skill usage live.
                         --print-env    Print the telemetry env block and exit (don't launch)
                         --log-prompts  Capture prompt text (default: length only / private)

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
  npx autotel-devtools claude                 # watch Claude Code in the Agents tab
  npx autotel-devtools claude --print-env     # just print the env (for MDM / VS Code)

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

interface RunningReceiver {
  wsServer: DevtoolsServer
  closeAll: () => Promise<void>
  addresses: string[]
  warnings: string[]
  boundPort: number
  uiBase: string
}

async function startReceiver(options: CliOptions): Promise<RunningReceiver> {
  const httpServer = createServer()
  const loopbackOnly = hostHeaderIsLoopback(options.host)
  const wsServer = new DevtoolsServer({ server: httpServer, host: options.host, verbose: true })
  attachDevtoolsRoutes(httpServer, wsServer, { loopbackOnly })

  const listeners = listenLoopbackDualStack({
    primary: httpServer,
    port: options.port,
    host: options.host,
    attachSecondary: (s) => attachDevtoolsRoutes(s, wsServer, { loopbackOnly }),
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
  return {
    wsServer,
    closeAll: () => Promise.all([wsServer.close(), listeners.closeSibling()]).then(() => undefined),
    addresses,
    warnings,
    boundPort,
    uiBase,
  }
}

// Telemetry env that wires Claude Code (and any OTel-via-env CLI) to this
// receiver for a *live* local view: HTTP/protobuf (NOT gRPC — this receiver
// speaks HTTP only), 1s export intervals so events show up promptly, and
// session.id kept on metrics so metric-only signals join their session.
function buildAgentEnv(uiBase: string, logPrompts: boolean): Record<string, string> {
  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_EXPORTER_OTLP_ENDPOINT: uiBase,
    OTEL_METRIC_EXPORT_INTERVAL: '1000',
    OTEL_LOGS_EXPORT_INTERVAL: '1000',
    OTEL_METRICS_INCLUDE_SESSION_ID: 'true',
  }
  // Private by default: prompt *text* only flows when explicitly opted in.
  if (logPrompts) env.OTEL_LOG_USER_PROMPTS = '1'
  return env
}

function printEnvBlock(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.stdout.write(`export ${key}=${value}\n`)
  }
}

interface ClaudeOptions {
  port: number
  host: string
  printEnv: boolean
  logPrompts: boolean
  claudeArgs: string[]
}

function parseClaudeArgs(argv: string[]): ClaudeOptions {
  const opts: ClaudeOptions = {
    port: parsePort(process.env.AUTOTEL_DEVTOOLS_PORT || '4318'),
    host: process.env.AUTOTEL_DEVTOOLS_HOST || '127.0.0.1',
    printEnv: false,
    logPrompts: false,
    claudeArgs: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--') { opts.claudeArgs.push(...argv.slice(i + 1)); break }
    if (arg === '--print-env') { opts.printEnv = true; continue }
    if (arg === '--log-prompts') { opts.logPrompts = true; continue }
    if ((arg === '--port' || arg === '-p') && next) { opts.port = parsePort(next); i++; continue }
    if ((arg === '--host' || arg === '-H') && next) { opts.host = next; i++; continue }
    // Anything else is passed straight through to `claude`.
    opts.claudeArgs.push(arg)
  }
  return opts
}

async function runClaudeSubcommand(argv: string[]): Promise<void> {
  const opts = parseClaudeArgs(argv)

  // --print-env needs no running server: emit the block for the configured
  // port so users can paste it into a shell / managed-settings file.
  if (opts.printEnv) {
    const uiBase = `http://${opts.host === 'localhost' ? '127.0.0.1' : opts.host}:${opts.port}`
    printEnvBlock(buildAgentEnv(uiBase, opts.logPrompts))
    return
  }

  const receiver = await startReceiver({ port: opts.port, host: opts.host })
  const env = buildAgentEnv(receiver.uiBase, opts.logPrompts)

  process.stdout.write(`\n  autotel-devtools — Claude Code\n\n`)
  process.stdout.write(`  Receiver:  ${receiver.uiBase}\n`)
  process.stdout.write(`  UI:        ${receiver.uiBase}   → open the "Agents" tab\n`)
  if (!opts.logPrompts) {
    process.stdout.write(`  Prompts:   private (length only) — add --log-prompts to capture text\n`)
  }
  for (const w of receiver.warnings) process.stdout.write(`  ⚠ ${w}\n`)
  process.stdout.write(`\n  Launching claude…\n\n`)

  const child = spawn('claude', opts.claudeArgs, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })

  const shutdown = () => { receiver.closeAll().then(() => process.exit(0)) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  child.on('error', (err) => {
    const reason = (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? `'claude' not found on PATH. Install Claude Code, or run the receiver alone with 'npx autotel-devtools' and point claude at ${receiver.uiBase} using --print-env.`
      : err.message
    process.stderr.write(`[autotel-devtools] ${reason}\n`)
    receiver.closeAll().then(() => process.exit(1))
  })
  child.on('exit', (code) => {
    receiver.closeAll().then(() => process.exit(code ?? 0))
  })
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  // Subcommand: `autotel-devtools claude [claude args] [--print-env] [--log-prompts]`
  if (argv[0] === 'claude') {
    await runClaudeSubcommand(argv.slice(1))
    return
  }

  const options = parseArgs(argv)
  if (!options) { process.exit(0) }

  const receiver = await startReceiver(options)
  const { addresses, warnings, uiBase } = receiver
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
    receiver.closeAll().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  process.stderr.write(`[autotel-devtools] failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
