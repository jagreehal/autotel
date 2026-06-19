/**
 * Streaming performance telemetry for GenAI calls.
 *
 * Streaming latency is two numbers, not one: **time to first chunk** (how long
 * the user waits before anything appears) and **throughput** (how fast tokens
 * arrive after that). A single duration hides both. This module computes the
 * full timing picture — TTFC, total response time, output throughput, and the
 * inter-chunk gap distribution — and records the headline values as canonical
 * `gen_ai.*` attributes, with the streaming-tuned histograms in `./metrics`.
 *
 * The shape mirrors the Vercel AI SDK's per-step performance record, exposed
 * here as a provider-agnostic helper.
 *
 * @example Time a stream with the helper
 * ```typescript
 * import { createStreamTimer, recordStreamTiming } from 'autotel-genai/streaming';
 *
 * export const chat = traceGenAI({ provider: 'openai', model: 'gpt-4o' })(
 *   (ctx) => async (prompt: string) => {
 *     const timer = createStreamTimer();
 *     let text = '';
 *     for await (const chunk of stream) {
 *       timer.chunk(); // first call also marks first-chunk time
 *       text += chunk;
 *     }
 *     const timing = timer.finish({ outputTokens: countTokens(text) });
 *     recordStreamTiming(ctx, timing);
 *     return text;
 *   },
 * );
 * ```
 */

import type { TraceContext } from 'autotel';
import { GEN_AI } from './semconv.js';

/** Distribution summary of the gaps between streamed output chunks (seconds). */
export interface ChunkIntervalStats {
  min: number;
  p10: number;
  median: number;
  avg: number;
  p90: number;
  max: number;
}

