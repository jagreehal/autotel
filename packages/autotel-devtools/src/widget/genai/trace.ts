// Build a depth-indented "trace" of one agent run: each model call decomposed
// into the parts that happened inside it (reasoning, the tools it called, the
// text it wrote) with nested sub-agents underneath. Built from our real span
// tree (parentSpanId + GenAI semantics) rather than synthetic timing.
//
// Two run shapes both fall out of the same builder:
//   - A tool has its own `execute_tool` span (a sibling of the chats): the
//     chats are leaf steps and the tool is shown from its own span.
//   - A framework emits an outer wrapper span (e.g. `ai.generateText`) over
//     child model calls, with the tool call inlined on a step rather than as a
//     separate span — so it is synthesized as a child of that step.

import { MODEL_OPS, AGENT_OPS } from './operations'
import type { GenAiSpan } from './types'

export type TraceKind =
  | 'group' // a model call that wraps child model calls (an outer generate span)
  | 'agent' // invoke_agent / create_agent
  | 'step' // a leaf model call
  | 'reasoning'
  | 'tool'
  | 'text'
  | 'handoff'

export interface TraceNode {
  id: string
  kind: TraceKind
  label: string
  sublabel?: string
  depth: number
  startMs?: number
  durationMs?: number
  tokens?: { input?: number; output?: number }
  /** The originating GenAI span, when the node maps to one (for selection). */
  spanId?: string
  children: TraceNode[]
}

