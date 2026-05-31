// Shared formatters for LLM token counts and USD cost, so every view that
// surfaces GenAI economics (GenAiView, FlowView, future cost summaries) renders
// them identically. Take primitives, not the GenAiSpan shape, so non-genai
// callers (e.g. Flow nodes that sum across spans) can use them too.

/** `i→o` token counts, or `—` when neither side is known. */
export function formatTokenCounts(input?: number, output?: number): string {
  if (input == null && output == null) return '—';
  return `${input ?? '—'}→${output ?? '—'}`;
}

/**
 * USD cost with magnitude-aware units: micro (`$1.20μ`) and milli (`$1.234m`)
 * for tiny amounts, plain dollars otherwise. `—` when unknown or unpriced.
 */
export function formatCostUsd(total?: number, known = true): string {
  if (total == null || !known) return '—';
  if (total < 0.0001) return `$${(total * 1_000_000).toFixed(2)}μ`;
  if (total < 0.01) return `$${(total * 1000).toFixed(3)}m`;
  return `$${total.toFixed(4)}`;
}