/** Computed streaming timing for one call. All durations are in **seconds**. */
export interface StreamTiming {
  /** Seconds from request start to the first streamed chunk. */
  timeToFirstChunk?: number;
  /** Seconds from request start to the final chunk (total response time). */
  timeToFinish: number;
  /** Output tokens ÷ total response time. `undefined` without token counts. */
  outputTokensPerSecond?: number;
  /**
   * Output tokens ÷ time _after_ the first chunk — the steady-state generation
   * rate, excluding the initial wait. `undefined` without enough data.
   */
  steadyOutputTokensPerSecond?: number;
  /** Mean seconds between streamed chunks. */
  timePerOutputChunk?: number;
  /** Number of chunks observed. */
  chunkCount: number;
  /** Distribution of inter-chunk gaps, when chunk timestamps were recorded. */
  chunkIntervals?: ChunkIntervalStats;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * Summarise the gaps between consecutive chunk timestamps (epoch ms). Returns
 * `undefined` for fewer than two intervals (no gap to measure).
 */
export function chunkIntervalStats(
  timestampsMs: readonly number[],
): ChunkIntervalStats | undefined {
  if (timestampsMs.length < 3) return undefined;
  const gaps: number[] = [];
  for (let i = 1; i < timestampsMs.length; i++) {
    gaps.push((timestampsMs[i] - timestampsMs[i - 1]) / 1000);
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const sum = gaps.reduce((acc, g) => acc + g, 0);
  return {
    min: round(sorted[0]),
    p10: round(percentile(sorted, 10)),
    median: round(percentile(sorted, 50)),
    avg: round(sum / gaps.length),
    p90: round(percentile(sorted, 90)),
    max: round(sorted[sorted.length - 1]),
  };
}

/** Inputs for {@link computeStreamTiming}. Timestamps are epoch ms. */
export interface ComputeStreamTimingInput {
  /** Request start time (epoch ms). */
  startTime: number;
  /** First-chunk time (epoch ms). Omit for a non-streamed response. */
  firstChunkTime?: number;
  /** Finish time (epoch ms). */
  finishTime: number;
  /** Output tokens generated, for throughput. */
  outputTokens?: number;
  /** Number of chunks observed (defaults to derived from timestamps). */
  chunkCount?: number;
  /** Per-chunk timestamps (epoch ms) for the inter-chunk distribution. */
  chunkTimestamps?: readonly number[];
}

/**
 * Compute {@link StreamTiming} from raw timestamps. Pure — no telemetry side
 * effects. Pair with {@link recordStreamTiming} to record the result.
 */
export function computeStreamTiming(
  input: ComputeStreamTimingInput,
): StreamTiming {
  const totalMs = Math.max(0, input.finishTime - input.startTime);
  const timeToFinish = totalMs / 1000;
  const timeToFirstChunk =
    input.firstChunkTime === undefined
      ? undefined
      : Math.max(0, input.firstChunkTime - input.startTime) / 1000;

  const intervals = input.chunkTimestamps
    ? chunkIntervalStats(input.chunkTimestamps)
    : undefined;
  const chunkCount =
    input.chunkCount ?? input.chunkTimestamps?.length ?? 0;

  let outputTokensPerSecond: number | undefined;
  let steadyOutputTokensPerSecond: number | undefined;
  if (input.outputTokens !== undefined && input.outputTokens > 0) {
    if (timeToFinish > 0) {
      outputTokensPerSecond = round(input.outputTokens / timeToFinish);
    }
    if (timeToFirstChunk !== undefined) {
      const afterFirst = timeToFinish - timeToFirstChunk;
      if (afterFirst > 0) {
        steadyOutputTokensPerSecond = round(input.outputTokens / afterFirst);
      }
    }
  }

  const timePerOutputChunk =
    intervals?.avg ??
    (chunkCount > 1 && timeToFirstChunk !== undefined
      ? round((timeToFinish - timeToFirstChunk) / (chunkCount - 1))
      : undefined);

  return {
    timeToFirstChunk:
      timeToFirstChunk === undefined ? undefined : round(timeToFirstChunk),
    timeToFinish: round(timeToFinish),
    outputTokensPerSecond,
    steadyOutputTokensPerSecond,
    timePerOutputChunk,
    chunkCount,
    chunkIntervals: intervals,
  };
}

/**
 * Record the headline streaming-timing attributes on the active span:
 * `gen_ai.response.time_to_first_chunk` (spec) plus the autotel extensions
 * `gen_ai.response.time_to_finish`, `…output_tokens_per_second`, and
 * `…time_per_output_chunk`. All in seconds. Absent fields are skipped.
 */
export function recordStreamTiming(
  ctx: Pick<TraceContext, 'setAttributes'>,
  timing: StreamTiming,
): void {
  const attrs: Record<string, number> = {
    [GEN_AI.RESPONSE_TIME_TO_FINISH]: timing.timeToFinish,
  };
  if (timing.timeToFirstChunk !== undefined) {
    attrs[GEN_AI.RESPONSE_TIME_TO_FIRST_CHUNK] = timing.timeToFirstChunk;
  }
  if (timing.outputTokensPerSecond !== undefined) {
    attrs[GEN_AI.RESPONSE_OUTPUT_TOKENS_PER_SECOND] =
      timing.outputTokensPerSecond;
  }
  if (timing.timePerOutputChunk !== undefined) {
    attrs[GEN_AI.RESPONSE_TIME_PER_OUTPUT_CHUNK] = timing.timePerOutputChunk;
  }
  ctx.setAttributes(attrs);
}

/** A running stream timer. */
export interface StreamTimer {
  /**
   * Mark a streamed chunk. The first call also records the first-chunk time.
   * Cheap to call per chunk.
   */
  chunk(): void;
  /** Finalise and compute {@link StreamTiming}. */
  finish(usage?: { outputTokens?: number }): StreamTiming;
}

/**
 * Create a {@link StreamTimer} that timestamps chunks as they arrive. Call
 * {@link StreamTimer.chunk} once per streamed chunk and
 * {@link StreamTimer.finish} when the stream ends.
 *
 * @param now Clock injection point, for tests. Defaults to {@link Date.now}.
 */
export function createStreamTimer(now: () => number = Date.now): StreamTimer {
  const startTime = now();
  const timestamps: number[] = [];

  return {
    chunk() {
      timestamps.push(now());
    },
    finish(usage) {
      const finishTime = now();
      return computeStreamTiming({
        startTime,
        firstChunkTime: timestamps[0],
        finishTime,
        outputTokens: usage?.outputTokens,
        chunkCount: timestamps.length,
        chunkTimestamps: timestamps,
      });
    },
  };
}
