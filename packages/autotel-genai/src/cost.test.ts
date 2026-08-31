import { describe, expect, it, vi } from 'vitest';
import {
  GEN_AI_COST_ATTRIBUTE,
  MODEL_PRICING,
  estimateLLMCost,
  recordLLMCost,
  SERVER_TOOL_PRICING_PER_1K,
  unpricedServerTools,
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

describe('server-side tool cost', () => {
  it('bills web searches on top of tokens', () => {
    // claude-sonnet-4: 3/1M in; web_search 10/1k → 3 + 1
    expect(
      estimateLLMCost('claude-sonnet-4', {
        inputTokens: 1_000_000,
        serverToolCalls: { web_search: 100 },
      }),
    ).toBe(4);
  });

  it('bills several tools together', () => {
    // web_search 10/1k + file_search 2.5/1k
    expect(
      estimateLLMCost('gpt-4o', {
        serverToolCalls: { web_search: 1000, file_search: 1000 },
      }),
    ).toBe(12.5);
  });

  it('lets a model override the default tool rate', () => {
    expect(
      estimateLLMCost(
        'gpt-4o',
        { serverToolCalls: { web_search: 1000 } },
        {
          pricing: {
            'gpt-4o': {
              inputPer1M: 2.5,
              outputPer1M: 10,
              serverToolPer1K: { web_search: 25 },
            },
          },
        },
      ),
    ).toBe(25);
  });

  it('skips a tool it has no price for rather than guessing zero silently', () => {
    expect(
      estimateLLMCost('gpt-4o', {
        inputTokens: 1_000_000,
        serverToolCalls: { mystery_tool: 500 },
      }),
    ).toBe(2.5);
    expect(
      unpricedServerTools('gpt-4o', { serverToolCalls: { mystery_tool: 500 } }),
    ).toEqual(['mystery_tool']);
  });

  it('names no unpriced tools when every tool is priced', () => {
    expect(
      unpricedServerTools('gpt-4o', { serverToolCalls: { web_search: 1 } }),
    ).toEqual([]);
  });
});

describe('cache token accounting', () => {
  it('treats cache reads as a subset of input by default', () => {
    // gpt-4o: 1M input of which 1M cached → cached rate only
    expect(
      estimateLLMCost('gpt-4o', {
        inputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
      }),
    ).toBe(1.25);
  });

  it('bills cache reads in addition when the provider reports them exclusively', () => {
    expect(
      estimateLLMCost('gpt-4o', {
        inputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
        cacheTokensExclusive: true,
      }),
    ).toBe(3.75);
  });

  it('leaves cache writes additive either way', () => {
    const usage = {
      inputTokens: 1_000_000,
      cacheCreationInputTokens: 1_000_000,
    };
    // claude-sonnet-4: 3/1M input + 3.75/1M cache write
    expect(estimateLLMCost('claude-sonnet-4', usage)).toBe(6.75);
    expect(
      estimateLLMCost('claude-sonnet-4', {
        ...usage,
        cacheTokensExclusive: true,
      }),
    ).toBe(6.75);
  });
});

describe('recordLLMCost provenance', () => {
  it('names the tools it could not price', () => {
    const setAttribute = vi.fn();
    recordLLMCost({ setAttribute }, 'gpt-4o', {
      inputTokens: 1000,
      serverToolCalls: { web_search: 10, mystery_tool: 1 },
    });
    expect(setAttribute).toHaveBeenCalledWith(
      'gen_ai.usage.cost.unpriced_tools',
      ['mystery_tool'],
    );
  });

  it('says nothing about unpriced tools when there are none', () => {
    const setAttribute = vi.fn();
    recordLLMCost({ setAttribute }, 'gpt-4o', { inputTokens: 1000 });
    expect(setAttribute).not.toHaveBeenCalledWith(
      'gen_ai.usage.cost.unpriced_tools',
      expect.anything(),
    );
  });
});

describe('server-tool pricing covers only per-call billing', () => {
  it('prices only tools that providers actually bill per call', () => {
    // web_search and file_search are billed per call. Nothing else may be here:
    // a per-1K table cannot express a session or duration price.
    expect(Object.keys(SERVER_TOOL_PRICING_PER_1K).toSorted()).toEqual([
      'file_search',
      'web_search',
    ]);
  });

  it('leaves code interpreter unpriced rather than guessing per call', () => {
    // OpenAI bills it per container session, Anthropic by execution time. Both
    // are wrong by orders of magnitude when charged per invocation.
    expect(
      estimateLLMCost('gpt-4o', {
        inputTokens: 1_000_000,
        serverToolCalls: { code_interpreter: 100 },
      }),
    ).toBe(2.5);
    expect(
      unpricedServerTools('gpt-4o', {
        serverToolCalls: { code_interpreter: 100 },
      }),
    ).toEqual(['code_interpreter']);
  });

  it('still lets a caller price it themselves when they know their bill', () => {
    expect(
      estimateLLMCost(
        'gpt-4o',
        { serverToolCalls: { code_interpreter: 1000 } },
        {
          pricing: {
            'gpt-4o': {
              inputPer1M: 2.5,
              outputPer1M: 10,
              serverToolPer1K: { code_interpreter: 30 },
            },
          },
        },
      ),
    ).toBe(30);
  });
});
