/**
 * Evaluate flags once at the edge and carry the answers downstream.
 *
 * When every service asks the flag vendor itself, one request can take `v2` in
 * the API and `control` in the service behind it: a rollout changed between
 * the two calls, or the services cache differently. With trunk-based
 * development flags change all day, so this is not a corner case, and the
 * trace then shows a request that ran two versions of the product at once.
 *
 * The edge evaluates as it already does and calls `featureFlagBaggage()` with
 * the details OpenFeature returned. W3C baggage carries them on every
 * propagated call. A downstream service sets `featureFlagBaggageProvider()` as
 * its OpenFeature provider and reads flags as usual; it answers from the
 * request, so it cannot disagree with the edge. The autotel hook records both
 * evaluations, with the edge's flag version, so the trace shows they agreed.
 *
 * ## Trust
 *
 * Baggage is a request header. Anyone who can send a request can send it, so
 * only a service behind an edge that sets it may use the provider: a public
 * service reading flags from baggage lets a client choose its own variants.
 * `featureFlagBaggage()` replaces the entry rather than merging into what
 * arrived, so an edge never forwards flags a client made up. Baggage also
 * travels to every service the request calls, third parties included: carry
 * flags whose values you would show them, which is what variants usually are.
 *
 * Structurally typed against OpenFeature, like the hook: no `@openfeature/*`
 * import reaches a bundle.
 */
import { context, propagation, type Context } from '@opentelemetry/api';

/** The baggage entry, one for every flag the edge evaluated. */
export const FEATURE_FLAG_BAGGAGE_KEY = 'autotel.feature_flags';

/** What OpenFeature's `get*Details` returns, as far as carrying it needs. */
export interface CarriedFlagEvaluation {
  flagKey: string;
  value: unknown;
  variant?: string;
  flagMetadata?: Readonly<Record<string, string | number | boolean>>;
}

interface Carried {
  value: unknown;
  variant?: string;
  /** `flagMetadata.version` and `.flagSetId`, so downstream records the edge's. */
  version?: string;
  setId?: string;
}

/**
 * `ctx` (the active context by default) with these evaluations as its
 * feature flag baggage. Run the downstream call inside it:
 *
 * ```ts
 * const engine = await flags.getStringDetails('pricing-engine', 'control', who);
 * await context.with(featureFlagBaggage([engine]), () => fetch(PRICING_URL, ...));
 * ```
 */
export function featureFlagBaggage(
  evaluations: readonly CarriedFlagEvaluation[],
  ctx: Context = context.active(),
): Context {
  const carried: Record<string, Carried> = {};
  for (const evaluation of evaluations) {
    const metadata = evaluation.flagMetadata;
    carried[evaluation.flagKey] = {
      value: evaluation.value,
      variant: evaluation.variant,
      version: metadata?.version?.toString(),
      setId: metadata?.flagSetId?.toString(),
    };
  }
  const baggage = (
    propagation.getBaggage(ctx) ?? propagation.createBaggage()
  ).setEntry(FEATURE_FLAG_BAGGAGE_KEY, { value: JSON.stringify(carried) });
  return propagation.setBaggage(ctx, baggage);
}

/** OpenFeature's resolution result, as far as this provider fills it. */
export interface BaggageFlagResolution<T> {
  value: T;
  variant?: string;
  reason: string;
  flagMetadata?: Record<string, string>;
}

/**
 * How the provider fails. OpenFeature reads `code` off whatever a provider
 * throws (`FLAG_NOT_FOUND`, `TYPE_MISMATCH`) and returns the default with that
 * error code, which the autotel hook records as `error.type`. Thrown rather
 * than returned because OpenFeature types a returned `errorCode` as its own
 * enum, which a structurally typed provider cannot name.
 */
export class FeatureFlagBaggageError extends Error {
  override name = 'FeatureFlagBaggageError';
  constructor(
    readonly code: 'FLAG_NOT_FOUND' | 'TYPE_MISMATCH',
    message: string,
  ) {
    super(message);
  }
}

/** An OpenFeature server provider, matched by shape. */
export interface BaggageFlagProvider {
  metadata: { name: string };
  runsOn: 'server';
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
  ): Promise<BaggageFlagResolution<boolean>>;
  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
  ): Promise<BaggageFlagResolution<string>>;
  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
  ): Promise<BaggageFlagResolution<number>>;
  resolveObjectEvaluation<T>(
    flagKey: string,
    defaultValue: T,
  ): Promise<BaggageFlagResolution<T>>;
}

function carriedFlags(): Record<string, Carried> | undefined {
  const entry = propagation
    .getBaggage(context.active())
    ?.getEntry(FEATURE_FLAG_BAGGAGE_KEY);
  if (!entry) return undefined;
  try {
    const parsed: unknown = JSON.parse(entry.value);
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- decoding the baggage header at its boundary
    if (typeof parsed !== 'object' || parsed === null) return {};
    // SAFETY: the edge writes this entry from a Record<string, Carried>;
    // resolve() checks each field's type before it returns a value.
    return parsed as Record<string, Carried>;
  } catch {
    return {};
  }
}

function resolve<T>(flagKey: string, type: string): BaggageFlagResolution<T> {
  const flags = carriedFlags();
  const flag = flags?.[flagKey];
  if (!flag) {
    // The caller gets its default, and the hook records `error.type:
    // flag_not_found`: the edge did not decide this flag, which is worth
    // seeing rather than quietly defaulting.
    throw new FeatureFlagBaggageError(
      'FLAG_NOT_FOUND',
      flags === undefined
        ? `No ${FEATURE_FLAG_BAGGAGE_KEY} baggage on this request`
        : `The edge did not carry ${flagKey}`,
    );
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- OpenFeature asks for a type by name; the carried value must match it
  if (typeof flag.value !== type) {
    throw new FeatureFlagBaggageError(
      'TYPE_MISMATCH',
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- naming the carried type in the error
      `${flagKey} was carried as ${typeof flag.value}, read as ${type}`,
    );
  }
  const flagMetadata: Record<string, string> = {};
  if (flag.version !== undefined) flagMetadata.version = flag.version;
  if (flag.setId !== undefined) flagMetadata.flagSetId = flag.setId;
  return {
    // SAFETY: checked above that its runtime type is the one OpenFeature asked
    // for, which is what T stands for.
    value: flag.value as T,
    variant: flag.variant,
    // The edge decided; this is its answer reused, which is what `cached` means.
    reason: 'CACHED',
    flagMetadata,
  };
}

/**
 * An OpenFeature provider that answers only from the request's feature flag
 * baggage. For services behind an edge that calls `featureFlagBaggage()`:
 *
 * ```ts
 * await OpenFeature.setProviderAndWait(featureFlagBaggageProvider());
 * ```
 */
export function featureFlagBaggageProvider(): BaggageFlagProvider {
  return {
    metadata: { name: 'baggage' },
    runsOn: 'server',
    resolveBooleanEvaluation: async (key) => resolve(key, 'boolean'),
    resolveStringEvaluation: async (key) => resolve(key, 'string'),
    resolveNumberEvaluation: async (key) => resolve(key, 'number'),
    resolveObjectEvaluation: async (key) => resolve(key, 'object'),
  };
}
