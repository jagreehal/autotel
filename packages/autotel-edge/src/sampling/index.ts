/**
 * Sampling strategies for autotel-edge
 *
 * Provides intelligent sampling to reduce telemetry costs while capturing critical data.
 *
 * Key strategies:
 * - Always trace errors and slow requests (critical for debugging)
 * - Adaptive sampling based on load
 * - Baseline random sampling for normal traffic
 *
 * @example
 * ```typescript
 * import { createAdaptiveTailSampler } from 'autotel-edge/sampling'
 *
 * export default instrument(handler, {
 *   sampling: {
 *     tailSampler: createAdaptiveTailSampler({
 *       baselineSampleRate: 0.1,  // 10% of normal requests
 *       slowThresholdMs: 1000,     // Requests > 1s are "slow"
 *     })
 *   }
 * })
 * ```
 */

import type { TailSampleFn, LocalTrace } from '../types';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

export interface AdaptiveSamplerOptions {
  /**
   * Baseline sample rate for normal (successful, fast) requests
   * @default 0.1 (10%)
   */
  baselineSampleRate?: number;

  /**
   * Threshold in milliseconds for "slow" requests
   * Requests taking longer than this will always be trace
   * @default 1000ms
   */
  slowThresholdMs?: number;

  /**
   * Always trace error spans
   * @default true
   */
  alwaysSampleErrors?: boolean;

  /**
   * Always trace slow spans
   * @default true
   */
  alwaysSampleSlow?: boolean;
}

/**
 * Create an adaptive tail sampler
 *
 * This sampler ensures you never miss critical issues while keeping costs down:
 * - Always traces errors (status code = ERROR)
 * - Always traces slow requests (duration >= slowThresholdMs)
 * - Uses baseline sample rate for successful fast requests
 *
 * **Recommended for production use.**
 *
 * @example
 * ```typescript
 * const tailSampler = createAdaptiveTailSampler({
 *   baselineSampleRate: 0.1,    // 10% of normal requests
 *   slowThresholdMs: 1000,       // Requests > 1s are "slow"
 *   alwaysSampleErrors: true,    // Always trace errors
 *   alwaysSampleSlow: true       // Always trace slow requests
 * })
 * ```
 */
export function createAdaptiveTailSampler(
  options: AdaptiveSamplerOptions = {},
): TailSampleFn {
  const baselineSampleRate = options.baselineSampleRate ?? 0.1;
  const slowThresholdMs = options.slowThresholdMs ?? 1000;
  const alwaysSampleErrors = options.alwaysSampleErrors ?? true;
  const alwaysSampleSlow = options.alwaysSampleSlow ?? true;

  if (baselineSampleRate < 0 || baselineSampleRate > 1) {
    throw new Error('Baseline sample rate must be between 0 and 1');
  }

  // Store baseline decisions using trace ID
  const baselineDecisions = new Map<string, boolean>();

  return (traceInfo: LocalTrace): boolean => {
    const { traceId, localRootSpan } = traceInfo;

    // Get or create baseline decision for this trace
    if (!baselineDecisions.has(traceId)) {
      baselineDecisions.set(traceId, Math.random() < baselineSampleRate);
    }
    const baselineDecision = baselineDecisions.get(traceId)!;

    // Always keep errors (SpanStatusCode.ERROR = 2)
    if (alwaysSampleErrors && localRootSpan.status.code === 2) {
      return true;
    }

    // Always keep slow requests
    if (alwaysSampleSlow) {
      const duration = getDurationMs(localRootSpan);
      if (duration >= slowThresholdMs) {
        return true;
      }
    }

    // Otherwise, use baseline decision
    return baselineDecision;
  };
}

/**
 * Create a simple random tail sampler
 *
 * Samples a fixed percentage of all traces regardless of outcome.
 *
 * @example
 * ```typescript
 * const tailSampler = createRandomTailSampler(0.1) // 10% of all requests
 * ```
 */
