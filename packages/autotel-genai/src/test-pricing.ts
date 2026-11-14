/**
 * Test-only prices, registered for every test file by `vitest.config.ts`.
 * autotel ships no prices; these fixed figures let the cost tests check the
 * arithmetic. Not exported from the package.
 */
import { registerModelPricing, type ModelPricing } from './cost.js';

/** Per-call tool prices the fixture models carry. */
const TOOLS = { web_search: 10, file_search: 2.5 };

const TABLE: Record<string, Omit<ModelPricing, 'serverToolPer1K'>> = {
  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10, cachedInputPer1M: 1.25 },
  'gpt-4o-mini': {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    cachedInputPer1M: 0.075,
  },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8, cachedInputPer1M: 0.5 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6, cachedInputPer1M: 0.1 },
  'gpt-4.1-nano': {
    inputPer1M: 0.1,
    outputPer1M: 0.4,
    cachedInputPer1M: 0.025,
  },
  'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4, cachedInputPer1M: 0.55 },
  // Anthropic Claude (cache read ~0.1×, cache write ~1.25×)
  'claude-opus-4': {
    inputPer1M: 15,
    outputPer1M: 75,
    cachedInputPer1M: 1.5,
    cacheWritePer1M: 18.75,
  },
  'claude-sonnet-4': {
    inputPer1M: 3,
    outputPer1M: 15,
    cachedInputPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  'claude-3-5-sonnet': {
    inputPer1M: 3,
    outputPer1M: 15,
    cachedInputPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  'claude-3-5-haiku': {
    inputPer1M: 0.8,
    outputPer1M: 4,
    cachedInputPer1M: 0.08,
    cacheWritePer1M: 1,
  },
  'claude-3-opus': { inputPer1M: 15, outputPer1M: 75 },
  'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
  // Google Gemini
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
};

export const TEST_PRICING: Record<string, ModelPricing> = Object.fromEntries(
  Object.entries(TABLE).map(([model, price]) => [
    model,
    { ...price, serverToolPer1K: TOOLS },
  ]),
);

registerModelPricing(TEST_PRICING);
