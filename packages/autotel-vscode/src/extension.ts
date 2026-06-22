import * as vscode from 'vscode'
import { createServer, type Server } from 'node:http'
import { relative, resolve, sep } from 'node:path'
import type {
  DevtoolsData,
  ErrorGroup,
  LogData,
  TraceData,
} from 'autotel-devtools/server'
import { AutotelCodeLensProvider, AutotelHoverProvider } from './codelens'
import { getAdapter, listAdapters, credentialKey } from './backends'

// Value imports via require (CJS interop). The receiver is now a full
// DevtoolsServer + attachDevtoolsRoutes, so it serves the devtools widget UI
// (/, /widget.js, /ws) from this same port — `openDevtools` embeds it directly.
const {
  ErrorAggregator,
  DevtoolsServer,
  attachDevtoolsRoutes,
} = require('autotel-devtools/server') as typeof import('autotel-devtools/server')

type Span = TraceData['spans'][number]
type DevtoolsServerInstance = InstanceType<typeof DevtoolsServer>

const COMMANDS = [
  'autotel.start',
  'autotel.stop',
  'autotel.setPort',
  'autotel.clear',
  'autotel.revealSource',
  'autotel.copySpanId',
  'autotel.openSpanDetail',
  'autotel.openDevtools',
  'autotel.queryBackend',
  'autotel.setBackendCredential',
  'autotel.clearBackendCredential',
  'autotel.openMetrics',
  'autotel.openServiceMap',
] as const

const extensionDisposables: vscode.Disposable[] = []
let outputChannel: vscode.OutputChannel | undefined
let statusBarItem: vscode.StatusBarItem | undefined
let receiverServer: Server | undefined
let devtools: DevtoolsServerInstance | undefined
let traces: TraceData[] = []
let logs: LogData[] = []
let spansById = new Map<string, Span>()
let totalTracesSeen = 0
let totalLogsSeen = 0
let droppedTraceCount = 0
let droppedLogCount = 0
let errorAggregator = new ErrorAggregator()

type ReceiverState = 'running' | 'stopped' | 'port-busy'
type ReceiverStartGuard = 'ok' | 'blocked'

let servicesProvider: ServicesProvider | undefined
let tracesProvider: TracesProvider | undefined
let logsProvider: LogsProvider | undefined
let errorsProvider: ErrorsProvider | undefined
let codeLensProvider: AutotelCodeLensProvider | undefined

let extensionSecrets: vscode.SecretStorage | undefined

function refreshTreeViews(): void {
  servicesProvider?.refresh()
  tracesProvider?.refresh()
  logsProvider?.refresh()
  errorsProvider?.refresh()
  codeLensProvider?.refresh()
  refreshMetricsPanel()
  refreshServiceMapPanel()
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
        case 'autotel.queryBackend':
          void queryRemoteBackend()
          return
        case 'autotel.setBackendCredential':
          void setBackendCredential()
          return
        case 'autotel.clearBackendCredential':
          void clearBackendCredential()
          return
        case 'autotel.openMetrics':
          openMetricsPanel()
          return
        case 'autotel.openServiceMap':
          openServiceMapPanel()
          return
      }
    })
    context.subscriptions.push(disposable)
    extensionDisposables.push(disposable)
  }
}

function getReceiverConfig(): { host: string; port: number; maxSpans: number; maxLogs: number } {
  const config = vscode.workspace.getConfiguration('autotel')
  return {
    host: config.get<string>('receiver.host', '127.0.0.1'),
    port: config.get<number>('receiver.port', 4318),
    maxSpans: config.get<number>('buffer.maxSpans', 10000),
    maxLogs: config.get<number>('buffer.maxLogs', 10000),
  }
}

// When the receiver should boot. Default is "onAutotelProject": stay dormant
// (no port bound) unless the workspace actually depends on autotel — the user
// starts it manually elsewhere. "off" never auto-starts; "always" restores the
// pre-1.1 behaviour of binding in every window on activation.
type AutoStartMode = 'off' | 'onAutotelProject' | 'always'

