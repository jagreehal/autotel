/**
 * LLM cost estimation.
 *
 * Prices are per **one million tokens** in USD. The catalog below is a
 * reasonable default but prices change frequently — set
 * `AUTOTEL_LLM_PRICES_JSON=/path/to/prices.json` to override.
 *
 * The JSON file shape matches `ModelPrice` below. Missing models fall back
 * to longest-prefix match against the default catalog, then to `null`
 * (cost is omitted rather than guessed).
 *
 * Last reviewed against public vendor pricing 2026-01. Numbers here are
 * rounded to the published list price — negotiated rates, batch discounts,
 * and cached-prompt credits aren't modelled. Override the catalog when you
 * need finer accuracy.
 */

import { readFileSync } from 'node:fs';

export interface ModelPrice {
  /** USD per million prompt tokens. */
  inputPerMtok: number;
  /** USD per million completion tokens. */
  outputPerMtok: number;
}

type ModelPriceCatalog = Record<string, ModelPrice>;

// Ordered longest-first so e.g. `gpt-4o-mini-2024-07-18` matches the
// `gpt-4o-mini` entry before the broader `gpt-4o` entry.
const DEFAULT_PRICES: ModelPriceCatalog = {
  // --- Anthropic Claude (per million tokens) -----------------------------
  'claude-opus-4-7': { inputPerMtok: 15, outputPerMtok: 75 },
  'claude-opus-4-6': { inputPerMtok: 15, outputPerMtok: 75 },
  'claude-opus-4': { inputPerMtok: 15, outputPerMtok: 75 },
  'claude-sonnet-4-6': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-sonnet-4': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-haiku-4-5': { inputPerMtok: 0.8, outputPerMtok: 4 },
  'claude-haiku-4': { inputPerMtok: 0.8, outputPerMtok: 4 },
  'claude-3-5-sonnet': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-3-5-haiku': { inputPerMtok: 0.8, outputPerMtok: 4 },
  'claude-3-opus': { inputPerMtok: 15, outputPerMtok: 75 },
  'claude-3-sonnet': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-3-haiku': { inputPerMtok: 0.25, outputPerMtok: 1.25 },

  // --- OpenAI GPT -------------------------------------------------------
  'gpt-4.1-nano': { inputPerMtok: 0.1, outputPerMtok: 0.4 },
  'gpt-4.1-mini': { inputPerMtok: 0.4, outputPerMtok: 1.6 },
  'gpt-4.1': { inputPerMtok: 2, outputPerMtok: 8 },
  'gpt-4o-mini': { inputPerMtok: 0.15, outputPerMtok: 0.6 },
  'gpt-4o': { inputPerMtok: 2.5, outputPerMtok: 10 },
  'gpt-4-turbo': { inputPerMtok: 10, outputPerMtok: 30 },
  'gpt-4': { inputPerMtok: 30, outputPerMtok: 60 },
  'gpt-3.5-turbo': { inputPerMtok: 0.5, outputPerMtok: 1.5 },

  // --- OpenAI o-series (reasoning) -------------------------------------
  'o1-mini': { inputPerMtok: 3, outputPerMtok: 12 },
  'o1-preview': { inputPerMtok: 15, outputPerMtok: 60 },
  o1: { inputPerMtok: 15, outputPerMtok: 60 },
  'o3-mini': { inputPerMtok: 1.1, outputPerMtok: 4.4 },
  o3: { inputPerMtok: 2, outputPerMtok: 8 },

  // --- Google Gemini ---------------------------------------------------
  'gemini-2.5-pro': { inputPerMtok: 1.25, outputPerMtok: 10 },
  'gemini-2.5-flash': { inputPerMtok: 0.3, outputPerMtok: 2.5 },
  'gemini-2.0-flash': { inputPerMtok: 0.1, outputPerMtok: 0.4 },
  'gemini-1.5-pro': { inputPerMtok: 1.25, outputPerMtok: 5 },
  'gemini-1.5-flash': { inputPerMtok: 0.075, outputPerMtok: 0.3 },

  // --- Mistral ---------------------------------------------------------
  'mistral-large': { inputPerMtok: 2, outputPerMtok: 6 },
  'mistral-small': { inputPerMtok: 0.2, outputPerMtok: 0.6 },

  // --- Meta Llama via common providers --------------------------------
  'llama-3.3-70b': { inputPerMtok: 0.6, outputPerMtok: 0.6 },
  'llama-3.1-405b': { inputPerMtok: 3.5, outputPerMtok: 3.5 },
  'llama-3.1-70b': { inputPerMtok: 0.6, outputPerMtok: 0.6 },
  'llama-3.1-8b': { inputPerMtok: 0.05, outputPerMtok: 0.08 },
};

let cachedCatalog: ModelPriceCatalog | null = null;
let cachedMatchEntries: Array<[string, ModelPrice]> | null = null;

/** Expose the catalog for tests / tool responses. Read-only snapshot. */
export function getCatalog(): Readonly<ModelPriceCatalog> {
  return loadCatalog();
}

/**
 * Best-effort longest-prefix lookup so dated variants
 * (`claude-sonnet-4-6-20260119`, `gpt-4o-2024-11-20`) match the base model.
 * Returns `null` if no entry matches — callers should treat that as "cost
 * unknown" rather than $0.
 */
export function priceFor(model: string | undefined): ModelPrice | null {
  if (!model) return null;
  const normalized = model.toLowerCase();
  for (const [key, price] of loadMatchEntries()) {
    if (normalized.startsWith(key)) return price;
  }
  return null;
}

/**
 * Compute cost in USD for a request. Returns `null` if we can't price the
 * model — the caller should omit the cost field rather than show $0.
 */
export function estimateCostUsd(
  model: string | undefined,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const input = (promptTokens / 1_000_000) * price.inputPerMtok;
  const output = (completionTokens / 1_000_000) * price.outputPerMtok;
  return input + output;
}

/**
 * Test/reset helper — call after mutating the environment so the next
 * `priceFor` / `getCatalog` rebuilds from the new env.
 */
export function resetCostCatalogCache(): void {
  cachedCatalog = null;
  cachedMatchEntries = null;
}

function loadCatalog(): ModelPriceCatalog {
  if (cachedCatalog) return cachedCatalog;
  const override = loadOverride();
  cachedCatalog = { ...DEFAULT_PRICES, ...override };
  cachedMatchEntries = null;
  return cachedCatalog;
}

function loadMatchEntries(): Array<[string, ModelPrice]> {
  if (cachedMatchEntries) return cachedMatchEntries;
  const catalog = loadCatalog();
  cachedMatchEntries = Object.entries(catalog)
    .map(([key, price]) => [key.toLowerCase(), price] as [string, ModelPrice])
    .sort((a, b) => b[0].length - a[0].length);
  return cachedMatchEntries;
}

function loadOverride(): ModelPriceCatalog {
  const path = process.env.AUTOTEL_LLM_PRICES_JSON;
  if (!path) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isCatalogShape(parsed)) {
      console.error(
        `[autotel-mcp] AUTOTEL_LLM_PRICES_JSON at ${path} has wrong shape; ignoring.`,
      );
      return {};
    }
    return parsed;
  } catch (error) {
    console.error(
      `[autotel-mcp] Failed to load AUTOTEL_LLM_PRICES_JSON from ${path}:`,
      error instanceof Error ? error.message : String(error),
    );
    return {};
  }
}

function isCatalogShape(value: unknown): value is ModelPriceCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (entry): entry is ModelPrice =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as ModelPrice).inputPerMtok === 'number' &&
      typeof (entry as ModelPrice).outputPerMtok === 'number',
  );
}
