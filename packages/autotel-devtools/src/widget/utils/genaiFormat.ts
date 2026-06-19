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

/** Input token total with the cached share called out: `176 (100 cached)`. */
export function formatInputTokens(total?: number, cached?: number): string {
  if (total == null) return '—';
  return cached && cached > 0 ? `${total} (${cached} cached)` : String(total);
}

/** Output token total with the reasoning share called out: `90 (32 reasoning)`. */
export function formatOutputTokens(total?: number, reasoning?: number): string {
  if (total == null) return '—';
  return reasoning && reasoning > 0
    ? `${total} (${reasoning} reasoning)`
    : String(total);
}

/** Compact streaming throughput label: `52 tok/s`, or `—` when unknown. */
export function formatTokensPerSecond(tokensPerSecond?: number): string {
  if (tokensPerSecond == null) return '—';
  return `${tokensPerSecond >= 10 ? Math.round(tokensPerSecond) : tokensPerSecond.toFixed(1)} tok/s`;
}

/** A duration given in seconds rendered compactly: `820ms`, `2.4s`. */
export function formatSeconds(seconds?: number): string {
  if (seconds == null) return '—';
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
}

/**
 * Compact label for a list of tool-call names, collapsing repeats: a single
 * tool → `getWeather`; repeats → `getWeather (x3)`; many → `a, b, …` with the
 * full list in `details`. Takes names (primitive) so any caller can use it.
 */
export function summarizeToolCalls(names: string[]): {
  label: string;
  details: string;
} {
  if (names.length === 0) return { label: '', details: '' };
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const unique = [...counts.keys()];
  const fmt = (n: string) => {
    const c = counts.get(n) ?? 0;
    return c > 1 ? `${n} (x${c})` : n;
  };
  const all = unique.map(fmt).join(', ');
  if (unique.length === 1) return { label: fmt(unique[0]), details: '' };
  if (unique.length === 2)
    return { label: `${fmt(unique[0])}, ${fmt(unique[1])}`, details: all };
  return { label: `${fmt(unique[0])}, ${fmt(unique[1])}, …`, details: all };
}
