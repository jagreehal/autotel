import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  estimateCostUsd,
  priceFor,
  resetCostCatalogCache,
  getCatalog,
} from '../src/modules/llm-pricing';

describe('llm-pricing', () => {
  beforeEach(() => {
    delete process.env.AUTOTEL_LLM_PRICES_JSON;
    resetCostCatalogCache();
  });
  afterEach(() => {
    delete process.env.AUTOTEL_LLM_PRICES_JSON;
    resetCostCatalogCache();
  });

  it('returns null for unknown models rather than pretending cost is 0', () => {
    expect(priceFor('some-fictional-model')).toBeNull();
    expect(estimateCostUsd('some-fictional-model', 1000, 1000)).toBeNull();
  });

  it('returns null for undefined model', () => {
    expect(priceFor(undefined)).toBeNull();
    expect(estimateCostUsd(undefined, 1000, 1000)).toBeNull();
  });

  it('prices common Anthropic and OpenAI models at list rates', () => {
    // Claude Sonnet 4.6: $3 / $15 per Mtok → 1M in + 1M out = $3 + $15 = $18
    expect(estimateCostUsd('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBe(18);
    // GPT-4o: $2.50 / $10 per Mtok → 1M in + 1M out = $12.50
    expect(estimateCostUsd('gpt-4o', 1_000_000, 1_000_000)).toBe(12.5);
  });

  it('matches dated/variant model names via longest-prefix lookup', () => {
    // Dated variants should hit the base entry.
    expect(priceFor('claude-sonnet-4-6-20260119')?.inputPerMtok).toBe(3);
    expect(priceFor('gpt-4o-2024-11-20')?.inputPerMtok).toBe(2.5);
    // gpt-4o-mini must take precedence over gpt-4o.
    expect(priceFor('gpt-4o-mini-2024-07-18')?.inputPerMtok).toBe(0.15);
  });

  it('scales linearly with tokens', () => {
    // 1k input + 1k output on gpt-4o-mini: $0.15/Mtok * 0.001 + $0.60/Mtok * 0.001
    const cost = estimateCostUsd('gpt-4o-mini', 1000, 1000)!;
    expect(cost).toBeCloseTo(0.00015 + 0.0006, 10);
  });

  it('respects AUTOTEL_LLM_PRICES_JSON override', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autotel-prices-'));
    const path = join(dir, 'prices.json');
    writeFileSync(
      path,
      JSON.stringify({
        'my-custom-model': { inputPerMtok: 1.0, outputPerMtok: 2.0 },
        // Override an existing default to prove merge semantics.
        'gpt-4o': { inputPerMtok: 99, outputPerMtok: 999 },
      }),
    );
    process.env.AUTOTEL_LLM_PRICES_JSON = path;
    resetCostCatalogCache();

    expect(priceFor('my-custom-model')?.inputPerMtok).toBe(1);
    expect(priceFor('gpt-4o')?.inputPerMtok).toBe(99);
    // Override doesn't wipe the rest of the catalog.
    expect(priceFor('claude-sonnet-4-6')?.inputPerMtok).toBe(3);
  });

  it('ignores malformed override files without crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autotel-prices-bad-'));
    const path = join(dir, 'prices.json');
    writeFileSync(path, '{ not valid json');
    process.env.AUTOTEL_LLM_PRICES_JSON = path;
    resetCostCatalogCache();

    // Still works with defaults.
    expect(priceFor('gpt-4o')?.inputPerMtok).toBe(2.5);
  });

  it('catalog is readable and includes expected anchor models', () => {
    const catalog = getCatalog();
    expect(Object.keys(catalog)).toContain('gpt-4o');
    expect(Object.keys(catalog)).toContain('claude-sonnet-4-6');
  });
});