function truncate(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function preview(value: unknown, max = 60): string {
  if (value == null) return ''
  if (typeof value === 'string') return truncate(value, max)
  try {
    return truncate(JSON.stringify(value), max)
  } catch {
    return truncate(String(value), max)
  }
}

function modelLabel(span: GenAiSpan): string {
  const model = span.responseModel ?? span.requestModel
  if (model && model !== 'unknown') {
    return span.provider && span.provider !== 'unknown' ? `${span.provider}/${model}` : model
  }
  return span.agent?.name ?? span.provider ?? 'model'
}

function tokensOf(span: GenAiSpan): TraceNode['tokens'] | undefined {
  const { inputTokens, outputTokens } = span.usage
  if (inputTokens == null && outputTokens == null) return undefined
  return { input: inputTokens, output: outputTokens }
}

/** The last assistant text on a span — the answer it wrote, if any. */
function answerText(span: GenAiSpan): string | undefined {
  for (let i = span.messages.length - 1; i >= 0; i--) {
    const m = span.messages[i]
    if (m.role !== 'assistant') continue
    const text = m.parts
      .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
      .map((p) => p.text)
      .join(' ')
      .trim()
    if (text) return text
  }
  return undefined
}

/** Result of an `execute_tool` span — Logfire stashes it as `tool_response`. */
function executeToolResult(span: GenAiSpan): string {
  const raw = span.extras?.raw ?? {}
  const result = raw['tool_response'] ?? raw['tool_result']
  return result == null ? '' : preview(result)
}

export function buildRunTrace(spans: GenAiSpan[]): TraceNode[] {
  if (spans.length === 0) return []

  const byId = new Map(spans.map((s) => [s.spanId, s]))
  const childrenOf = new Map<string, GenAiSpan[]>()
  const roots: GenAiSpan[] = []
  for (const s of spans) {
    const parent = s.parentSpanId
    if (parent && byId.has(parent)) {
      const arr = childrenOf.get(parent) ?? []
      arr.push(s)
      childrenOf.set(parent, arr)
    } else {
      roots.push(s)
    }
  }

  // Tool calls that already have a dedicated execute_tool span — don't also
  // synthesize them under the model call that requested them.
  const executedToolCallIds = new Set<string>()
  for (const s of spans) {
    if (s.operation === 'execute_tool' && s.tool?.callId) executedToolCallIds.add(s.tool.callId)
  }
  // A synthesized tool node is emitted once per call id, on the first (earliest)
  // step that references it — some frameworks replay prior tool calls in each
  // turn's history, so the same call otherwise shows up under every later step.
  const synthesizedToolCallIds = new Set<string>()

  const byStart = (a: GenAiSpan, b: GenAiSpan): number =>
    a.startMs - b.startMs || a.endMs - b.endMs

  let uid = 0
  const nid = (): string => `trace-${uid++}`

  function childNodes(span: GenAiSpan, depth: number): TraceNode[] {
    return (childrenOf.get(span.spanId) ?? []).sort(byStart).map((c) => build(c, depth))
  }

  function build(span: GenAiSpan, depth: number): TraceNode {
    const op = span.operation
    const durationMs = span.endMs - span.startMs
    const base = { startMs: span.startMs, durationMs, spanId: span.spanId }

    if (op === 'execute_handoff' || span.handoff) {
      const from = span.handoff?.fromAgent ?? '?'
      const to = span.handoff?.toAgent ?? '?'
      return { id: nid(), kind: 'handoff', label: `${from} → ${to}`, depth, ...base, children: childNodes(span, depth + 1) }
    }

    if (AGENT_OPS.has(op)) {
      return {
        id: nid(),
        kind: 'agent',
        label: `Agent: ${span.agent?.name ?? 'agent'}`,
        depth,
        ...base,
        tokens: tokensOf(span),
        children: childNodes(span, depth + 1),
      }
    }

    if (op === 'execute_tool') {
      const name = span.tool?.name ?? span.agent?.name ?? span.name ?? 'tool'
      const result = executeToolResult(span)
      return {
        id: nid(),
        kind: 'tool',
        label: `Tool: ${name}`,
        sublabel: result ? `→ ${result}` : undefined,
        depth,
        ...base,
        children: childNodes(span, depth + 1),
      }
    }

    if (MODEL_OPS.has(op)) {
      const kids = childNodes(span, depth + 1)
      // A model call that wraps child model calls (an outer generate span) is
      // an aggregate — its children carry the real content, so render it as a
      // plain container without re-synthesizing its (duplicated) parts.
      if (kids.length > 0) {
        return { id: nid(), kind: 'group', label: modelLabel(span), depth, ...base, tokens: tokensOf(span), children: kids }
      }

      const content: TraceNode[] = []
      const reasoning = span.usage.reasoningOutputTokens ?? 0
      if (reasoning > 0) {
        content.push({ id: nid(), kind: 'reasoning', label: 'Reasoning', sublabel: `${reasoning} tokens`, depth: depth + 1, children: [] })
      }
      for (const tc of span.toolCalls) {
        if (tc.id && executedToolCallIds.has(tc.id)) continue
        if (tc.id && synthesizedToolCallIds.has(tc.id)) continue
        if (tc.id) synthesizedToolCallIds.add(tc.id)
        const args = preview(tc.arguments, 40)
        const res = tc.result !== undefined ? ` → ${preview(tc.result, 40)}` : ''
        content.push({
          id: nid(),
          kind: 'tool',
          label: `Tool: ${tc.name}`,
          sublabel: `${args}${res}`.trim() || undefined,
          depth: depth + 1,
          children: [],
        })
      }
      const text = answerText(span)
      if (text) {
        content.push({ id: nid(), kind: 'text', label: 'Text', sublabel: truncate(text), depth: depth + 1, children: [] })
      }
      return {
        id: nid(),
        kind: 'step',
        label: modelLabel(span),
        sublabel: span.operation,
        depth,
        ...base,
        tokens: tokensOf(span),
        children: content,
      }
    }

    return { id: nid(), kind: 'step', label: span.name || op, depth, ...base, children: childNodes(span, depth + 1) }
  }

  return roots.sort(byStart).map((r) => build(r, 0))
}

/** Flatten the trace tree to a depth-ordered list for rendering. */
export function flattenTrace(nodes: TraceNode[]): TraceNode[] {
  const out: TraceNode[] = []
  const walk = (n: TraceNode): void => {
    out.push(n)
    for (const c of n.children) walk(c)
  }
  for (const n of nodes) walk(n)
  return out
}
