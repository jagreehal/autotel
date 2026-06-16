import { describe, expect, it } from 'vitest';
import {
  GEN_AI_COST_USD_BUCKETS,
  GEN_AI_DURATION_BUCKETS_SECONDS,
  GEN_AI_TOKEN_USAGE_BUCKETS,
  genAiMetricViews,
  llmHistogramAdvice,
} from './metrics.js';

describe('bucket arrays', () => {
  it('are sorted ascending and frozen', () => {
    for (const arr of [
      GEN_AI_DURATION_BUCKETS_SECONDS,
      GEN_AI_TOKEN_USAGE_BUCKETS,
      GEN_AI_COST_USD_BUCKETS,
    ]) {
      expect(Object.isFrozen(arr)).toBe(true);
      const sorted = [...arr].sort((a, b) => a - b);
      expect([...arr]).toEqual(sorted);
    }
  });

  it('token buckets follow the spec advice (1 … 67M)', () => {
    expect(GEN_AI_TOKEN_USAGE_BUCKETS[0]).toBe(1);
    expect(GEN_AI_TOKEN_USAGE_BUCKETS.at(-1)).toBe(67_108_864);
  });
});

describe('llmHistogramAdvice', () => {
  it('returns a fresh mutable copy of the boundaries', () => {
    const a = llmHistogramAdvice('duration');
    expect(a.advice.explicitBucketBoundaries).toEqual([
      ...GEN_AI_DURATION_BUCKETS_SECONDS,
    ]);
    a.advice.explicitBucketBoundaries.push(999);
    expect(GEN_AI_DURATION_BUCKETS_SECONDS).not.toContain(999);
  });
});

describe('genAiMetricViews', () => {
  it('covers the canonical client instruments plus cost', () => {
    const names = genAiMetricViews().map((v) => v.instrumentName);
    expect(names).toEqual(
      expect.arrayContaining([
        'gen_ai.client.operation.duration',
        'gen_ai.client.operation.time_to_first_chunk',
        'gen_ai.client.operation.time_per_output_chunk',
        'gen_ai.client.token.usage',
        'gen_ai.client.cost.usd',
      ]),
    );
  });

  it('appends extra instruments', () => {
    const names = genAiMetricViews([
      { instrumentName: 'my.custom.tokens', kind: 'tokens' },
    ]).map((v) => v.instrumentName);
    expect(names).toContain('my.custom.tokens');
  });
});
