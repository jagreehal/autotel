import * as vscode from 'vscode'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { relative, resolve, sep } from 'node:path'
import type { ErrorGroup, LogData, TraceData } from 'autotel-devtools/server'

const {
  ErrorAggregator,
  appendManyWithLimit,
  parseOtlpLogs,
  parseOtlpTraces,
  resolveTelemetryLimits,
} = require('autotel-devtools/server') as typeof import('autotel-devtools/server')

type Span = TraceData['spans'][number]

const COMMANDS = [
  'autotel.start',
  'autotel.stop',
  'autotel.setPort',
  'autotel.clear',
  'autotel.revealSource',
  'autotel.copySpanId',
  'autotel.openSpanDetail',
  'autotel.openDevtools',
] as const

const extensionDisposables: vscode.Disposable[] = []
let outputChannel: vscode.OutputChannel | undefined
let statusBarItem: vscode.StatusBarItem | undefined
let receiverServer: Server | undefined
let traces: TraceData[] = []
let logs: LogData[] = []
let spansById = new Map<string, Span>()
let droppedTraceCount = 0
let droppedLogCount = 0
let errorAggregator = new ErrorAggregator()

const MAX_REQUEST_BYTES = 10 * 1024 * 1024

type ReceiverState = 'running' | 'stopped' | 'port-busy'
type ReceiverStartGuard = 'ok' | 'blocked'

let servicesProvider: ServicesProvider | undefined
let tracesProvider: TracesProvider | undefined
let logsProvider: LogsProvider | undefined
let errorsProvider: ErrorsProvider | undefined

const spanPanels = new Map<string, vscode.WebviewPanel>()
let extensionUri: vscode.Uri | undefined

function refreshTreeViews(): void {
  servicesProvider?.refresh()
  tracesProvider?.refresh()
  logsProvider?.refresh()
  errorsProvider?.refresh()
}

function registerCommands(context: vscode.ExtensionContext): void {
  for (const command of COMMANDS) {
    const disposable = vscode.commands.registerCommand(command, (arg?: unknown) => {
      switch (command) {
        case 'autotel.start':
          void startReceiver()
          return
        case 'autotel.stop':
          void stopReceiver()
          return
        case 'autotel.setPort':
          void setReceiverPort()
          return
        case 'autotel.clear':
          clearBufferedData()
          return
        case 'autotel.revealSource':
          void revealSource(arg)
          return
        case 'autotel.copySpanId':
          void copySpanId(arg)
          return
        case 'autotel.openSpanDetail':
          void openSpanDetail(arg)
          return
        case 'autotel.openDevtools':
          void openDevtools()
          return
      }
    })
    context.subscriptions.push(disposable)
    extensionDisposables.push(disposable)
  }
}

function getReceiverConfig(): { enabled: boolean; host: string; port: number; maxSpans: number; maxLogs: number } {
  const config = vscode.workspace.getConfiguration('autotel')
  return {
    enabled: config.get<boolean>('receiver.enabled', true),
    host: config.get<string>('receiver.host', '127.0.0.1'),
    port: config.get<number>('receiver.port', 4318),
    maxSpans: config.get<number>('buffer.maxSpans', 10000),
    maxLogs: config.get<number>('buffer.maxLogs', 10000),
  }
}

function updateStatusBar(state: ReceiverState): void {
  if (!statusBarItem) return
  const spanCount = traces.length
  if (state === 'running') {
    statusBarItem.text = `$(radio-tower) Autotel ${spanCount}`
    statusBarItem.tooltip = droppedTraceCount || droppedLogCount
      ? `Receiver running. Spans: ${traces.length}, logs: ${logs.length}, dropped spans: ${droppedTraceCount}, dropped logs: ${droppedLogCount}`
      : `Receiver running. Spans: ${traces.length}, logs: ${logs.length}`
    return
  }
  if (state === 'port-busy') {
    statusBarItem.text = '$(warning) Autotel port busy'
    statusBarItem.tooltip = 'Receiver could not bind to configured host/port.'
    return
  }
  statusBarItem.text = '$(primitive-square) Autotel stopped'
  statusBarItem.tooltip = 'Receiver is stopped.'
}

