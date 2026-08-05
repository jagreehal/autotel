/**
 * LLM-tuned histogram buckets and Views.
 *
 * Default OpenTelemetry histogram buckets target HTTP latency (0ms–10s) and
 * small counter values. GenAI workloads have very different shapes:
 *
 *   - **Duration**: single-token prompts can be fast (50ms); long generations
 *     and reasoning models run for minutes. Default buckets crush everything
 *     above 10s into one bucket.
 *   - **Token usage**: heavily right-skewed, from tens of tokens to
 *     million-token context windows.
 *   - **Cost (USD)**: per-request values are tiny (fractions of a cent), so
 *     linear buckets waste resolution at the low end.
 *
 * This module exposes empirically-chosen bucket arrays and a View helper so you
 * can apply them to your `MeterProvider` without knowing the exact instrument
 * names emitted by OpenAI/Anthropic/Traceloop/AI-SDK plugins. Bucket boundaries
 * match the advice published in the OpenTelemetry GenAI semantic conventions.
 *
 * @example
 * ```typescript
 * import { NodeSDK } from '@opentelemetry/sdk-node';
 * import { genAiMetricViews } from 'autotel-genai/metrics';
 *
 * const sdk = new NodeSDK({
 *   serviceName: 'my-agent',
 *   views: [...genAiMetricViews()],
 * });
 * sdk.start();
 * ```
 */

import {
  metrics as otelMetrics,
  type Attributes,
  type Histogram,
  type MeterProvider,
} from '@opentelemetry/api';
import { AggregationType, type ViewOptions } from '@opentelemetry/sdk-metrics';
import { GEN_AI, GEN_AI_METRIC } from './semconv.js';

const TOKEN_TYPE = GEN_AI.TOKEN_TYPE;

/**
 * Duration buckets for GenAI operations, in **seconds**. Matches the spec's
 * advice for `gen_ai.client.operation.duration` and the streaming-timing
 * metrics (`time_to_first_chunk`, `time_per_output_chunk`).
 */
export const GEN_AI_DURATION_BUCKETS_SECONDS: readonly number[] = Object.freeze(
  [
    0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48,
    40.96, 81.92,
  ],
);

/**
 * Token-count buckets for `gen_ai.client.token.usage`. Matches the spec's
 * published advice — tiny prompts through million-token context windows.
 */
export const GEN_AI_TOKEN_USAGE_BUCKETS: readonly number[] = Object.freeze([
  1, 4, 16, 64, 256, 1_024, 4_096, 16_384, 65_536, 262_144, 1_048_576,
  4_194_304, 16_777_216, 67_108_864,
]);

/**
 * USD cost buckets. Sub-cent resolution at the low end (fractions of a cent per
 * small call) up to tens of dollars (batch jobs, Opus/o-series runs).
 */
export const GEN_AI_COST_USD_BUCKETS: readonly number[] = Object.freeze([
  0.000_01, 0.000_1, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50,
]);

/** Histogram bucket family. */
export type GenAiHistogramKind = 'duration' | 'tokens' | 'cost';

function boundariesFor(kind: GenAiHistogramKind): number[] {
  switch (kind) {
    case 'duration': {
      return [...GEN_AI_DURATION_BUCKETS_SECONDS];
    }
    case 'tokens': {
      return [...GEN_AI_TOKEN_USAGE_BUCKETS];
    }
    case 'cost': {
      return [...GEN_AI_COST_USD_BUCKETS];
    }
  }
}

/**
 * Instrument-level advice object for `createHistogram(name, advice)`. Use when
 * you control instrument creation (e.g. custom business GenAI metrics);
 * {@link genAiMetricViews} is better when the metric comes from a plugin.
 */
export function llmHistogramAdvice(kind: GenAiHistogramKind): {
  advice: { explicitBucketBoundaries: number[] };
} {
  return { advice: { explicitBucketBoundaries: boundariesFor(kind) } };
}

/**
 * Returns `View`s that re-bucket the standard OpenTelemetry GenAI histograms.
 * Pass the result to your `MeterProvider`'s `views` option.
 *
 * Covers the canonical GenAI instruments:
 * - `gen_ai.client.operation.duration`
 * - `gen_ai.client.operation.time_to_first_chunk`
 * - `gen_ai.client.operation.time_per_output_chunk`
 * - `gen_ai.client.token.usage`
 * - `gen_ai.workflow.duration`
 * - `gen_ai.client.cost.usd` (autotel extension; no-op if not emitted)
 *
 * Add more instrument patterns via `extra` if you emit custom GenAI metrics.
 */