export function createRandomTailSampler(sampleRate: number): TailSampleFn {
  if (sampleRate < 0 || sampleRate > 1) {
    throw new Error('Sample rate must be between 0 and 1');
  }

  const decisions = new Map<string, boolean>();

  return (traceInfo: LocalTrace): boolean => {
    const { traceId } = traceInfo;

    if (!decisions.has(traceId)) {
      decisions.set(traceId, Math.random() < sampleRate);
    }

    return decisions.get(traceId)!;
  };
}

/**
 * Create a tail sampler that keeps all errors
 *
 * Useful for debugging - captures all failures while dropping successful requests.
 *
 * @example
 * ```typescript
 * const tailSampler = createErrorOnlyTailSampler()
 * ```
 */
export function createErrorOnlyTailSampler(): TailSampleFn {
  return (traceInfo: LocalTrace): boolean => {
    // SpanStatusCode.ERROR = 2
    return traceInfo.localRootSpan.status.code === 2;
  };
}

/**
 * Create a tail sampler that keeps slow requests
 *
 * Useful for performance debugging - captures slow requests while dropping fast ones.
 *
 * @example
 * ```typescript
 * const tailSampler = createSlowOnlyTailSampler(1000) // Keep requests > 1s
 * ```
 */
export function createSlowOnlyTailSampler(thresholdMs: number): TailSampleFn {
  return (traceInfo: LocalTrace): boolean => {
    const duration = getDurationMs(traceInfo.localRootSpan);
    return duration >= thresholdMs;
  };
}

/**
 * Combine multiple tail samplers with OR logic
 *
 * Keeps a trace if ANY sampler returns true.
 *
 * @example
 * ```typescript
 * const tailSampler = combineTailSamplers(
 *   createErrorOnlyTailSampler(),
 *   createSlowOnlyTailSampler(1000),
 *   createRandomTailSampler(0.01)  // 1% baseline
 * )
 * ```
 */
export function combineTailSamplers(...samplers: TailSampleFn[]): TailSampleFn {
  if (samplers.length === 0) {
    throw new Error('combineTailSamplers requires at least one sampler');
  }

  return (traceInfo: LocalTrace): boolean => {
    return samplers.some((sampler) => sampler(traceInfo));
  };
}

/**
 * Create a tail sampler based on custom predicate
 *
 * @example
 * ```typescript
 * // Keep traces with specific attributes
 * const tailSampler = createCustomTailSampler((trace) => {
 *   const attrs = trace.localRootSpan.attributes
 *   return attrs['user.id'] === 'vip_123'
 * })
 * ```
 */
export function createCustomTailSampler(
  predicate: (traceInfo: LocalTrace) => boolean,
): TailSampleFn {
  return predicate;
}

/**
 * Helper: Get span duration in milliseconds
 */
function getDurationMs(span: ReadableSpan): number {
  const start = span.startTime[0] * 1000 + span.startTime[1] / 1_000_000;
  const end = span.endTime[0] * 1000 + span.endTime[1] / 1_000_000;
  return end - start;
}

/**
 * Common presets for quick setup
 */
export const SamplingPresets = {
  /**
   * Production: 10% baseline, all errors, all slow (>1s)
   * Recommended for most production workloads
   */
  production: (): TailSampleFn =>
    createAdaptiveTailSampler({
      baselineSampleRate: 0.1,
      slowThresholdMs: 1000,
    }),

  /**
   * High-traffic: 1% baseline, all errors, all slow (>2s)
   * For high-volume services where cost is a concern
   */
  highTraffic: (): TailSampleFn =>
    createAdaptiveTailSampler({
      baselineSampleRate: 0.01,
      slowThresholdMs: 2000,
    }),

  /**
   * Debugging: All errors, all slow (>500ms), 50% baseline
   * For active debugging sessions
   */
  debugging: (): TailSampleFn =>
    createAdaptiveTailSampler({
      baselineSampleRate: 0.5,
      slowThresholdMs: 500,
    }),

  /**
   * Development: 100% sampling
   * For local development and testing
   */
  development: (): TailSampleFn => () => true,

  /**
   * Errors only: Capture all failures, drop all successes
   * For error-focused monitoring
   */
  errorsOnly: (): TailSampleFn => createErrorOnlyTailSampler(),
};