class PayloadTooLargeError extends Error {
  constructor() {
    super('Payload too large')
    this.name = 'PayloadTooLargeError'
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_REQUEST_BYTES) {
      throw new PayloadTooLargeError()
    }
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(encoded),
  })
  res.end(encoded)
}

function applyLimits(nextTraces: TraceData[], nextLogs: LogData[]): void {
  const limits = resolveTelemetryLimits({
    maxTraceCount: getReceiverConfig().maxSpans,
    maxLogCount: getReceiverConfig().maxLogs,
  })
  if (nextTraces.length > limits.maxTraceCount) {
    droppedTraceCount += nextTraces.length - limits.maxTraceCount
  }
  if (nextLogs.length > limits.maxLogCount) {
    droppedLogCount += nextLogs.length - limits.maxLogCount
  }
  traces = nextTraces.slice(-limits.maxTraceCount)
  logs = nextLogs.slice(-limits.maxLogCount)
  spansById = new Map(
    traces.flatMap((trace) => trace.spans.map((span) => [span.spanId, span] as const)),
  )
}

function ingestTraces(incoming: TraceData[]): void {
  applyLimits(appendManyWithLimit(traces, incoming, Number.MAX_SAFE_INTEGER), logs)
  for (const trace of incoming) {
    errorAggregator.addErrorsFromTrace(trace)
  }
  refreshTreeViews()
}

function ingestLogs(incoming: LogData[]): void {
  applyLimits(traces, appendManyWithLimit(logs, incoming, Number.MAX_SAFE_INTEGER))
  refreshTreeViews()
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      sendJson(res, 404, { error: 'Not found' })
      return
    }
    const payload = await readJson(req)
    if (req.url === '/v1/traces') {
      ingestTraces(parseOtlpTraces(payload))
      updateStatusBar('running')
      sendJson(res, 200, { ok: true, traces: traces.length })
      return
    }
    if (req.url === '/v1/logs') {
      ingestLogs(parseOtlpLogs(payload))
      updateStatusBar('running')
      sendJson(res, 200, { ok: true, logs: logs.length })
      return
    }
    sendJson(res, 404, { error: 'Not found' })
  } catch (error) {
    outputChannel?.appendLine(
      `Receiver request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    if (error instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: 'Payload too large' })
      return
    }
    sendJson(res, 400, { error: 'Invalid OTLP payload' })
  }
}

async function ensureReceiverHostAllowed(host: string): Promise<ReceiverStartGuard> {
  if (host === '127.0.0.1' || host === 'localhost') return 'ok'
  const allow = await vscode.window.showWarningMessage(
    `Autotel receiver host is set to ${host}. This exposes telemetry beyond loopback. Start anyway?`,
    { modal: true },
    'Start anyway',
  )
  if (allow === 'Start anyway') return 'ok'
  outputChannel?.appendLine(`Receiver start blocked for non-loopback host: ${host}`)
  updateStatusBar('stopped')
  return 'blocked'
}

async function startReceiver(): Promise<void> {
  if (receiverServer) {
    updateStatusBar('running')
    return
  }
  const { host, port } = getReceiverConfig()
  const guard = await ensureReceiverHostAllowed(host)
  if (guard === 'blocked') return
  const server = createServer((req, res) => {
    void handleRequest(req, res)
  })
  receiverServer = server

  await new Promise<void>((resolve) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      outputChannel?.appendLine(`Receiver failed to start: ${error.message}`)
      if (error.code === 'EADDRINUSE') {
        updateStatusBar('port-busy')
        void vscode.window.showWarningMessage(
          `Autotel receiver could not start on ${host}:${port}. Port is already in use.`,
        )
      } else {
        updateStatusBar('stopped')
      }
      receiverServer = undefined
      resolve()
    })
    server.listen(port, host, () => {
      outputChannel?.appendLine(`Receiver listening on http://${host}:${port}`)
      updateStatusBar('running')
      resolve()
    })
  })
}

