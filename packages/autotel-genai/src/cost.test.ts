import { describe, expect, it, vi } from 'vitest';
import {
  GEN_AI_COST_ATTRIBUTE,
  MODEL_PRICING,
  estimateLLMCost,
  recordLLMCost,
} from './cost.js';

describe('estimateLLMCost', () => {
  it('prices a known model from input + output tokens', () => {
    // gpt-4o: 2.5/1M in, 10/1M out
    expect(
      estimateLLMCost('gpt-4o', { inputTokens: 1000, outputTokens: 500 }),
    ).toBe(0.0075);
  });

  it('resolves versioned ids by longest-prefix match', () => {
    expect(
      estimateLLMCost('claude-sonnet-4-20250101', { inputTokens: 1_000_000 }),
    ).toBe(3);
  });

  it('returns undefined for an unknown model', () => {
    expect(
      estimateLLMCost('mystery-model', { inputTokens: 100 }),
    ).toBeUndefined();
  });

  it('prices cache-read tokens at the cached rate (subset of input)', () => {
    // gpt-4o cachedInputPer1M = 1.25; 1M input of which 1M cached → 1.25
    expect(
      estimateLLMCost('gpt-4o', {
        inputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
      }),
    ).toBe(1.25);
  });

  it('prices cache-creation tokens in addition at the write rate', () => {
    // claude-sonnet-4 cacheWritePer1M = 3.75
    expect(
      estimateLLMCost('claude-sonnet-4', {
        inputTokens: 0,
        cacheCreationInputTokens: 1_000_000,
      }),
    ).toBe(3.75);
  });

  it('honours a per-call pricing override', () => {
    expect(
      estimateLLMCost(
        'custom',
        { inputTokens: 1_000_000 },
        { pricing: { custom: { inputPer1M: 7, outputPer1M: 21 } } },
      ),
    ).toBe(7);
  });

  it('never goes negative when cache read exceeds input', () => {
    const cost = estimateLLMCost('gpt-4o', {
      inputTokens: 10,
      cacheReadInputTokens: 1000,
    });
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});

describe('recordLLMCost', () => {
  it('sets the cost attribute for a known model', () => {
    const setAttribute = vi.fn();
    const cost = recordLLMCost({ setAttribute }, 'gpt-4o', {
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(cost).toBe(0.0075);
    expect(setAttribute).toHaveBeenCalledWith(GEN_AI_COST_ATTRIBUTE, 0.0075);
  });

  it('records no cost figure for an unknown model', () => {
    // Superseded on the evidence label by the `recordLLMCost evidence` block
    // below: an unpriced model now says so on the span.
    const setAttribute = vi.fn();
    expect(
      recordLLMCost({ setAttribute }, 'mystery', { inputTokens: 1 }),
    ).toBeUndefined();
    expect(setAttribute).not.toHaveBeenCalledWith(
      GEN_AI_COST_ATTRIBUTE,
      expect.anything(),
    );
  });
});

describe('constants', () => {
  it('exposes the canonical cost attribute key', () => {
    expect(GEN_AI_COST_ATTRIBUTE).toBe('gen_ai.usage.cost.usd');
  });

  it('ships a non-empty default pricing table', () => {
    expect(Object.keys(MODEL_PRICING).length).toBeGreaterThan(0);
  });
});

describe('recordLLMCost evidence', () => {
  it('labels the cost as estimated, never as a reported figure', () => {
    // A price-table number and a provider-billed number are the same span
    // attribute. Without the label an estimate that is 30-50% out reads as
    // an invoice.
    const setAttribute = vi.fn();
    recordLLMCost({ setAttribute }, 'gpt-4o', {
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(setAttribute).toHaveBeenCalledWith(GEN_AI_COST_ATTRIBUTE, 0.0075);
    expect(setAttribute).toHaveBeenCalledWith(
      'autotel.evidence.cost',
      'estimated',
    );
  });

  it('labels an unpriced model unobservable instead of leaving it silent', () => {
    // No attribute at all is indistinguishable from a free call. The span has
    // to say the price table could not answer.
    const setAttribute = vi.fn();
    expect(
      recordLLMCost({ setAttribute }, 'mystery-model', { inputTokens: 100 }),
    ).toBeUndefined();
    expect(setAttribute).toHaveBeenCalledWith(
      'autotel.evidence.cost',
      'unobservable',
    );
    expect(setAttribute).not.toHaveBeenCalledWith(
      GEN_AI_COST_ATTRIBUTE,
      expect.anything(),
    );
  });
});
