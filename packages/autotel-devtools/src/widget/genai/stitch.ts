import type { SpanData } from '../types'
import type { GenAiSpan } from './types'

// Extract tool-execution results from sibling spans that the AI SDK emits
// outside the gen_ai semconv namespace. Each `ai.toolCall` span carries the
// execution result for exactly one tool call (matched by `ai.toolCall.id`).
// We harvest these into a {toolCallId → result} map so the view can back-fill
// `GenAiToolCall.result` for tool calls promoted onto assistant messages from
// `ai.response.toolCalls` (which has args but no results).
export function buildToolResultIndex(spans: SpanData[]): Map<string, unknown> {
  const index = new Map<string, unknown>()
  for (const span of spans) {
    const attrs = span.attributes ?? {}
    const id = attrs['ai.toolCall.id']
    if (typeof id !== 'string') continue
    const raw = attrs['ai.toolCall.result']
    if (raw == null) continue
    if (typeof raw === 'string') {
      try {
        index.set(id, JSON.parse(raw))
      } catch {
        index.set(id, raw)
      }
    } else {
      index.set(id, raw)
    }
  }
  return index
}

// Mutates `genAiSpan` in place: any tool call whose id matches an entry in
// the index and which has no result yet gets its result filled in.
export function hydrateToolResults(
  genAiSpan: GenAiSpan,
  index: Map<string, unknown>,
): void {
  if (index.size === 0) return
  for (const call of genAiSpan.toolCalls) {
    if (call.result !== undefined) continue
    if (!call.id) continue
    const result = index.get(call.id)
    if (result !== undefined) call.result = result
  }
  for (const msg of genAiSpan.messages) {
    if (!msg.toolCalls) continue
    for (const call of msg.toolCalls) {
      if (call.result !== undefined) continue
      if (!call.id) continue
      const result = index.get(call.id)
      if (result !== undefined) call.result = result
    }
  }
}
