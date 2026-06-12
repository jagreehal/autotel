// Aggregate a set of GenAI spans (one agent run / conversation) into run-level
// totals — cost, tokens, model calls, tools, sub-agents, duration.
// Pure function over normalized spans so it can be unit-tested and reused by
// any view (GenAiView summary strip, timeline headers, future exports).

import type { GenAiSpan } from './types'

const MODEL_OPS = new Set([
  'chat',
  'text_completion',
  'generate_content',
  'embeddings',
])
const AGENT_OPS = new Set(['invoke_agent', 'create_agent'])

export interface RunSummary {
  spanCount: number
  /** LLM requests (chat / text_completion / generate_content / embeddings),
   *  excluding aggregate/parent spans that just wrap their children. */
  modelCalls: number
  /** Tool executions. Counted from `execute_tool` spans when present, else from
   *  inlined `toolCalls` on model spans (providers that don't emit a dedicated
   *  tool span), deduped by tool-call id. Aggregate/parent spans are excluded so
   *  the AI SDK's wrapping span and per-turn history replay don't double-count. */
  toolCalls: number
  /** Agent invocations — a proxy for "sub-agents" when more than one. */
  agentInvocations: number
  handoffs: number
  errors: number

  inputTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens: number
  cachedTokens: number

  totalCostUsd: number
  /** At least one span carried a table-priced cost. */
  costKnown: boolean
  /** Every model call was priced — totals are exact, not a lower bound. */
  costComplete: boolean

  durationMs: number
  /** Distinct response/request models seen, in first-appearance order. */
  models: string[]
  /** Distinct providers seen, in first-appearance order. */
  providers: string[]
}

function isHandoff(span: GenAiSpan): boolean {
  return span.operation === 'execute_handoff' || span.handoff != null
}

/** Span ids that strictly time-contain another span in the run — i.e. parent /
 *  aggregate spans. The Vercel AI SDK emits a wrapping `ai.generateText` span
 *  that is itself classified as a `chat` and carries *aggregate* tokens, tool
 *  calls and cost that duplicate its `ai.generateText.doGenerate` children.
 *  Counting both double-counts model calls, tokens and tools, so we exclude
 *  aggregates from those tallies. (Same "wrapper" notion AgentTimeline uses.) */
function findAggregateSpanIds(spans: GenAiSpan[]): Set<string> {
  const ids = new Set<string>()
  for (const a of spans) {
    const aDur = a.endMs - a.startMs
    for (const b of spans) {
      if (b === a) continue
      const bDur = b.endMs - b.startMs
      if (b.startMs >= a.startMs && b.endMs <= a.endMs && bDur < aDur) {
        ids.add(a.spanId)
        break
      }
    }
  }
  return ids
}

export function summarizeRun(spans: GenAiSpan[]): RunSummary {
  const summary: RunSummary = {
    spanCount: spans.length,
    modelCalls: 0,
    toolCalls: 0,
    agentInvocations: 0,
    handoffs: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalCostUsd: 0,
    costKnown: false,
    // Optimistic during the loop; cleared the moment an unpriced model call is
    // seen (and for the empty / no-model-call case below).
    costComplete: true,
    durationMs: 0,
    models: [],
    providers: [],
  }
  if (spans.length === 0) {
    summary.costComplete = false
    return summary
  }

  const aggregateIds = findAggregateSpanIds(spans)
  let minStart = Infinity
  let maxEnd = -Infinity
  let executeToolSpans = 0
  let modelCallsPriced = 0
  const modelSet = new Set<string>()
  const providerSet = new Set<string>()
  // Inline tool calls deduped by id: the AI SDK replays the full message
  // history each turn, so the same tool call surfaces on several spans. Calls
  // without an id can't be deduped, so each counts.
  const inlineToolCallIds = new Set<string>()
  let inlineToolCallsNoId = 0

  for (const span of spans) {
    minStart = Math.min(minStart, span.startMs)
    maxEnd = Math.max(maxEnd, span.endMs)
    if (span.status === 'error') summary.errors++

    const op = span.operation
    // Aggregate/parent spans duplicate their children's model+tool data; agent
    // and handoff spans (which are legitimately parents) are counted separately
    // below and are never model/tool leaves, so the skip only affects tallies.
    const isAggregate = aggregateIds.has(span.spanId)
    if (op === 'execute_tool' && !isAggregate) executeToolSpans++
    if (!isAggregate) {
      for (const tc of span.toolCalls) {
        if (tc.id) inlineToolCallIds.add(tc.id)
        else inlineToolCallsNoId++
      }
    }
    if (AGENT_OPS.has(op)) summary.agentInvocations++
    if (isHandoff(span)) summary.handoffs++

    if (MODEL_OPS.has(op) && !isAggregate) {
      summary.modelCalls++
      const model = span.responseModel ?? span.requestModel
      if (model && model !== 'unknown') modelSet.add(model)
      if (span.provider && span.provider !== 'unknown') providerSet.add(span.provider)

      const u = span.usage
      summary.inputTokens += u.inputTokens ?? 0
      summary.outputTokens += u.outputTokens ?? 0
      summary.reasoningTokens += u.reasoningOutputTokens ?? 0
      summary.cachedTokens += u.cacheReadInputTokens ?? 0

      if (span.cost && span.cost.source === 'table') {
        summary.totalCostUsd += span.cost.total
        modelCallsPriced++
      } else {
        summary.costComplete = false
      }
    }
  }

  summary.totalTokens = summary.inputTokens + summary.outputTokens
  // Prefer dedicated tool spans; fall back to inlined tool calls so providers
  // that don't emit `execute_tool` spans still get a meaningful count.
  summary.toolCalls =
    executeToolSpans > 0
      ? executeToolSpans
      : inlineToolCallIds.size + inlineToolCallsNoId
  summary.costKnown = modelCallsPriced > 0
  // No model calls at all → "complete" is vacuously true but uninformative; a
  // run with zero priced model calls is not "exactly priced".
  if (summary.modelCalls === 0) summary.costComplete = false
  summary.durationMs = maxEnd > minStart ? maxEnd - minStart : 0
  summary.models = [...modelSet]
  summary.providers = [...providerSet]
  return summary
}

/** Group rows into runs keyed by conversation id, falling back to trace id so
 *  spans without a conversation still form one coherent run per trace. Newest
 *  run first (by latest span start). */
export function groupRuns<T extends { normalized: GenAiSpan; traceId: string }>(
  rows: T[],
): Array<{ key: string; conversationId?: string; traceId: string; rows: T[] }> {
  const byKey = new Map<
    string,
    { key: string; conversationId?: string; traceId: string; rows: T[]; latest: number }
  >()
  for (const row of rows) {
    const conversation = row.normalized.conversationId
    const key = conversation ?? `trace:${row.traceId}`
    const existing = byKey.get(key)
    if (existing) {
      existing.rows.push(row)
      existing.latest = Math.max(existing.latest, row.normalized.startMs)
    } else {
      byKey.set(key, {
        key,
        conversationId: conversation,
        traceId: row.traceId,
        rows: [row],
        latest: row.normalized.startMs,
      })
    }
  }
  return [...byKey.values()].sort((a, b) => b.latest - a.latest)
}
