import { describe, expect, it } from 'vitest';
import { AggregationType } from '@opentelemetry/sdk-metrics';
import {
  GEN_AI_COST_USD_BUCKETS,
  GEN_AI_DURATION_BUCKETS_SECONDS,
  GEN_AI_TOKEN_USAGE_BUCKETS,
  genAiMetricViews,
  llmHistogramAdvice,
} from './gen-ai-metrics';

describe('gen-ai-metrics', () => {
  it('bucket arrays are strictly ascending (required by Prometheus + OTel)', () => {
    for (const buckets of [
      GEN_AI_DURATION_BUCKETS_SECONDS,
      GEN_AI_TOKEN_USAGE_BUCKETS,
      GEN_AI_COST_USD_BUCKETS,
    ]) {
      for (let i = 1; i < buckets.length; i++) {
        expect(
          buckets[i]! > buckets[i - 1]!,
          `index ${i} not ascending: ${buckets[i - 1]} → ${buckets[i]}`,
        ).toBe(true);
      }
    }
  });

  it('duration buckets cover tail through 5 minutes for reasoning models', () => {
    expect(GEN_AI_DURATION_BUCKETS_SECONDS[0]).toBeLessThanOrEqual(0.05);
    expect(
      GEN_AI_DURATION_BUCKETS_SECONDS[
        GEN_AI_DURATION_BUCKETS_SECONDS.length - 1
      ],
    ).toBeGreaterThanOrEqual(300);
  });

  it('token buckets cover up to a million-token context window', () => {
    expect(
      GEN_AI_TOKEN_USAGE_BUCKETS[GEN_AI_TOKEN_USAGE_BUCKETS.length - 1],
    ).toBeGreaterThanOrEqual(1_000_000);
  });

  it('cost buckets resolve sub-cent spend', () => {
    expect(GEN_AI_COST_USD_BUCKETS[0]).toBeLessThan(0.001);
  });

  it('bucket arrays are frozen — consumers cannot mutate shared state', () => {
    expect(() => {
      (GEN_AI_DURATION_BUCKETS_SECONDS as number[]).push(999);
    }).toThrow();
  });

  it('llmHistogramAdvice returns explicitBucketBoundaries advice shape', () => {
    const advice = llmHistogramAdvice('duration');
    expect(advice.advice.explicitBucketBoundaries).toEqual([
      ...GEN_AI_DURATION_BUCKETS_SECONDS,
    ]);
    // The returned array is a fresh copy so callers can mutate without
    // affecting the shared constant.
    advice.advice.explicitBucketBoundaries.push(0);
    expect([...GEN_AI_DURATION_BUCKETS_SECONDS]).not.toContain(0);
  });

  it('genAiMetricViews targets the OTel GenAI instrument names with the right buckets', () => {
    const views = genAiMetricViews();
    expect(views).toHaveLength(3);

    const byInstrument = Object.fromEntries(
      views.map((v) => [v.instrumentName, v]),
    );
    expect(
      byInstrument['gen_ai.client.operation.duration']?.aggregation,
    ).toEqual({
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: [...GEN_AI_DURATION_BUCKETS_SECONDS] },
    });
    expect(byInstrument['gen_ai.client.token.usage']?.aggregation).toEqual({
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: [...GEN_AI_TOKEN_USAGE_BUCKETS] },
    });
    expect(byInstrument['gen_ai.client.cost.usd']?.aggregation).toEqual({
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: [...GEN_AI_COST_USD_BUCKETS] },
    });
  });

  it('genAiMetricViews accepts extra instruments', () => {
    const views = genAiMetricViews([
      { instrumentName: 'custom.llm.prompt_tokens', kind: 'tokens' },
    ]);
    expect(views).toHaveLength(4);
    const custom = views.find(
      (v) => v.instrumentName === 'custom.llm.prompt_tokens',
    );
    expect(custom).toBeDefined();
  });
});