function getAutoStartMode(): AutoStartMode {
  const mode = vscode.workspace
    .getConfiguration('autotel')
    .get<AutoStartMode>('receiver.autoStart', 'onAutotelProject')
  return mode === 'off' || mode === 'always' ? mode : 'onAutotelProject'
}

async function packageDependsOnAutotel(uri: vscode.Uri): Promise<boolean> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri)
    const pkg = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      const deps = pkg[field]
      if (deps && typeof deps === 'object') {
        const names = Object.keys(deps as Record<string, string>)
        if (names.some((name) => name === 'autotel' || name.startsWith('autotel-'))) {
          return true
        }
      }
    }
  } catch {
    // Missing or invalid package.json — skip it.
  }
  return false
}

// Detection mirrors Wallaby's "Smart Start": only wake up where it's wanted.
// Scans every workspace package.json (skipping node_modules) for an autotel
// dependency. No result cap — in a large monorepo the autotel-dependent package
// can be anywhere in the list, and capping would make auto-start
// nondeterministic. Reads are batched with early exit so the common case stays
// fast and we never read more files than needed.
async function workspaceUsesAutotel(): Promise<boolean> {
  const pkgFiles = await vscode.workspace.findFiles(
    '**/package.json',
    '**/node_modules/**',
  )
  const BATCH_SIZE = 24
  for (let i = 0; i < pkgFiles.length; i += BATCH_SIZE) {
    const batch = pkgFiles.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(packageDependsOnAutotel))
    if (results.some(Boolean)) return true
  }
  return false
}

async function maybeAutoStart(): Promise<void> {
  const mode = getAutoStartMode()
  if (mode === 'off') {
    outputChannel?.appendLine(
      'Receiver auto-start disabled (autotel.receiver.autoStart = "off"). Run "Autotel: Start Receiver" or click the status bar item to start.',
    )
    return
  }
  if (mode === 'onAutotelProject' && !(await workspaceUsesAutotel())) {
    outputChannel?.appendLine(
      'No autotel dependency found in the workspace; receiver left stopped. Run "Autotel: Start Receiver" to start manually.',
    )
    return
  }
  await startReceiver(true)
}

function updateStatusBar(state: ReceiverState): void {
  if (!statusBarItem) return
  const { host, port } = getReceiverConfig()
  const spanCount = traces.length
  if (state === 'running') {
    // Show the bound port so the receiver endpoint is always visible at a glance.
    statusBarItem.text = `$(radio-tower) Autotel :${port} (${spanCount})`
    statusBarItem.tooltip = droppedTraceCount || droppedLogCount
      ? `Receiver running on ${host}:${port}. Spans: ${traces.length}, logs: ${logs.length}, dropped spans: ${droppedTraceCount}, dropped logs: ${droppedLogCount}. Click to stop.`
      : `Receiver running on ${host}:${port}. Spans: ${traces.length}, logs: ${logs.length}. Click to stop.`
    statusBarItem.command = 'autotel.stop'
    return
  }
  if (state === 'port-busy') {
    statusBarItem.text = `$(warning) Autotel :${port} busy`
    statusBarItem.tooltip = `Receiver could not bind to ${host}:${port} — the port is already in use. Click to retry, or run "Autotel: Set Receiver Port".`
    statusBarItem.command = 'autotel.start'
    return
  }
  statusBarItem.text = `$(circle-slash) Autotel off :${port}`
  statusBarItem.tooltip = `Receiver stopped (would bind ${host}:${port}). Click to start.`
  statusBarItem.command = 'autotel.start'
}


