/**
 * LLM-tuned histogram buckets.
 *
 * Default OpenTelemetry histogram buckets target HTTP latency (0ms–10s)
 * and small counter values. LLM workloads have very different shapes:
 *
 *   - **Duration**: single-token prompts can be fast (50ms), long
 *     generations and reasoning models can run for minutes. Default buckets
 *     crush everything above 10s into one bucket.
 *   - **Token usage**: heavily right-skewed. A single request can range
 *     from tens of tokens to the million-token context windows.
 *   - **Cost (USD)**: per-request values are tiny (fractions of a cent),
 *     so linear buckets waste resolution at the low end.
 *
 * This module exposes empirically-chosen bucket arrays and a View helper
 * so users can apply them to their `MeterProvider` without knowing the
 * exact instrument names emitted by OpenAI/Anthropic/Traceloop plugins.
 *
 * @example
 * ```typescript
 * import { NodeSDK } from '@opentelemetry/sdk-node';
 * import { genAiMetricViews } from 'autotel';
 *
 * const sdk = new NodeSDK({
 *   serviceName: 'my-agent',
 *   views: [...genAiMetricViews()],
 * });
 * sdk.start();
 * ```
 */

import { AggregationType, type ViewOptions } from '@opentelemetry/sdk-metrics';

/**
 * Duration buckets for LLM operations, in **seconds**. Covers fast
 * completions (50ms) through long-running reasoning jobs (5 min).
 *
 * Aligns with the OTel GenAI semantic conventions' published advice for
 * `gen_ai.client.operation.duration`.
 */
export const GEN_AI_DURATION_BUCKETS_SECONDS: readonly number[] = Object.freeze(
  [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300],
);

/**
 * Token-count buckets for prompt, completion, and total token histograms.
 * Ranges from tiny prompts to million-token context windows.
 *
 * Aligns with the OTel GenAI semantic conventions' published advice for
 * `gen_ai.client.token.usage`.
 */
export const GEN_AI_TOKEN_USAGE_BUCKETS: readonly number[] = Object.freeze([
  1, 4, 16, 64, 256, 1_024, 4_096, 16_384, 65_536, 262_144, 1_048_576,
  4_194_304,
]);

/**
 * USD cost buckets. Sub-cent resolution at the low end (fractions of a
 * cent per small call) up to tens of dollars (batch jobs, Opus/o1 runs).
 */
export const GEN_AI_COST_USD_BUCKETS: readonly number[] = Object.freeze([
  0.000_01, 0.000_1, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50,
]);

/**
 * Instrument-level advice object for `createHistogram(name, advice)`.
 * Use when you control the instrument creation (e.g. custom business
 * LLM metrics); `genAiMetricViews()` is better when the metric comes
 * from a third-party plugin.
 */
export function llmHistogramAdvice(kind: 'duration' | 'tokens' | 'cost'): {
  advice: { explicitBucketBoundaries: number[] };
} {
  const boundaries =
    kind === 'duration'
      ? GEN_AI_DURATION_BUCKETS_SECONDS
      : kind === 'tokens'
        ? GEN_AI_TOKEN_USAGE_BUCKETS
        : GEN_AI_COST_USD_BUCKETS;
  return { advice: { explicitBucketBoundaries: [...boundaries] } };
}

/**
 * Returns `View`s that re-bucket the standard OTel GenAI histograms. Pass
 * the result to your `MeterProvider`'s `views` option.
 *
 * Matches instrument names emitted by:
 * - OpenTelemetry GenAI autoinstrumentation
 * - OpenInference / OpenLLMetry (traceloop)
 * - Arize Phoenix, LangSmith, etc. that follow the OTel spec
 *
 * Add more instrument patterns via the `extra` argument if you emit
 * custom LLM metrics.
 */
export function genAiMetricViews(
  extra: {
    instrumentName: string;
    kind: 'duration' | 'tokens' | 'cost';
  }[] = [],
): ViewOptions[] {
  const defaults: Array<{
    instrumentName: string;
    kind: 'duration' | 'tokens' | 'cost';
  }> = [
    { instrumentName: 'gen_ai.client.operation.duration', kind: 'duration' },
    { instrumentName: 'gen_ai.client.token.usage', kind: 'tokens' },
    // Autotel-emitted cost metric. No-op if you don't emit it.
    { instrumentName: 'gen_ai.client.cost.usd', kind: 'cost' },
  ];

  return [...defaults, ...extra].map(
    ({ instrumentName, kind }) =>
      ({
        instrumentName,
        aggregation: {
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
          options: {
            boundaries:
              kind === 'duration'
                ? [...GEN_AI_DURATION_BUCKETS_SECONDS]
                : kind === 'tokens'
                  ? [...GEN_AI_TOKEN_USAGE_BUCKETS]
                  : [...GEN_AI_COST_USD_BUCKETS],
          },
        },
      }) satisfies ViewOptions,
  );
}