async function stopReceiver(): Promise<void> {
  const server = receiverServer
  if (!server) {
    updateStatusBar('stopped')
    return
  }
  receiverServer = undefined
  await new Promise<void>((resolve) => {
    server.close(() => {
      outputChannel?.appendLine('Receiver stopped')
      resolve()
    })
  })
  updateStatusBar('stopped')
}

function clearBufferedData(): void {
  traces = []
  logs = []
  spansById = new Map()
  droppedTraceCount = 0
  droppedLogCount = 0
  errorAggregator.clear()
  refreshTreeViews()
  updateStatusBar(receiverServer ? 'running' : 'stopped')
}

async function setReceiverPort(): Promise<void> {
  const { port } = getReceiverConfig()
  const input = await vscode.window.showInputBox({
    prompt: 'Set OTLP receiver port',
    value: String(port),
    validateInput: (value) => {
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return 'Enter a valid TCP port (1-65535).'
      }
      return undefined
    },
  })
  if (!input) return
  const nextPort = Number(input)
  await vscode.workspace
    .getConfiguration('autotel')
    .update('receiver.port', nextPort, vscode.ConfigurationTarget.Workspace)
  if (receiverServer) {
    await stopReceiver()
    await startReceiver()
  }
}

function resolveSpanIdFromArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg
  if (!arg || typeof arg !== 'object') return undefined
  const candidate = arg as { spanId?: unknown }
  return typeof candidate.spanId === 'string' ? candidate.spanId : undefined
}

function resolveSpanFromArg(arg: unknown): Span | undefined {
  const spanId = resolveSpanIdFromArg(arg)
  if (!spanId) return undefined
  return spansById.get(spanId)
}

function isPathInsideWorkspace(targetPath: string): boolean {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) return false
  const resolvedTargetPath = resolve(targetPath)
  return folders.some((folder) => {
    const resolvedWorkspaceRoot = resolve(folder.uri.fsPath)
    const rel = relative(resolvedWorkspaceRoot, resolvedTargetPath)
    return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`))
  })
}

async function revealSource(arg?: unknown): Promise<void> {
  const span = resolveSpanFromArg(arg)
  const direct = arg && typeof arg === 'object'
    ? (arg as { filepath?: unknown; lineno?: unknown; ['code.filepath']?: unknown; ['code.lineno']?: unknown })
    : undefined
  const filepath = span?.attributes?.['code.filepath'] ?? direct?.filepath ?? direct?.['code.filepath']
  const lineno = span?.attributes?.['code.lineno'] ?? direct?.lineno ?? direct?.['code.lineno']
  if (typeof filepath !== 'string' || filepath.length === 0) {
    void vscode.window.showInformationMessage('Span has no source path metadata.')
    return
  }
  if (!isPathInsideWorkspace(filepath)) {
    void vscode.window.showWarningMessage('Refusing to open source outside the workspace.')
    return
  }

  const zeroBasedLine = Math.max(0, Number.isFinite(lineno) ? Number(lineno) - 1 : 0)
  const targetUri = vscode.Uri.file(filepath)
  const document = await vscode.workspace.openTextDocument(targetUri)
  await vscode.window.showTextDocument(document, {
    preview: false,
    selection: new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0),
  })
}

async function copySpanId(arg?: unknown): Promise<void> {
  const spanId = resolveSpanIdFromArg(arg)
  if (!spanId) {
    void vscode.window.showInformationMessage('No span id available to copy.')
    return
  }
  await vscode.env.clipboard.writeText(spanId)
  void vscode.window.showInformationMessage('Span ID copied.')
}

async function openSpanDetail(arg?: unknown): Promise<void> {
  const span = resolveSpanFromArg(arg)
  if (!span) {
    void vscode.window.showInformationMessage('Span not found in buffer.')
    return
  }
  if (!extensionUri) {
    void vscode.window.showWarningMessage('Extension is not fully initialised.')
    return
  }

  const existing = spanPanels.get(span.spanId)
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside)
    existing.webview.postMessage({ type: 'span', span, trace: findTraceForSpan(span.spanId) })
    return
  }

  const panel = vscode.window.createWebviewPanel(
    'autotel.spanDetail',
    `Span · ${span.name}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    },
  )

  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'span-detail.js'),
  )
  panel.webview.html = renderWebviewHtml(panel.webview, scriptUri)
  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!message || typeof message !== 'object') return
    const msg = message as { type?: string; spanId?: string }
    if (msg.type === 'ready') {
      panel.webview.postMessage({ type: 'span', span, trace: findTraceForSpan(span.spanId) })
      return
    }
    if (msg.type === 'revealSource' && typeof msg.spanId === 'string') {
      void revealSource({ spanId: msg.spanId })
      return
    }
    if (msg.type === 'copySpanId' && typeof msg.spanId === 'string') {
      void copySpanId(msg.spanId)
      return
    }
  })
  panel.onDidDispose(() => {
    spanPanels.delete(span.spanId)
  })

  spanPanels.set(span.spanId, panel)
}

