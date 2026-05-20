import * as vscode from 'vscode'
import type { TraceData } from 'autotel-devtools/server'

interface FunctionStats {
  filepath: string
  lineno: number
  functionName?: string
  count: number
  errorCount: number
  durations: number[]
  spanIds: string[]
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function fmtDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// Walks every span in `traces`, keys by `code.filepath`+`code.lineno` (the
// OTel semconv source-location attrs), and returns aggregate stats per
// function. Used by both the CodeLens provider and the hover provider.
export function aggregateBySource(traces: readonly TraceData[]): Map<string, FunctionStats> {
  const byKey = new Map<string, FunctionStats>()
  for (const trace of traces) {
    for (const span of trace.spans) {
      const attrs = span.attributes ?? {}
      const filepath = attrs['code.filepath']
      const lineno = attrs['code.lineno']
      if (typeof filepath !== 'string' || typeof lineno !== 'number') continue
      const key = `${filepath}:${lineno}`
      const existing = byKey.get(key)
      const errored = span.status?.code === 'ERROR'
      const durationMs = span.duration / 1_000_000 // ns → ms
      if (existing) {
        existing.count += 1
        existing.errorCount += errored ? 1 : 0
        existing.durations.push(durationMs)
        existing.spanIds.push(span.spanId)
      } else {
        byKey.set(key, {
          filepath,
          lineno,
          functionName: typeof attrs['code.function'] === 'string'
            ? (attrs['code.function'] as string)
            : undefined,
          count: 1,
          errorCount: errored ? 1 : 0,
          durations: [durationMs],
          spanIds: [span.spanId],
        })
      }
    }
  }
  return byKey
}

export function formatStats(stats: FunctionStats): string {
  const sorted = [...stats.durations].sort((a, b) => a - b)
  const p50 = quantile(sorted, 0.5)
  const p95 = quantile(sorted, 0.95)
  const errPct = (stats.errorCount / stats.count) * 100
  const parts = [
    `${stats.count} trace${stats.count === 1 ? '' : 's'}`,
    `p50 ${fmtDuration(p50)}`,
    `p95 ${fmtDuration(p95)}`,
  ]
  if (errPct > 0) {
    parts.push(`${errPct < 1 ? '<1' : errPct.toFixed(0)}% errors`)
  }
  return parts.join(' · ')
}

export class AutotelCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeCodeLenses = this.emitter.event

  constructor(private getTraces: () => readonly TraceData[]) {}

  refresh(): void {
    this.emitter.fire()
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const stats = aggregateBySource(this.getTraces())
    if (stats.size === 0) return []
    const docPath = document.uri.fsPath
    const lenses: vscode.CodeLens[] = []
    for (const fnStats of stats.values()) {
      // Match by suffix so workspace-relative paths still resolve when spans
      // include absolute build-machine paths. Both endings normalize via
      // path separator first.
      if (!docPath.endsWith(fnStats.filepath) && !fnStats.filepath.endsWith(docPath.replace(/\\/g, '/'))) {
        continue
      }
      const lineIndex = Math.max(0, fnStats.lineno - 1)
      if (lineIndex >= document.lineCount) continue
      const range = new vscode.Range(lineIndex, 0, lineIndex, 0)
      const command: vscode.Command = {
        title: `📊 ${formatStats(fnStats)}`,
        command: 'autotel.openSpanDetail',
        arguments: [fnStats.spanIds[fnStats.spanIds.length - 1]], // newest span
        tooltip: fnStats.functionName ? `Function: ${fnStats.functionName}` : 'Open most recent span',
      }
      lenses.push(new vscode.CodeLens(range, command))
    }
    return lenses
  }
}

export class AutotelHoverProvider implements vscode.HoverProvider {
  constructor(private getTraces: () => readonly TraceData[]) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const stats = aggregateBySource(this.getTraces())
    if (stats.size === 0) return undefined
    const docPath = document.uri.fsPath
    for (const fnStats of stats.values()) {
      if (!docPath.endsWith(fnStats.filepath) && !fnStats.filepath.endsWith(docPath.replace(/\\/g, '/'))) {
        continue
      }
      // Hover applies to a small range around the recorded line.
      if (Math.abs(position.line - (fnStats.lineno - 1)) > 1) continue
      const md = new vscode.MarkdownString()
      md.appendMarkdown(`**Autotel** · \`${fnStats.functionName ?? 'function'}\`\n\n`)
      md.appendMarkdown(`${formatStats(fnStats)}\n\n`)
      const spanId = fnStats.spanIds[fnStats.spanIds.length - 1]
      md.appendMarkdown(
        `[Open most recent span](command:autotel.openSpanDetail?${encodeURIComponent(JSON.stringify([spanId]))})`,
      )
      md.isTrusted = true
      return new vscode.Hover(md)
    }
    return undefined
  }
}
