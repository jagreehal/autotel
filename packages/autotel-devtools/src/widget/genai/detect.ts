import type { SpanData } from '../types'

// A span belongs to the GenAI view if it carries any of the load-bearing
// semconv markers. These are stable across the migration from `gen_ai.system`
// (legacy) to `gen_ai.provider.name` (newer). We also accept `ai.model.provider`
// for Vercel AI SDK wrapper spans (the outer `ai.generateText`) which carry
// only AI-SDK-flavored attributes but represent the canonical user-visible call.
const GENAI_MARKERS = [
  'gen_ai.system',
  'gen_ai.provider.name',
  'gen_ai.operation.name',
  'ai.model.provider',
] as const

export function isGenAiSpan(span: SpanData): boolean {
  const attrs = span.attributes ?? {}
  for (const key of GENAI_MARKERS) {
    if (attrs[key] != null) return true
  }
  return false
}