function findTraceForSpan(spanId: string): TraceData | undefined {
  return traces.find((trace) => trace.spans.some((s) => s.spanId === spanId))
}

function renderWebviewHtml(webview: vscode.Webview, scriptUri: vscode.Uri): string {
  const nonce = generateNonce()
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Autotel Span Detail</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; }
    #root { padding: 16px; }
    main { display: flex; flex-direction: column; gap: 24px; }
    main.empty { color: var(--vscode-descriptionForeground); }
    h1 { margin: 0 0 6px 0; font-size: 1.4rem; }
    h2 { margin: 0 0 8px 0; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); }
    section { display: flex; flex-direction: column; gap: 6px; }
    .subtitle { display: flex; gap: 12px; align-items: center; margin: 0; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .badge-error { background: var(--vscode-errorForeground); color: var(--vscode-editor-background); }
    .badge-ok { background: var(--vscode-testing-iconPassed, #4caf50); color: var(--vscode-editor-background); }
    .badge-unset { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .kind, .duration { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
    dt { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
    dd { margin: 0; word-break: break-all; display: flex; gap: 8px; align-items: center; }
    code { background: var(--vscode-textBlockQuote-background); padding: 1px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 0.85rem; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 0.8rem; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: 0.8rem; }
    pre { background: var(--vscode-textBlockQuote-background); padding: 8px; border-radius: 3px; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: 0.8rem; margin: 4px 0; }
    .status-message { color: var(--vscode-errorForeground); }
    .muted { color: var(--vscode-descriptionForeground); }
    ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

let devtoolsPanel: vscode.WebviewPanel | undefined

function getDevtoolsUrl(): string {
  const config = vscode.workspace.getConfiguration('autotel')
  const explicit = config.get<string | null>('devtools.url', null)
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const { host, port } = getReceiverConfig()
  const safeHost = host === '0.0.0.0' ? '127.0.0.1' : host
  return `http://${safeHost}:${port}`
}

async function openDevtools(): Promise<void> {
  if (devtoolsPanel) {
    devtoolsPanel.reveal(vscode.ViewColumn.Beside)
    return
  }

  const targetUrl = getDevtoolsUrl()
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    void vscode.window.showErrorMessage(
      `Invalid autotel.devtools.url: "${targetUrl}". Expected http://host:port.`,
    )
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    void vscode.window.showErrorMessage(
      `Unsupported devtools url protocol: ${parsed.protocol}. Use http or https.`,
    )
    return
  }

  const panel = vscode.window.createWebviewPanel(
    'autotel.devtools',
    'Autotel Devtools',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  )
  devtoolsPanel = panel
  panel.onDidDispose(() => {
    devtoolsPanel = undefined
  })

  try {
    const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(targetUrl))
    const iframeUrl = externalUri.toString(true)
    const allowedFrameOrigin = `${new URL(iframeUrl).protocol}//${new URL(iframeUrl).host}`
    const nonce = generateNonce()
    const csp = [
      `default-src 'none'`,
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      `frame-src ${allowedFrameOrigin}`,
    ].join('; ')

    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Autotel Devtools</title>
  <style nonce="${nonce}">
    html, body { height: 100%; margin: 0; padding: 0; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    .toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; }
    .toolbar a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    .toolbar a:hover { text-decoration: underline; }
    iframe { display: block; width: 100%; height: calc(100% - 32px); border: 0; background: white; }
  </style>
</head>
<body>
  <div class="toolbar">
    <span>Autotel Devtools</span>
    <span style="color: var(--vscode-descriptionForeground)">·</span>
    <a href="${iframeUrl}" target="_blank" rel="noreferrer">Open in browser</a>
    <span style="color: var(--vscode-descriptionForeground); margin-left: auto">${iframeUrl}</span>
  </div>
  <iframe src="${iframeUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerpolicy="no-referrer"></iframe>
</body>
</html>`
  } catch (error) {
    outputChannel?.appendLine(
      `Failed to open devtools UI: ${error instanceof Error ? error.message : String(error)}`,
    )
    panel.dispose()
    void vscode.window.showErrorMessage(
      `Failed to open Autotel Devtools at ${targetUrl}.`,
    )
  }
}

class ServicesProvider implements vscode.TreeDataProvider<ServiceNode> {
  private readonly emitter = new vscode.EventEmitter<ServiceNode | undefined>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh(): void {
    this.emitter.fire(undefined)
  }

  getTreeItem(element: ServiceNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None)
    item.description = `${element.spanCount} spans · ${element.errorCount} errors`
    item.iconPath = new vscode.ThemeIcon('server')
    item.tooltip = `${element.label}\nSpans: ${element.spanCount}\nErrors: ${element.errorCount}`
    return item
  }

  getChildren(): ServiceNode[] {
    const counts = new Map<string, ServiceNode>()
    for (const trace of traces) {
      const key = trace.service || 'unknown'
      const existing = counts.get(key) ?? { label: key, spanCount: 0, errorCount: 0 }
      existing.spanCount += trace.spans.length
      if (trace.status === 'ERROR') existing.errorCount += 1
      counts.set(key, existing)
    }
    return [...counts.values()].sort((a, b) => b.spanCount - a.spanCount)
  }
}

interface ServiceNode {
  label: string
  spanCount: number
  errorCount: number
}

class TracesProvider implements vscode.TreeDataProvider<TraceNode | SpanNode> {
  private readonly emitter = new vscode.EventEmitter<TraceNode | SpanNode | undefined>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh(): void {
    this.emitter.fire(undefined)
  }

  getTreeItem(element: TraceNode | SpanNode): vscode.TreeItem {
    if (element.kind === 'trace') {
      const item = new vscode.TreeItem(
        element.trace.rootSpan?.name ?? element.trace.traceId,
        vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.description = `${element.trace.service} · ${formatDuration(element.trace.duration)}`
      item.iconPath = new vscode.ThemeIcon(
        element.trace.status === 'ERROR' ? 'error' : 'list-tree',
      )
      item.tooltip = `Trace ${element.trace.traceId}\n${element.trace.spans.length} spans · ${formatDuration(element.trace.duration)}`
      item.contextValue = 'autotel.trace'
      return item
    }
    const item = new vscode.TreeItem(element.span.name, vscode.TreeItemCollapsibleState.None)
    item.description = `${element.span.kind.toLowerCase()} · ${formatDuration(element.span.duration)}`
    item.iconPath = new vscode.ThemeIcon(
      element.span.status.code === 'ERROR' ? 'error' : 'circle-filled',
    )
    item.tooltip = `${element.span.name}\nspanId: ${element.span.spanId}\nstatus: ${element.span.status.code}`
    item.contextValue = 'autotel.span'
    item.command = {
      command: 'autotel.openSpanDetail',
      title: 'Open Span Detail',
      arguments: [{ spanId: element.span.spanId }],
    }
    return item
  }

  getChildren(element?: TraceNode | SpanNode): (TraceNode | SpanNode)[] {
    if (!element) {
      return traces
        .slice()
        .reverse()
        .map((trace) => ({ kind: 'trace', trace }))
    }
    if (element.kind === 'trace') {
      return element.trace.spans
        .slice()
        .sort((a, b) => a.startTime - b.startTime)
        .map((span) => ({ kind: 'span', span }))
    }
    return []
  }
}

type TraceNode = { kind: 'trace'; trace: TraceData }
type SpanNode = { kind: 'span'; span: Span }

class LogsProvider implements vscode.TreeDataProvider<LogData> {
  private readonly emitter = new vscode.EventEmitter<LogData | undefined>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh(): void {
    this.emitter.fire(undefined)
  }

  getTreeItem(log: LogData): vscode.TreeItem {
    const summary = typeof log.body === 'string' ? log.body : JSON.stringify(log.body)
    const truncated = summary.length > 120 ? `${summary.slice(0, 117)}…` : summary
    const item = new vscode.TreeItem(truncated, vscode.TreeItemCollapsibleState.None)
    item.description = `${log.severityText ?? ''} ${log.resourceName ?? ''}`.trim()
    item.iconPath = new vscode.ThemeIcon(
      isErrorSeverity(log.severityNumber) ? 'error' : 'output',
    )
    item.tooltip = summary
    return item
  }

  getChildren(): LogData[] {
    return logs.slice().reverse()
  }
}

class ErrorsProvider implements vscode.TreeDataProvider<ErrorGroup> {
  private readonly emitter = new vscode.EventEmitter<ErrorGroup | undefined>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh(): void {
    this.emitter.fire(undefined)
  }

  getTreeItem(group: ErrorGroup): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${group.type}: ${group.message}`,
      vscode.TreeItemCollapsibleState.None,
    )
    item.description = `×${group.count}${group.service ? ` · ${group.service}` : ''}`
    item.iconPath = new vscode.ThemeIcon('error')
    item.tooltip = group.stackTrace ?? group.message
    return item
  }

  getChildren(): ErrorGroup[] {
    return errorAggregator.getErrorGroupsByFrequency()
  }
}

function isErrorSeverity(level: number | undefined): boolean {
  if (typeof level !== 'number') return false
  return level >= 17
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function activate(context: vscode.ExtensionContext): void {
  extensionUri = context.extensionUri
  outputChannel = vscode.window.createOutputChannel('Autotel')
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  statusBarItem.command = 'autotel.start'
  statusBarItem.show()
  context.subscriptions.push(outputChannel, statusBarItem)
  extensionDisposables.push(outputChannel, statusBarItem)

  registerCommands(context)
  updateStatusBar('stopped')

  servicesProvider = new ServicesProvider()
  tracesProvider = new TracesProvider()
  logsProvider = new LogsProvider()
  errorsProvider = new ErrorsProvider()
  const servicesView = vscode.window.registerTreeDataProvider('autotel.services', servicesProvider)
  const tracesView = vscode.window.registerTreeDataProvider('autotel.traces', tracesProvider)
  const logsView = vscode.window.registerTreeDataProvider('autotel.logs', logsProvider)
  const errorsView = vscode.window.registerTreeDataProvider('autotel.errors', errorsProvider)
  context.subscriptions.push(servicesView, tracesView, logsView, errorsView)
  extensionDisposables.push(servicesView, tracesView, logsView, errorsView)

  const configSub = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('autotel.receiver.enabled') &&
        !event.affectsConfiguration('autotel.receiver.port') &&
        !event.affectsConfiguration('autotel.receiver.host')) {
      return
    }
    const { enabled } = getReceiverConfig()
    if (!enabled) {
      void stopReceiver()
      return
    }
    void stopReceiver().then(() => startReceiver())
  })
  context.subscriptions.push(configSub)
  extensionDisposables.push(configSub)

  if (getReceiverConfig().enabled) {
    void startReceiver()
  }
}

export function deactivate(): void {
  if (receiverServer) {
    receiverServer.close()
    receiverServer = undefined
  }
  for (const panel of spanPanels.values()) {
    panel.dispose()
  }
  spanPanels.clear()
  if (devtoolsPanel) {
    devtoolsPanel.dispose()
    devtoolsPanel = undefined
  }
  while (extensionDisposables.length > 0) {
    extensionDisposables.pop()?.dispose()
  }
  errorAggregator = new ErrorAggregator()
  traces = []
  logs = []
  spansById = new Map()
  droppedTraceCount = 0
  droppedLogCount = 0
}