interface MetricsSummary {
  service: string
  count: number
  errorCount: number
  p50Ms: number
  p95Ms: number
  topOperations: Array<{ name: string; count: number; p95Ms: number; errorPct: number }>
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function summarizeMetrics(currentTraces: readonly TraceData[]): MetricsSummary[] {
  const byService = new Map<string, { durations: number[]; errors: number; ops: Map<string, { d: number[]; errs: number }> }>()
  for (const trace of currentTraces) {
    for (const span of trace.spans) {
      const svc = trace.service ?? 'unknown'
      const ms = span.duration / 1_000_000
      const errored = span.status?.code === 'ERROR'
      let entry = byService.get(svc)
      if (!entry) {
        entry = { durations: [], errors: 0, ops: new Map() }
        byService.set(svc, entry)
      }
      entry.durations.push(ms)
      if (errored) entry.errors += 1
      let opEntry = entry.ops.get(span.name)
      if (!opEntry) {
        opEntry = { d: [], errs: 0 }
        entry.ops.set(span.name, opEntry)
      }
      opEntry.d.push(ms)
      if (errored) opEntry.errs += 1
    }
  }
  const out: MetricsSummary[] = []
  for (const [service, e] of byService) {
    const sorted = [...e.durations].sort((a, b) => a - b)
    const topOps = [...e.ops.entries()]
      .map(([name, op]) => {
        const opSorted = [...op.d].sort((a, b) => a - b)
        return {
          name,
          count: op.d.length,
          p95Ms: quantile(opSorted, 0.95),
          errorPct: (op.errs / op.d.length) * 100,
        }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
    out.push({
      service,
      count: e.durations.length,
      errorCount: e.errors,
      p50Ms: quantile(sorted, 0.5),
      p95Ms: quantile(sorted, 0.95),
      topOperations: topOps,
    })
  }
  return out.sort((a, b) => b.count - a.count)
}

let metricsPanel: vscode.WebviewPanel | undefined

function openMetricsPanel(): void {
  if (metricsPanel) {
    metricsPanel.reveal(vscode.ViewColumn.Beside)
    metricsPanel.webview.html = renderMetricsHtml(summarizeMetrics(traces))
    return
  }
  const panel = vscode.window.createWebviewPanel(
    'autotel.metrics',
    'Autotel Metrics',
    vscode.ViewColumn.Beside,
    { enableScripts: false, retainContextWhenHidden: true },
  )
  metricsPanel = panel
  panel.onDidDispose(() => {
    metricsPanel = undefined
  })
  panel.webview.html = renderMetricsHtml(summarizeMetrics(traces))
}

function refreshMetricsPanel(): void {
  if (!metricsPanel) return
  metricsPanel.webview.html = renderMetricsHtml(summarizeMetrics(traces))
}

interface ServiceMapEdge {
  from: string
  to: string
  callCount: number
  errorCount: number
  p95Ms: number
}

interface ServiceMapData {
  services: string[]
  edges: ServiceMapEdge[]
}

function buildServiceMap(currentTraces: readonly TraceData[]): ServiceMapData {
  const services = new Set<string>()
  const edgeKey = (from: string, to: string): string => `${from} ${to}`
  const edges = new Map<string, { calls: number; errors: number; durations: number[] }>()
  for (const trace of currentTraces) {
    const spanService = new Map<string, string>()
    for (const span of trace.spans) {
      const svc = String(span.attributes?.['service.name'] ?? trace.service ?? 'unknown')
      spanService.set(span.spanId, svc)
      services.add(svc)
    }
    for (const span of trace.spans) {
      if (!span.parentSpanId) continue
      const parentSvc = spanService.get(span.parentSpanId)
      const ownSvc = spanService.get(span.spanId)
      if (!parentSvc || !ownSvc || parentSvc === ownSvc) continue
      const key = edgeKey(parentSvc, ownSvc)
      let edge = edges.get(key)
      if (!edge) {
        edge = { calls: 0, errors: 0, durations: [] }
        edges.set(key, edge)
      }
      edge.calls += 1
      if (span.status?.code === 'ERROR') edge.errors += 1
      edge.durations.push(span.duration / 1_000_000)
    }
  }
  const edgeList: ServiceMapEdge[] = [...edges.entries()].map(([k, v]) => {
    const [from, to] = k.split(' ')
    const sorted = [...v.durations].sort((a, b) => a - b)
    const p95 = quantile(sorted, 0.95)
    return { from, to, callCount: v.calls, errorCount: v.errors, p95Ms: p95 }
  })
  edgeList.sort((a, b) => b.callCount - a.callCount)
  return { services: [...services].sort(), edges: edgeList }
}

let serviceMapPanel: vscode.WebviewPanel | undefined

function openServiceMapPanel(): void {
  if (serviceMapPanel) {
    serviceMapPanel.reveal(vscode.ViewColumn.Beside)
    serviceMapPanel.webview.html = renderServiceMapHtml(buildServiceMap(traces))
    return
  }
  const panel = vscode.window.createWebviewPanel(
    'autotel.serviceMap',
    'Autotel Service Map',
    vscode.ViewColumn.Beside,
    { enableScripts: false, retainContextWhenHidden: true },
  )
  serviceMapPanel = panel
  panel.onDidDispose(() => {
    serviceMapPanel = undefined
  })
  panel.webview.html = renderServiceMapHtml(buildServiceMap(traces))
}

function refreshServiceMapPanel(): void {
  if (!serviceMapPanel) return
  serviceMapPanel.webview.html = renderServiceMapHtml(buildServiceMap(traces))
}

function renderServiceMapHtml(data: ServiceMapData): string {
  const escape = (s: string): string =>
    s.replace(/[&<>"']/g, (ch) =>
      ch === '&' ? '&amp;' :
      ch === '<' ? '&lt;' :
      ch === '>' ? '&gt;' :
      ch === '"' ? '&quot;' : '&#39;',
    )
  const fmt = (ms: number): string =>
    ms < 1 ? `${(ms * 1000).toFixed(0)}μs` : ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`

  // Build an inline SVG layout: services arranged in a vertical list, edges
  // drawn as curves between them with thickness ∝ call count. Keeps the
  // webview script-free (no graph library, no CSP relaxation needed).
  const ROW_HEIGHT = 36
  const LEFT_X = 180
  const RIGHT_X = 480
  const svgHeight = Math.max(120, data.services.length * ROW_HEIGHT + 40)
  const yFor = (svc: string): number => 20 + data.services.indexOf(svc) * ROW_HEIGHT + ROW_HEIGHT / 2

  const svcRows = data.services.map((svc) => {
    const y = yFor(svc)
    return `<text x="20" y="${y}" dy="0.35em" class="svc">${escape(svc)}</text>`
  }).join('')

  const edgePaths = data.edges.map((edge) => {
    const x1 = LEFT_X
    const x2 = RIGHT_X - 20
    const y1 = yFor(edge.from)
    const y2 = yFor(edge.to)
    const mx = (x1 + x2) / 2
    const stroke = Math.max(1, Math.min(8, Math.log2(edge.callCount + 1) * 1.5))
    const errored = edge.errorCount > 0
    return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="edge ${errored ? 'edge-err' : ''}" stroke-width="${stroke}" />`
  }).join('')

  const edgeRows = data.edges.length === 0
    ? '<tr><td colspan="4" class="muted">No cross-service edges detected. Service map populates as soon as a parent span on one service calls a child on another.</td></tr>'
    : data.edges.map((e) => `
        <tr>
          <td><code>${escape(e.from)}</code> → <code>${escape(e.to)}</code></td>
          <td class="num">${e.callCount}</td>
          <td class="num">${fmt(e.p95Ms)}</td>
          <td class="num ${e.errorCount > 0 ? 'err' : ''}">${e.errorCount > 0 ? `${((e.errorCount / e.callCount) * 100).toFixed(0)}%` : '—'}</td>
        </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
  h2, h3 { margin-top: 0; }
  .svc { fill: var(--vscode-foreground); font-size: 12px; font-family: var(--vscode-editor-font-family); }
  .edge { stroke: var(--vscode-charts-blue, #2563eb); fill: none; opacity: 0.65; }
  .edge-err { stroke: var(--vscode-errorForeground); opacity: 0.9; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: 0.8rem; }
  .num { text-align: right; }
  .err { color: var(--vscode-errorForeground); }
  .muted { color: var(--vscode-descriptionForeground); font-style: italic; padding: 12px; text-align: center; }
  code { background: var(--vscode-textBlockQuote-background); padding: 1px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 0.85rem; }
  .map { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 4px; background: var(--vscode-editor-inactiveSelectionBackground, transparent); }
</style>
</head>
<body>
<h2>Service Map</h2>
<p>${data.services.length} service${data.services.length === 1 ? '' : 's'} · ${data.edges.length} cross-service edge${data.edges.length === 1 ? '' : 's'}</p>
${data.services.length > 0 ? `<div class="map"><svg viewBox="0 0 ${RIGHT_X} ${svgHeight}" width="100%" height="${svgHeight}">${edgePaths}${svcRows}</svg></div>` : ''}
<h3>Edge details</h3>
<table>
  <thead><tr><th>Edge</th><th class="num">Calls</th><th class="num">p95</th><th class="num">Errors</th></tr></thead>
  <tbody>${edgeRows}</tbody>
</table>
</body>
</html>`
}

function renderMetricsHtml(rows: MetricsSummary[]): string {
  const escape = (s: string): string =>
    s.replace(/[&<>"']/g, (ch) =>
      ch === '&' ? '&amp;' :
      ch === '<' ? '&lt;' :
      ch === '>' ? '&gt;' :
      ch === '"' ? '&quot;' : '&#39;',
    )
  const fmt = (ms: number): string =>
    ms < 1 ? `${(ms * 1000).toFixed(0)}μs` : ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`
  const body = rows.length === 0
    ? '<p class="muted">No traces buffered yet.</p>'
    : rows.map((r) => `
        <section>
          <h3>${escape(r.service)}</h3>
          <p class="meta">
            <strong>${r.count}</strong> spans ·
            p50 <strong>${fmt(r.p50Ms)}</strong> ·
            p95 <strong>${fmt(r.p95Ms)}</strong> ·
            ${r.errorCount > 0 ? `<span class="err">${((r.errorCount / r.count) * 100).toFixed(1)}% errors</span>` : '<span class="ok">no errors</span>'}
          </p>
          <table>
            <thead><tr><th>Operation</th><th class="num">Count</th><th class="num">p95</th><th class="num">Errors</th></tr></thead>
            <tbody>
              ${r.topOperations.map((op) => `
                <tr>
                  <td><code>${escape(op.name)}</code></td>
                  <td class="num">${op.count}</td>
                  <td class="num">${fmt(op.p95Ms)}</td>
                  <td class="num ${op.errorPct > 0 ? 'err' : ''}">${op.errorPct > 0 ? `${op.errorPct.toFixed(0)}%` : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </section>`).join('')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
  h2 { margin-top: 0; }
  section { margin: 0 0 28px; border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
  h3 { margin: 0 0 6px; }
  .meta { color: var(--vscode-descriptionForeground); margin: 4px 0 12px; }
  .err { color: var(--vscode-errorForeground); }
  .ok { color: var(--vscode-testing-iconPassed, #4caf50); }
  .muted { color: var(--vscode-descriptionForeground); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: 0.8rem; }
  .num { text-align: right; }
  code { background: var(--vscode-textBlockQuote-background); padding: 1px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 0.85rem; }
</style>
</head>
<body>
<h2>Service Metrics</h2>
${body}
</body>
</html>`
}

async function pickAdapterId(): Promise<string | undefined> {
  const adapters = listAdapters()
  if (adapters.length === 0) return undefined
  const choice = await vscode.window.showQuickPick(
    adapters.map((a) => ({ label: a.label, id: a.id })),
    { placeHolder: 'Which backend?' },
  )
  return choice?.id
}

async function setBackendCredential(): Promise<void> {
  if (!extensionSecrets) {
    void vscode.window.showErrorMessage('Extension not fully activated; secrets unavailable.')
    return
  }
  const adapterId = await pickAdapterId()
  if (!adapterId) return
  const token = await vscode.window.showInputBox({
    prompt: `API key / bearer token for ${adapterId}`,
    password: true,
    ignoreFocusOut: true,
  })
  if (!token) return
  await extensionSecrets.store(credentialKey(adapterId), token)
  void vscode.window.showInformationMessage(`Saved ${adapterId} credential to VSCode SecretStorage.`)
}

async function clearBackendCredential(): Promise<void> {
  if (!extensionSecrets) return
  const adapterId = await pickAdapterId()
  if (!adapterId) return
  await extensionSecrets.delete(credentialKey(adapterId))
  void vscode.window.showInformationMessage(`Cleared ${adapterId} credential.`)
}

async function queryRemoteBackend(): Promise<void> {
  const config = vscode.workspace.getConfiguration('autotel')
  const type = config.get<string>('backend.type', 'none')
  if (type === 'none' || type === '') {
    void vscode.window.showWarningMessage(
      'No backend configured. Set autotel.backend.type to "jaeger" (or another supported backend) and autotel.backend.url first.',
    )
    return
  }
  const adapter = getAdapter(type)
  if (!adapter) {
    void vscode.window.showErrorMessage(
      `Unknown autotel.backend.type "${type}". Available: ${listAdapters()
        .map((a) => a.id)
        .join(', ')}.`,
    )
    return
  }
  const baseUrl = config.get<string | null>('backend.url', null)
  if (!baseUrl) {
    void vscode.window.showErrorMessage('autotel.backend.url is required to query the backend.')
    return
  }
  const dataset = config.get<string | null>('backend.dataset', null) ?? undefined
  const aborter = new AbortController()
  const ctx = {
    baseUrl,
    dataset,
    secrets: {
      get: (k: string): Promise<string | undefined> =>
        Promise.resolve(extensionSecrets?.get(k)),
    },
    abortSignal: aborter.signal,
    timeoutMs: 30_000,
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Querying ${adapter.label}…`,
      cancellable: true,
    },
    async (_progress, token) => {
      token.onCancellationRequested(() => aborter.abort())
      try {
        const services = await adapter.listServices(ctx)
        const service = await vscode.window.showQuickPick(services, {
          placeHolder: 'Select a service',
        })
        if (!service) return
        const remoteTraces = await adapter.searchTraces(ctx, { service, limit: 50 })
        if (remoteTraces.length === 0) {
          void vscode.window.showInformationMessage(`No traces for ${service}.`)
          return
        }
        // Merge into the buffer so every view (tree, span detail, GenAI
        // render, CodeLens) lights up. When the receiver is running, route
        // through DevtoolsServer so the embedded widget also updates; otherwise
        // merge straight into the read model.
        if (devtools) {
          devtools.addTraces(remoteTraces)
        } else {
          traces = [...traces, ...remoteTraces]
          for (const trace of remoteTraces) {
            errorAggregator.addErrorsFromTrace(trace)
          }
          rebuildSpanIndex()
          refreshTreeViews()
        }
        updateStatusBar('running')
        void vscode.window.showInformationMessage(
          `Pulled ${remoteTraces.length} trace${remoteTraces.length === 1 ? '' : 's'} from ${adapter.label}.`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        void vscode.window.showErrorMessage(`Backend query failed: ${msg}`)
      }
    },
  )
}

// The DevtoolsServer owns ingestion, limits, the buffer, error aggregation and
// the WS fan-out (and serves the widget UI). This runs on every ingest to keep
// the extension's read model — tree views, CodeLens, hover — in sync with it.
function onReceiverData(incremental: DevtoolsData): void {
  const data = devtools?.getCurrentData()
  if (!data) return

  totalTracesSeen += incremental.traces.length
  totalLogsSeen += incremental.logs.length
  droppedTraceCount = Math.max(0, totalTracesSeen - data.traces.length)
  droppedLogCount = Math.max(0, totalLogsSeen - data.logs.length)

  traces = data.traces
  logs = data.logs
  rebuildSpanIndex()
  for (const trace of incremental.traces) {
    errorAggregator.addErrorsFromTrace(trace)
  }
  updateStatusBar('running')
  refreshTreeViews()
}

function rebuildSpanIndex(): void {
  spansById = new Map(
    traces.flatMap((trace) =>
      trace.spans.map((span) => [span.spanId, span] as const),
    ),
  )
}

async function ensureReceiverHostAllowed(
  host: string,
  silent: boolean,
): Promise<ReceiverStartGuard> {
  if (host === '127.0.0.1' || host === 'localhost') return 'ok'
  // Never auto-bind a non-loopback host without explicit consent, and never nag
  // with a modal on every window open — block silently and leave a breadcrumb.
  if (silent) {
    outputChannel?.appendLine(
      `Receiver not auto-started: host ${host} is non-loopback. Run "Autotel: Start Receiver" to start it (you'll be asked to confirm).`,
    )
    updateStatusBar('stopped')
    return 'blocked'
  }
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

// `silent` suppresses user-facing popups — used for auto-start so opening a
// window in an autotel project where 4318 is already taken (e.g. a real
// collector) doesn't nag. Manual starts stay loud: you asked, so you're told.
async function startReceiver(silent = false): Promise<void> {
  if (receiverServer) {
    updateStatusBar('running')
    return
  }
  const { host, port, maxSpans, maxLogs } = getReceiverConfig()
  const guard = await ensureReceiverHostAllowed(host, silent)
  if (guard === 'blocked') return
  const server = createServer()
  // DevtoolsServer attaches its WebSocket (/ws) to this http server;
  // attachDevtoolsRoutes adds the OTLP ingest routes plus the widget UI
  // (/, /widget.js), so the same port both receives telemetry and serves the
  // embeddable devtools widget that `openDevtools` points at.
  devtools = new DevtoolsServer({
    server,
    verbose: false,
    maxTraceCount: maxSpans,
    maxLogCount: maxLogs,
    onData: onReceiverData,
  })
  attachDevtoolsRoutes(server, devtools)
  receiverServer = server

  await new Promise<void>((resolve) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      outputChannel?.appendLine(`Receiver failed to start: ${error.message}`)
      if (error.code === 'EADDRINUSE') {
        updateStatusBar('port-busy')
        if (!silent) {
          void vscode.window.showWarningMessage(
            `Autotel receiver could not start on ${host}:${port}. Port is already in use.`,
          )
        }
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
  const dt = devtools
  devtools = undefined
  // DevtoolsServer.close() closes the shared http server too, so prefer it and
  // only fall back to closing the raw server directly.
  if (dt) {
    await dt.close()
  } else {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  outputChannel?.appendLine('Receiver stopped')
  updateStatusBar('stopped')
}

function clearBufferedData(): void {
  devtools?.clearData()
  traces = []
  logs = []
  spansById = new Map()
  totalTracesSeen = 0
  totalLogsSeen = 0
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

// Span clicks (tree node, CodeLens) now open the embedded devtools widget
// focused on the span via a URL-hash deep-link, instead of a separate
// single-span webview. One UI, far richer (waterfall, Flow, GenAI).
async function openSpanDetail(arg?: unknown): Promise<void> {
  const span = resolveSpanFromArg(arg)
  if (!span) {
    void vscode.window.showInformationMessage('Span not found in buffer.')
    return
  }
  const trace = traces.find((t) => t.spans.some((s) => s.spanId === span.spanId))
  if (!trace) {
    void vscode.window.showInformationMessage('Trace for span not found in buffer.')
    return
  }
  await openDevtools({ traceId: trace.traceId, spanId: span.spanId })
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

interface DevtoolsFocus {
  traceId: string
  spanId?: string
}

async function openDevtools(focus?: DevtoolsFocus): Promise<void> {
  if (devtoolsPanel) {
    devtoolsPanel.reveal(vscode.ViewColumn.Beside)
    // Re-point the embedded widget at the requested span (reloads the iframe).
    if (focus) await applyDevtoolsContent(devtoolsPanel, focus)
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

  await applyDevtoolsContent(panel, focus)
}

// Builds the webview HTML that frames the embedded devtools widget. `focus`
// adds a `#trace=…&span=…` hash the widget reads to open on that span.
async function applyDevtoolsContent(
  panel: vscode.WebviewPanel,
  focus?: DevtoolsFocus,
): Promise<void> {
  const targetUrl = getDevtoolsUrl()
  try {
    const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(targetUrl))
    let iframeUrl = externalUri.toString(true)
    if (focus) {
      const hash = new URLSearchParams({ trace: focus.traceId })
      if (focus.spanId) hash.set('span', focus.spanId)
      iframeUrl += `#${hash.toString()}`
    }
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
  extensionSecrets = context.secrets
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

  // Tier 2 — editor-integrated DX: CodeLens + hover providers attach to every
  // open document and surface live telemetry next to the source. Both read
  // from the same `traces` array refreshed by the OTLP receiver.
  codeLensProvider = new AutotelCodeLensProvider(() => traces)
  const hoverProvider = new AutotelHoverProvider(() => traces)
  const selector: vscode.DocumentSelector = [
    { scheme: 'file' },
    { language: 'typescript' },
    { language: 'typescriptreact' },
    { language: 'javascript' },
    { language: 'javascriptreact' },
    { language: 'python' },
    { language: 'go' },
    { language: 'rust' },
    { language: 'java' },
  ]
  const codeLensSub = vscode.languages.registerCodeLensProvider(selector, codeLensProvider)
  const hoverSub = vscode.languages.registerHoverProvider(selector, hoverProvider)
  context.subscriptions.push(codeLensSub, hoverSub)
  extensionDisposables.push(codeLensSub, hoverSub)

  const configSub = vscode.workspace.onDidChangeConfiguration((event) => {
    // autoStart only governs activation, so don't disturb the current session —
    // just refresh the status bar in case the displayed state should change.
    if (event.affectsConfiguration('autotel.receiver.autoStart')) {
      updateStatusBar(receiverServer ? 'running' : 'stopped')
    }
    // Host/port changes rebind a running receiver; while stopped, just reflect
    // the new port in the status bar so the displayed endpoint stays accurate.
    if (event.affectsConfiguration('autotel.receiver.port') ||
        event.affectsConfiguration('autotel.receiver.host')) {
      if (receiverServer) {
        void stopReceiver().then(() => startReceiver())
      } else {
        updateStatusBar('stopped')
      }
    }
  })
  context.subscriptions.push(configSub)
  extensionDisposables.push(configSub)

  void maybeAutoStart()
}

export function deactivate(): void {
  if (devtools) {
    void devtools.close()
    devtools = undefined
    receiverServer = undefined
  } else if (receiverServer) {
    receiverServer.close()
    receiverServer = undefined
  }
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
  totalTracesSeen = 0
  totalLogsSeen = 0
  droppedTraceCount = 0
  droppedLogCount = 0
}
