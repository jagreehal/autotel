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
export type RefusalKind =
  | 'download_failed'
  | 'feature_disabled'
  | 'sampling_incompatible'
  | 'service_unavailable'
  | 'user_activation_required';

/**
 * `user_activation_required` is measured: on Canary 159 a `create()` that
 * would have to download, called with no gesture, rejects with `NotAllowedError:
 * Requires a user gesture when availability is "downloading" or
 * "downloadable".` A permissions-policy refusal shares the name, so it is only
 * classified when the message names the gesture; `builtin_ai.create
 * .user_activation` on the span answers it either way. `download_failed` is
 * still from the explainer: a failed model download rejects with a
 * `NetworkError`.
 */
export function describeRefusal(
  message: string,
  name = '',
): RefusalKind | undefined {
  if (/speculative decoding/i.test(message)) return 'sampling_incompatible';
  if (/service is not running/i.test(message)) return 'service_unavailable';
  // Measured on Canary when model execution is switched off by flags or
  // policy: every create() refuses with this, whatever its options.
  if (/feature flag gating model execution/i.test(message)) {
    return 'feature_disabled';
  }
  if (name === 'NetworkError') return 'download_failed';
  if (name === 'NotAllowedError' && /gesture|activation/i.test(message)) {
    return 'user_activation_required';
  }
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
   * A model was actually fetched, or `undefined` when that cannot be known.
   *
   * The monitor fires either way: on a browser that already has the model,
   * `create()` emits `loaded: 0` then `loaded: 1` within a few milliseconds.
   * So "the monitor fired" is not "a download ran". Two things separate them:
   * a fractional progress event, which only a real fetch produces, and the
   * availability answer from *before* the call. With neither, it is
   * undecidable.
   */
  real: boolean | undefined;
}

export function describeDownload(
  before: Availability | undefined,
  loaded: readonly number[],
): DownloadFacts {
  const fractional = loaded.some((value) => value > 0 && value < 1);
  const observed = loaded.length > 0;
  let real: boolean | undefined;
  if (fractional) real = true;
  else if (before !== undefined) {
    real = observed && (before === 'downloadable' || before === 'downloading');
  }
  return { events: loaded.length, lastLoaded: loaded.at(-1), observed, real };
}

/**
 * Whether a bare `availability()` disagrees with one passed the options the
 * caller went on to create with.
 *
 * The trap, as measured on Canary 154 with speculative decoding enabled, and a
 * model downloaded and working:
 *
 *   availability()                                  -> 'unavailable'
 *   availability({samplingMode:'most-predictable'})  -> 'available'
 *   create({samplingMode:'most-predictable'})        -> succeeds
 *
 * So the documented guard — `availability() !== 'available'` — refused to run
 * on a browser where the call would have worked. On Canary 159 that flag is no
 * longer offered and both answers agree; this stays for the Chrome that brings
 * it back. Passing the guard the same options as the `create()` it guards
 * avoids it either way.
 */
export function guardWouldRefuse(
  bare: Availability,
  withOptions: Availability,
): boolean {
  return bare !== 'available' && withOptions === 'available';
}
