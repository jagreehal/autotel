/**
 * Changing what is captured without shipping a release.
 *
 * Instrumentation decisions are made at build time and regretted at 3am. The
 * sampling rate that was fine last week is drowning the collector; a browser
 * update has started throwing an error nobody can fix and it is burying
 * everything else. Both are one-line changes, and both otherwise wait for a
 * deploy, a CDN purge, and every user to reload.
 *
 * This is deliberately the small version: a JSON file at a URL the application
 * already controls — the same bucket or CDN path the app is served from. No
 * config service, no new endpoint to run, no vendor. autotel has nothing to
 * serve it from and should not grow one.
 *
 * The cache is what makes it usable: the last good config is read back
 * synchronously at startup, so the first spans of a visit already obey it, and
 * the network refresh happens behind them. A fetch that fails changes nothing.
 *
 * The file is untrusted input — anyone who can read the page can read it, and a
 * stale or tampered copy must not be able to do more than change capture
 * settings — so only known keys with valid values survive parsing.
 */

const STORAGE_KEY = 'autotel.remote-config';

import type { SuppressionRule } from './error-tracking/types';

const SUPPRESSION_KEYS = new Set(['type', 'value']);
const SUPPRESSION_OPERATORS = new Set(['exact', 'contains', 'regex']);

export interface RemoteConfig {
  /** Fraction of sessions to keep, 0..1. */
  sampleRate?: number;
  captureDeadClicks?: boolean;
  captureRageClicks?: boolean;
  captureEngagement?: boolean;
  /**
   * Exceptions to stop reporting, without a release. Same shape as
   * `errorTracking.suppressionRules`, so a rule can be moved between the two
   * without rewriting it.
   */
  errorSuppression?: SuppressionRule[];
}

let cached: RemoteConfig | undefined;
let readStorage = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A rule that does not match the shape the matcher understands suppresses
 * nothing, and "the errors stopped" is the most expensive way for a config file
 * to be wrong. Only fully-formed rules survive.
 */
function parseSuppression(value: unknown): SuppressionRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rules: SuppressionRule[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { key, operator, value: pattern } = entry;
    if (typeof key !== 'string' || !SUPPRESSION_KEYS.has(key)) continue;
    if (typeof operator !== 'string' || !SUPPRESSION_OPERATORS.has(operator))
      continue;
    if (typeof pattern !== 'string') continue;
    rules.push({ key, operator, value: pattern } as SuppressionRule);
  }
  return rules.length > 0 ? rules : undefined;
}

/**
 * Keep only what this version understands, and only where the value is usable.
 * An unknown key is not carried through: a config file is fetched, and carrying
 * arbitrary fields forward is how one grows into an injection surface.
 */
function parseConfig(value: unknown): RemoteConfig | undefined {
  if (!isRecord(value)) return undefined;
  const config: RemoteConfig = {};

  const { sampleRate } = value;
  if (typeof sampleRate === 'number') {
    if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
      // A rate outside the range is a mistake, and guessing which end was meant
      // could silently switch capture off for everyone.
      return undefined;
    }
    config.sampleRate = sampleRate;
  }

  for (const key of [
    'captureDeadClicks',
    'captureRageClicks',
    'captureEngagement',
  ] as const) {
    if (typeof value[key] === 'boolean') config[key] = value[key];
  }

  const suppression = parseSuppression(value.errorSuppression);
  if (suppression) config.errorSuppression = suppression;

  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * The last config known to be good, available synchronously. Reads through to
 * storage once, so a reload applies the previous visit's config immediately.
 */
export function cachedRemoteConfig(): RemoteConfig | undefined {
  if (cached === undefined && !readStorage) {
    readStorage = true;
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (raw) cached = parseConfig(JSON.parse(raw));
    } catch {
      // No storage, or a corrupt entry. Defaults apply.
    }
  }
  return cached;
}

export interface RefreshOptions {
  /** Injected for tests, and to bypass instrumented fetch in production. */
  fetchImpl?: typeof globalThis.fetch;
}

/**
 * Fetch the config and cache it. Resolves to the config now in force — the
 * fetched one, or the cached one when the fetch could not improve on it.
 * Never rejects.
 */
export async function refreshRemoteConfig(
  url: string,
  options?: RefreshOptions,
): Promise<RemoteConfig | undefined> {
  const doFetch = options?.fetchImpl ?? globalThis.fetch;
  if (!doFetch) return cachedRemoteConfig();
  try {
    const response = await doFetch(url, { credentials: 'omit' });
    if (!response.ok) return cachedRemoteConfig();
    const parsed = parseConfig(await response.json());
    if (!parsed) return cachedRemoteConfig();
    cached = parsed;
    readStorage = true;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      // In-memory only for this visit; not worth failing the refresh over.
    }
    return parsed;
  } catch {
    return cachedRemoteConfig();
  }
}

/** @internal Reset for testing */
export function resetRemoteConfigForTesting(): void {
  cached = undefined;
  readStorage = false;
}

/**
 * Local suppression rules plus any the remote config adds.
 *
 * Additive on purpose: a rule in the source is there for a reason, and a
 * fetched file must not be able to switch off error reporting the application
 * asked for. Remote can only ever quieten more, never less.
 */
export function applyRemoteSuppression(
  local: SuppressionRule[] | undefined,
  remote: RemoteConfig | undefined,
): SuppressionRule[] | undefined {
  const extra = remote?.errorSuppression;
  if (!extra || extra.length === 0) return local;
  return [...(local ?? []), ...extra];
}

/** What the local config asked for, before remote has its say. */
export interface LocalCaptureToggles {
  frustration: boolean;
  engagement: boolean;
}

/** What should actually run. */
export interface ResolvedCaptureToggles {
  frustration: boolean;
  engagement: boolean;
  /** `undefined` leaves the local/default setting for that half alone. */
  deadClicks: boolean | undefined;
  rage: boolean | undefined;
}

/**
 * Merge local capture settings with the remote ones.
 *
 * Remote wins in **both** directions. A toggle that can only ever say "off" is
 * not a control, and turning a signal on without a release is half the reason
 * remote config exists — this is the opposite of `applyRemoteSuppression`,
 * where remote may only ever quieten, because there the failure mode is
 * silently losing errors.
 */
export function resolveCaptureToggles(
  local: LocalCaptureToggles,
  remote: RemoteConfig | undefined,
): ResolvedCaptureToggles {
  const deadClicks = remote?.captureDeadClicks;
  const rage = remote?.captureRageClicks;

  // Frustration runs when either half is wanted: remote asking for rage clicks
  // alone must be enough to start the listener that produces them.
  const remoteWantsFrustration =
    deadClicks !== undefined || rage !== undefined
      ? deadClicks === true || rage === true
      : undefined;

  return {
    frustration: remoteWantsFrustration ?? local.frustration,
    engagement: remote?.captureEngagement ?? local.engagement,
    deadClicks,
    rage,
  };
}
