// Flow graph: a per-trace call graph that unifies AI tool calls, LLM calls and
// plain (non-AI) functions into one picture of "what the run actually did".
//
// Langfuse renders a tree of nested observations plus a node graph
// (`__start__ → handler → streamText → calculate/formatCurrency → __end__`).
// This module is the pure data layer for the equivalent autotel-devtools view:
// it folds a trace's flat spans into role-typed nodes, collapses repeated
// invocations of the same function/tool into a single node with a count
// (Langfuse's `calculate (5/5)`), and lays the result out top-to-bottom.
//
// Everything here is pure and unit-tested; `FlowView.svelte` only renders it.

import type { SpanData } from '../types'

export type FlowRole =
  | 'entry'
  | 'llm'
  | 'tool'
  | 'function'
  | 'db'
  | 'http'
  | 'end'

export const START_ID = '__start__'
export const END_ID = '__end__'

export interface FlowNodeIO {
  input?: unknown
  output?: unknown
}

export interface FlowNode {
  /** Stable grouping key — same key ⇒ collapsed into one node. */
  id: string
  label: string
  role: FlowRole
  /** Number of spans collapsed into this node. */
  count: number
  /** How many of those spans errored. */
  errorCount: number
  /** Summed wall time across collapsed spans (ms). */
  totalDurationMs: number
  /** Span ids that map to this node, in start-time order. */
  spanIds: string[]
  /** Representative input/output from the first span that has any. */
  sample: FlowNodeIO
  /** Summed LLM tokens/cost across collapsed spans, when supplied. */
  metrics?: FlowNodeMetrics
}