export function genAiMetricViews(
  extra: { instrumentName: string; kind: GenAiHistogramKind }[] = [],
): ViewOptions[] {
  const defaults: Array<{ instrumentName: string; kind: GenAiHistogramKind }> =
    [
      { instrumentName: GEN_AI_METRIC.OPERATION_DURATION, kind: 'duration' },
      { instrumentName: GEN_AI_METRIC.TIME_TO_FIRST_CHUNK, kind: 'duration' },
      { instrumentName: GEN_AI_METRIC.TIME_PER_OUTPUT_CHUNK, kind: 'duration' },
      { instrumentName: GEN_AI_METRIC.WORKFLOW_DURATION, kind: 'duration' },
      { instrumentName: GEN_AI_METRIC.TOKEN_USAGE, kind: 'tokens' },
      // Autotel-emitted cost metric. No-op if you don't emit it.
      { instrumentName: GEN_AI_METRIC.COST_USD, kind: 'cost' },
    ];

  return [...defaults, ...extra].map(
    ({ instrumentName, kind }) =>
      ({
        instrumentName,
        aggregation: {
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
          options: { boundaries: boundariesFor(kind) },
        },
      }) satisfies ViewOptions,
  );
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/** One completed GenAI operation, as {@link recordGenAiMetrics} needs it. */
export interface GenAiMetricInput {
  /** Wall-clock seconds for the operation. */
  durationSeconds: number;
  /** Attributes shared by every instrument: operation, provider, model. */
  attributes: Attributes;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  timeToFirstChunk?: number;
}

interface GenAiInstruments {
  duration: Histogram;
  tokens: Histogram;
  cost: Histogram;
  timeToFirstChunk: Histogram;
}

let instruments: GenAiInstruments | undefined;
let instrumentsProvider: MeterProvider | undefined;

/**
 * Instruments are created on first record and cached against the provider they
 * came from. Keyed on the provider because a `shutdown()` / `init()` cycle —
 * hot reload, a test suite, a serverless container re-initialising — installs a
 * new one, and instruments bound to the old one record into nothing.
 */
function getInstruments(): GenAiInstruments {
  const provider = otelMetrics.getMeterProvider();
  if (!instruments || instrumentsProvider !== provider) {
    instrumentsProvider = provider;
    const meter = provider.getMeter('autotel-genai');
    instruments = {
      duration: meter.createHistogram(GEN_AI_METRIC.OPERATION_DURATION, {
        description: 'GenAI operation duration',
        unit: 's',
        ...llmHistogramAdvice('duration'),
      }),
      tokens: meter.createHistogram(GEN_AI_METRIC.TOKEN_USAGE, {
        description: 'Tokens consumed by a GenAI operation',
        unit: '{token}',
        ...llmHistogramAdvice('tokens'),
      }),
      cost: meter.createHistogram(GEN_AI_METRIC.COST_USD, {
        description: 'Estimated USD cost of a GenAI operation',
        unit: '{USD}',
        ...llmHistogramAdvice('cost'),
      }),
      timeToFirstChunk: meter.createHistogram(
        GEN_AI_METRIC.TIME_TO_FIRST_CHUNK,
        {
          description: 'Seconds from request start to the first streamed chunk',
          unit: 's',
          ...llmHistogramAdvice('duration'),
        },
      ),
    };
  }
  return instruments;
}

/**
 * Drop the cached instruments so the next record rebuilds them against the
 * current `MeterProvider`.
 *
 * @internal Exported for tests that swap providers between cases. Production
 * code registers one provider in `init()` and never needs this.
 */
export function resetGenAiInstruments(): void {
  instruments = undefined;
  instrumentsProvider = undefined;
}

/**
 * Record the canonical GenAI metrics for one completed operation.
 *
 * Called by `traceGenAI`; you only need it when instrumenting a GenAI call
 * some other way. Without a registered `MeterProvider` every call is a no-op,
 * so this costs nothing in a traces-only setup.
 */
export function recordGenAiMetrics(input: GenAiMetricInput): void {
  const { duration, tokens, cost, timeToFirstChunk } = getInstruments();
  const attributes = input.attributes;

  duration.record(input.durationSeconds, attributes);

  if (input.inputTokens !== undefined) {
    tokens.record(input.inputTokens, { ...attributes, [TOKEN_TYPE]: 'input' });
  }
  if (input.outputTokens !== undefined) {
    tokens.record(input.outputTokens, {
      ...attributes,
      [TOKEN_TYPE]: 'output',
    });
  }
  if (input.costUsd !== undefined) {
    cost.record(input.costUsd, attributes);
  }
  if (input.timeToFirstChunk !== undefined) {
    timeToFirstChunk.record(input.timeToFirstChunk, attributes);
  }
}
