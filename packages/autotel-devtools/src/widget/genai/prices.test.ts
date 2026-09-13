import { describe, it, expect } from 'vitest';
import { lookupPrice, priceCall } from './prices';

describe('lookupPrice — current Claude generation', () => {
  it('prices Claude Code model ids, [1m] context suffix included', () => {
    expect(lookupPrice('anthropic', 'claude-opus-5[1m]')).toMatchObject({
      inputPerMTok: 5,
      outputPerMTok: 25,
    });
    expect(lookupPrice('anthropic', 'claude-haiku-4-5-20251001')).toMatchObject(
      { inputPerMTok: 1, outputPerMTok: 5 },
    );
  });

  it('does not let claude-opus-4-x fall through to the claude-opus-4 row', () => {
    expect(lookupPrice('anthropic', 'claude-opus-4-6')?.inputPerMTok).toBe(5);
    expect(lookupPrice('anthropic', 'claude-opus-4')?.inputPerMTok).toBe(15);
    expect(lookupPrice('anthropic', 'claude-sonnet-5')?.inputPerMTok).toBe(2);
    expect(lookupPrice('anthropic', 'claude-sonnet-4-6')?.inputPerMTok).toBe(3);
  });

  it('prices a Claude Code call, cache tokens at the discounted rates', () => {
    const cost = priceCall({
      provider: 'anthropic',
      model: 'claude-opus-5[1m]',
      inputTokens: 2 + 10010 + 18412,
      outputTokens: 83,
      cacheReadInputTokens: 10010,
      cacheCreationInputTokens: 18412,
    });
    expect(cost.source).toBe('table');
    expect(cost.input).toBeCloseTo((2 / 1e6) * 5, 12);
    expect(cost.cacheRead).toBeCloseTo((10010 / 1e6) * 0.5, 12);
    expect(cost.cacheWrite).toBeCloseTo((18412 / 1e6) * 6.25, 12);
  });
});
