/**
 * Facts about what Chrome's built-in AI actually did, as opposed to what was
 * asked for. Behaviour recorded from measurement on Canary 154.0.8034.0, not
 * read from the specification — the two disagree in the places these helpers
 * exist to catch.
 */

import type { Availability, CreateOptions } from './types';
import { isCountable } from './types';

/**
 * Which sampling knob a `create()` call used.
 *
 * Worth recording because the session cannot be asked afterwards:
 * `session.samplingMode` reads back `null` for `topK` and `temperature`, so
 * without this a session created those ways has no recoverable sampling shape.
 */
export type SamplingOption =
  'none' | 'samplingMode' | 'temperature' | 'topK' | 'topK+temperature';

export function describeSamplingOption(
  options: CreateOptions | undefined,
): SamplingOption {
  if (options === undefined) return 'none';
  if (options.samplingMode !== undefined) return 'samplingMode';
  const hasTopK = isCountable(options.topK);
  const hasTemperature = isCountable(options.temperature);
  if (hasTopK && hasTemperature) return 'topK+temperature';
  if (hasTopK) return 'topK';
  if (hasTemperature) return 'temperature';
  return 'none';
}

/**
 * Why `create()` refused, in a form that carries no caller data.
 *
 * `sampling_incompatible` is the one worth alerting on. Speculative decoding
 * rejects unconstrained sampling and names three remedies — and on Canary 154
 * two of the three (`topK: 1`, `temperature: 0`) are refused by the same error
 * that recommends them. Only `samplingMode: 'most-predictable'` is accepted,
 * so a span carrying both this and `builtin_ai.create.sampling_option` says
 * whether an application hit that.
 */
export type RefusalKind = 'sampling_incompatible' | 'service_unavailable';

export function describeRefusal(message: string): RefusalKind | undefined {
  if (/speculative decoding/i.test(message)) return 'sampling_incompatible';
  if (/service is not running/i.test(message)) return 'service_unavailable';
  return undefined;
}

export interface DownloadFacts {
  /** How many `downloadprogress` events arrived. */
  events: number;
  /** The last fraction reported, when any arrived. */
  lastLoaded: number | undefined;
  /** Events arrived at all. */
  observed: boolean;
  /**
   * A model was actually fetched.
   *
   * The monitor fires either way: on a browser that already has the model,
   * `create()` emits two events ending at `loaded: 1` within a few
   * milliseconds. So "the monitor fired" cannot be read as "a download ran",
   * and the availability answer from *before* the call is the only thing that
   * separates them.
   */
  real: boolean;
}

export function describeDownload(
  before: Availability | undefined,
  loaded: readonly number[],
): DownloadFacts {
  return {
    events: loaded.length,
    lastLoaded: loaded.at(-1),
    observed: loaded.length > 0,
    real:
      loaded.length > 0 &&
      (before === 'downloadable' || before === 'downloading'),
  };
}

/**
 * Whether a bare `availability()` disagrees with one passed the options the
 * caller went on to create with.
 *
 * This is the trap. On Canary 154 with speculative decoding enabled, and a
 * model downloaded and working:
 *
 *   availability()                                  -> 'unavailable'
 *   availability({samplingMode:'most-predictable'})  -> 'available'
 *   create({samplingMode:'most-predictable'})        -> succeeds
 *
 * So the documented guard — `availability() !== 'available'` — refuses to run
 * on a browser where the call would have worked. `availability()` appears to
 * evaluate the options rather than report model readiness, and an application
 * has to pass the guard the same options as the `create()` it guards.
 */
export function guardWouldRefuse(
  bare: Availability,
  withOptions: Availability,
): boolean {
  return bare !== 'available' && withOptions === 'available';
}
