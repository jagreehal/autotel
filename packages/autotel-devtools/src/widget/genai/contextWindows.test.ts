import { describe, expect, it } from 'vitest';
import { lookupContextWindow } from './contextWindows';

describe('lookupContextWindow', () => {
  it('resolves a known model', () => {
    expect(lookupContextWindow('openai', 'gpt-4o')).toBe(128_000);
    expect(lookupContextWindow('anthropic', 'claude-sonnet-4')).toBe(200_000);
  });

  it('matches versioned suffixes by longest prefix', () => {
    expect(lookupContextWindow('openai', 'gpt-4o-mini-2024-07-18')).toBe(
      128_000,
    );
    // Longer prefix `gpt-4o-mini` must win over `gpt-4o`.
    expect(lookupContextWindow('openai', 'gpt-4o-mini')).toBe(128_000);
  });

  it('normalises provider aliases', () => {
    expect(lookupContextWindow('azure_openai', 'gpt-4o')).toBe(128_000);
    expect(lookupContextWindow('vertex_ai', 'gemini-1.5-pro')).toBe(2_097_152);
  });

  it('is case-insensitive', () => {
    expect(lookupContextWindow('OpenAI', 'GPT-4o')).toBe(128_000);
  });

  it('returns undefined for unknown models', () => {
    expect(lookupContextWindow('openai', 'some-future-model')).toBeUndefined();
    expect(lookupContextWindow('unknown', 'unknown')).toBeUndefined();
  });
});
