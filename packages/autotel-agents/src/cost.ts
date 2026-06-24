/**
 * Fallback cost estimation. Reported cost (`cost_usd` on `api_request`) always
 * wins — Claude Code computes it cache-accurately. This table is ONLY used when
 * an agent reports tokens but not cost (e.g. a future agent, or a misconfigured
 * run). Estimated values are badged `estimated` in the UI.
 *
 * Prices are USD per 1,000,000 tokens. Matched by substring so model ids like
 * `claude-sonnet-4-6` or `claude-3-5-sonnet-20241022` resolve to a family rate.
 * Keep deliberately small — this is a safety net, not a billing source.
 */

const PRICES: ReadonlyArray<readonly [match: string, input: number, output: number]> = [
  ['claude-opus-4', 15, 75],
  ['claude-sonnet-4', 3, 15],
  ['claude-haiku-4', 0.8, 4],
  ['claude-3-5-sonnet', 3, 15],
  ['claude-3-5-haiku', 0.8, 4],
  ['claude-3-opus', 15, 75],
  ['claude-3-haiku', 0.25, 1.25],
  ['opus', 15, 75],
  ['sonnet', 3, 15],
  ['haiku', 0.8, 4],
];

export function estimateCostUsd(
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  if (!model) return undefined;
  const lower = model.toLowerCase();
  const row = PRICES.find(([match]) => lower.includes(match));
  if (!row) return undefined;
  const [, inputRate, outputRate] = row;
  const input = ((inputTokens ?? 0) / 1_000_000) * inputRate;
  const output = ((outputTokens ?? 0) / 1_000_000) * outputRate;
  return input + output;
}