/** LLM economics for a node, summed across its spans. */
export interface FlowNodeMetrics {
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

export interface FlowEdge {
  source: string
  target: string
  count: number
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

// ---------------------------------------------------------------------------
// Role + label detection
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function isToolSpan(attrs: Record<string, unknown>): boolean {
  return (
    attrs['ai.toolCall.name'] != null ||
    attrs['operation.name'] === 'ai.toolCall' ||
    attrs['ai.operationId'] === 'ai.toolCall' ||
    attrs['gen_ai.operation.name'] === 'execute_tool' ||
    attrs['gen_ai.tool.name'] != null
  )
}

function isLlmSpan(attrs: Record<string, unknown>): boolean {
  return (
    attrs['gen_ai.system'] != null ||
    attrs['gen_ai.provider.name'] != null ||
    attrs['ai.model.provider'] != null ||
    attrs['gen_ai.request.model'] != null ||
    attrs['ai.model.id'] != null
  )
}

function isDbSpan(attrs: Record<string, unknown>): boolean {
  return (
    attrs['db.system'] != null ||
    attrs['db.statement'] != null ||
    attrs['db.query.text'] != null
  )
}

function isHttpSpan(span: SpanData, attrs: Record<string, unknown>): boolean {
  return (
    span.kind === 'CLIENT' &&
    (attrs['http.method'] != null ||
      attrs['http.request.method'] != null ||
      attrs['url.full'] != null ||
      attrs['http.url'] != null)
  )
}

/** Strip the AI-SDK `functionId` prefix that telemetry prepends to span names. */
function cleanName(name: string): string {
  const colon = name.lastIndexOf(':')
  // Only strip when the suffix looks like an `ai.*` operation name, so we keep
  // user-chosen names like `db:read` intact.
  if (colon > 0 && name.slice(colon + 1).startsWith('ai.')) {
    return name.slice(colon + 1)
  }
  return name
}

export interface RoleResult {
  role: FlowRole
  label: string
}

export function classifySpan(span: SpanData): RoleResult {
  const attrs = span.attributes ?? {}

  if (isToolSpan(attrs)) {
    const name =
      asString(attrs['ai.toolCall.name']) ??
      asString(attrs['gen_ai.tool.name']) ??
      cleanName(span.name)
    return { role: 'tool', label: name }
  }
  if (isLlmSpan(attrs)) {
    return { role: 'llm', label: cleanName(span.name) }
  }
  if (isDbSpan(attrs)) {
    const name =
      asString(attrs['db.operation']) ??
      asString(attrs['db.system']) ??
      cleanName(span.name)
    return { role: 'db', label: name }
  }
  if (isHttpSpan(span, attrs)) {
    const name =
      asString(attrs['http.route']) ??
      asString(attrs['url.path']) ??
      cleanName(span.name)
    return { role: 'http', label: name }
  }
  if (span.kind === 'SERVER' || span.kind === 'CONSUMER') {
    return { role: 'entry', label: cleanName(span.name) }
  }
  return { role: 'function', label: cleanName(span.name) }
}

// ---------------------------------------------------------------------------
// Input/output extraction — the bit that makes functions as legible as tools
// ---------------------------------------------------------------------------

function tryParse(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return v
  try {
    return JSON.parse(t)
  } catch {
    return v
  }
}

/**
 * Pull a representative input/output pair off a span. Tools and LLM calls carry
 * standardized attributes; plain functions expose `autotel.input/output` (the
 * opt-in capture convention) or any `*.input`/`*.output` attribute.
 */
export function extractIO(span: SpanData, role: FlowRole): FlowNodeIO {
  const attrs = span.attributes ?? {}
  const io: FlowNodeIO = {}

  if (role === 'tool') {
    if (attrs['ai.toolCall.args'] != null)
      io.input = tryParse(attrs['ai.toolCall.args'])
    if (attrs['ai.toolCall.result'] != null)
      io.output = tryParse(attrs['ai.toolCall.result'])
  } else if (role === 'llm') {
    if (attrs['ai.prompt'] != null) io.input = tryParse(attrs['ai.prompt'])
    else if (attrs['gen_ai.prompt'] != null)
      io.input = tryParse(attrs['gen_ai.prompt'])
    if (attrs['ai.response.text'] != null)
      io.output = tryParse(attrs['ai.response.text'])
    else if (attrs['gen_ai.completion'] != null)
      io.output = tryParse(attrs['gen_ai.completion'])
  } else if (role === 'db') {
    if (attrs['db.statement'] != null) io.input = attrs['db.statement']
    else if (attrs['db.query.text'] != null) io.input = attrs['db.query.text']
  }

  // Generic fallback / function convention. Never overwrite a role-specific hit.
  if (io.input === undefined) {
    io.input = tryParse(
      attrs['autotel.input'] ??
        attrs['code.function.input'] ??
        attrs['input'] ??
        attrs['rpc.request.body'],
    )
  }
  if (io.output === undefined) {
    io.output = tryParse(
      attrs['autotel.output'] ??
        attrs['code.function.output'] ??
        attrs['output'] ??
        attrs['rpc.response.body'],
    )
  }
  return io
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export interface BuildFlowOptions {
  /** Add synthetic `__start__` / `__end__` bookends (Langfuse-style). */
  bookends?: boolean
  /**
   * Per-span LLM metrics (tokens/cost) to sum onto nodes. The Flow view fills
   * this from the canonical `genAiRowsSignal` so cost stays priced in one place.
   */
  metricsBySpanId?: Map<string, FlowNodeMetrics>
}

/** Sum a span's metrics onto a node's running totals (additive, nullable). */
function addMetrics(node: FlowNode, m: FlowNodeMetrics | undefined): void {
  if (!m) return
  const acc = node.metrics ?? {}
  if (m.inputTokens != null)
    acc.inputTokens = (acc.inputTokens ?? 0) + m.inputTokens
  if (m.outputTokens != null)
    acc.outputTokens = (acc.outputTokens ?? 0) + m.outputTokens
  if (m.costUsd != null) acc.costUsd = (acc.costUsd ?? 0) + m.costUsd
  node.metrics = acc
}

export function buildFlowGraph(
  spans: SpanData[],
  opts: BuildFlowOptions = {},
): FlowGraph {
  const bookends = opts.bookends ?? true
  const spanById = new Map<string, SpanData>()
  for (const s of spans) spanById.set(s.spanId, s)

  // span id → flow node id
  const nodeIdForSpan = new Map<string, string>()
  const nodes = new Map<string, FlowNode>()

  const ordered = [...spans].sort((a, b) => a.startTime - b.startTime)

  for (const span of ordered) {
    const { role, label } = classifySpan(span)
    const id = `${role}|${label}`
    nodeIdForSpan.set(span.spanId, id)

    let node = nodes.get(id)
    if (!node) {
      node = {
        id,
        label,
        role,
        count: 0,
        errorCount: 0,
        totalDurationMs: 0,
        spanIds: [],
        sample: {},
      }
      nodes.set(id, node)
    }
    node.count++
    if (span.status?.code === 'ERROR') node.errorCount++
    node.totalDurationMs += span.duration
    node.spanIds.push(span.spanId)
    addMetrics(node, opts.metricsBySpanId?.get(span.spanId))
    if (node.sample.input === undefined && node.sample.output === undefined) {
      const io = extractIO(span, role)
      if (io.input !== undefined || io.output !== undefined) node.sample = io
    }
  }

  // Edges from parent→child span relationships, aggregated by node pair.
  const edges = new Map<string, FlowEdge>()
  const bump = (source: string, target: string) => {
    if (source === target) return // skip self-loops; the count badge covers it
    const key = `${source}>${target}`
    const e = edges.get(key)
    if (e) e.count++
    else edges.set(key, { source, target, count: 1 })
  }

  const hasOutgoing = new Set<string>()
  const hasIncoming = new Set<string>()

  for (const span of ordered) {
    const childNode = nodeIdForSpan.get(span.spanId)!
    const parent = span.parentSpanId
      ? spanById.get(span.parentSpanId)
      : undefined
    if (parent) {
      const parentNode = nodeIdForSpan.get(parent.spanId)!
      if (parentNode !== childNode) {
        bump(parentNode, childNode)
        hasOutgoing.add(parentNode)
        hasIncoming.add(childNode)
      }
    }
  }

  const nodeList = [...nodes.values()]

  if (bookends && nodeList.length > 0) {
    const start: FlowNode = {
      id: START_ID,
      label: '__start__',
      role: 'entry',
      count: 1,
      errorCount: 0,
      totalDurationMs: 0,
      spanIds: [],
      sample: {},
    }
    const end: FlowNode = {
      id: END_ID,
      label: '__end__',
      role: 'end',
      count: 1,
      errorCount: 0,
      totalDurationMs: 0,
      spanIds: [],
      sample: {},
    }
    nodes.set(START_ID, start)
    nodes.set(END_ID, end)
    for (const n of nodeList) {
      if (!hasIncoming.has(n.id)) bump(START_ID, n.id)
      if (!hasOutgoing.has(n.id)) bump(n.id, END_ID)
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

/** Sum tokens/cost across all nodes — the per-trace total for the header. */
export function sumFlowMetrics(nodes: FlowNode[]): FlowNodeMetrics {
  const total: FlowNodeMetrics = {}
  for (const n of nodes) {
    if (!n.metrics) continue
    const { inputTokens, outputTokens, costUsd } = n.metrics
    if (inputTokens != null)
      total.inputTokens = (total.inputTokens ?? 0) + inputTokens
    if (outputTokens != null)
      total.outputTokens = (total.outputTokens ?? 0) + outputTokens
    if (costUsd != null) total.costUsd = (total.costUsd ?? 0) + costUsd
  }
  return total
}

// ---------------------------------------------------------------------------
// Layered (top-to-bottom) layout — BFS layering + barycenter ordering
// ---------------------------------------------------------------------------

export interface PositionedNode extends FlowNode {
  x: number
  y: number
  width: number
  layer: number
}

export interface FlowLayout {
  nodes: PositionedNode[]
  edges: FlowEdge[]
  width: number
  height: number
}

export const NODE_H = 44
const CHAR_W = 7.2
const NODE_PAD = 28
const MIN_NODE_W = 96
const MAX_NODE_W = 280
const LAYER_GAP_Y = 78
const NODE_GAP_X = 32
const MARGIN = 24

function nodeWidth(n: FlowNode): number {
  const labelW = n.label.length * CHAR_W + NODE_PAD
  const badge = n.count > 1 ? 34 : 0
  return Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, labelW + badge))
}

export function layoutFlow(graph: FlowGraph): FlowLayout {
  const { nodes, edges } = graph
  if (nodes.length === 0)
    return { nodes: [], edges: [], width: 0, height: 0 }

  const ids = nodes.map((n) => n.id)
  const out = new Map<string, string[]>()
  const inc = new Map<string, string[]>()
  for (const id of ids) {
    out.set(id, [])
    inc.set(id, [])
  }
  for (const e of edges) {
    out.get(e.source)?.push(e.target)
    inc.get(e.target)?.push(e.source)
  }

  // Longest-path-ish BFS layering from roots (no incoming edges).
  const layer = new Map<string, number>()
  const roots = ids.filter((id) => (inc.get(id)?.length ?? 0) === 0)
  const starts = roots.length > 0 ? roots : [ids[0]]
  const queue = [...starts]
  for (const r of starts) layer.set(r, 0)
  let guard = 0
  while (queue.length && guard++ < ids.length * ids.length + ids.length) {
    const cur = queue.shift()!
    const cl = layer.get(cur) ?? 0
    for (const nxt of out.get(cur) ?? []) {
      const existing = layer.get(nxt) ?? -1
      if (existing < cl + 1) {
        layer.set(nxt, cl + 1)
        queue.push(nxt)
      }
    }
  }
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0)

  const maxLayer = Math.max(...layer.values())
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const id of ids) layers[layer.get(id)!].push(id)

  // Barycenter ordering to reduce crossings (2 passes).
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l <= maxLayer; l++) {
      const prev = layers[l - 1]
      const pos = new Map<string, number>()
      prev.forEach((id, i) => pos.set(id, i))
      layers[l].sort((a, b) => {
        const av = inc.get(a) ?? []
        const bv = inc.get(b) ?? []
        const am = av.length
          ? av.reduce((s, p) => s + (pos.get(p) ?? 0), 0) / av.length
          : 999
        const bm = bv.length
          ? bv.reduce((s, p) => s + (pos.get(p) ?? 0), 0) / bv.length
          : 999
        return am - bm
      })
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const widths = new Map(nodes.map((n) => [n.id, nodeWidth(n)]))

  // Each layer is a horizontal row; center rows against the widest one.
  const rowWidths = layers.map((row) =>
    row.reduce((s, id) => s + (widths.get(id) ?? MIN_NODE_W) + NODE_GAP_X, 0),
  )
  const maxRowW = Math.max(...rowWidths, MIN_NODE_W)

  const positioned: PositionedNode[] = []
  layers.forEach((row, l) => {
    let x = MARGIN + (maxRowW - rowWidths[l]) / 2
    for (const id of row) {
      const n = byId.get(id)!
      const w = widths.get(id) ?? MIN_NODE_W
      positioned.push({
        ...n,
        x,
        y: MARGIN + l * (NODE_H + LAYER_GAP_Y),
        width: w,
        layer: l,
      })
      x += w + NODE_GAP_X
    }
  })

  const width = maxRowW + MARGIN * 2
  const height = MARGIN * 2 + (maxLayer + 1) * (NODE_H + LAYER_GAP_Y)
  return { nodes: positioned, edges, width, height }
}
