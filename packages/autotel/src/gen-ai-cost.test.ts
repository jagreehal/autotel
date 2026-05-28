import { describe, it, expect, vi } from 'vitest';
import {
  estimateLLMCost,
  recordLLMCost,
  GEN_AI_COST_ATTRIBUTE,
} from './gen-ai-cost';

describe('estimateLLMCost', () => {
  it('estimates cost from input and output tokens', () => {
    // claude-sonnet-4: $3 / 1M in, $15 / 1M out
    const cost = estimateLLMCost('claude-sonnet-4', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(18);
  });

  it('matches versioned model ids by longest prefix', () => {
    const cost = estimateLLMCost('claude-sonnet-4-6-20251101', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(cost).toBe(3);
  });

  it('returns undefined for an unknown model', () => {
    expect(
      estimateLLMCost('totally-made-up', { inputTokens: 1000 }),
    ).toBeUndefined();
  });

  it('bills cached input tokens at the cached rate', () => {
    const pricing = {
      custom: { inputPer1M: 10, outputPer1M: 30, cachedInputPer1M: 1 },
    };
    // 1M input, of which 800k cached: 200k @ $10/M + 800k @ $1/M = 2 + 0.8
    const cost = estimateLLMCost(
      'custom',
      { inputTokens: 1_000_000, cachedInputTokens: 800_000 },
      { pricing },
    );
    expect(cost).toBeCloseTo(2.8, 6);
  });

  it('accepts a pricing override and extends the table', () => {
    const cost = estimateLLMCost(
      'my-model',
      { inputTokens: 500_000, outputTokens: 500_000 },
      { pricing: { 'my-model': { inputPer1M: 4, outputPer1M: 8 } } },
    );
    expect(cost).toBe(6);
  });

  it('handles partial usage without throwing', () => {
    expect(estimateLLMCost('gpt-4o-mini', {})).toBe(0);
    expect(estimateLLMCost('gpt-4o-mini', { outputTokens: 1_000_000 })).toBe(
      0.6,
    );
  });
});

describe('recordLLMCost', () => {
  it('sets the cost attribute on the context for a known model', () => {
    const setAttribute = vi.fn();
    const cost = recordLLMCost({ setAttribute }, 'gpt-4o', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(cost).toBe(2.5);
    expect(setAttribute).toHaveBeenCalledWith(GEN_AI_COST_ATTRIBUTE, 2.5);
  });

  it('sets no attribute for an unknown model', () => {
    const setAttribute = vi.fn();
    const cost = recordLLMCost({ setAttribute }, 'unknown-model', {
      inputTokens: 100,
    });
    expect(cost).toBeUndefined();
    expect(setAttribute).not.toHaveBeenCalled();
  });
});
