/**
 * Feature flag evaluations, in the vocabulary OpenTelemetry already defined.
 *
 * A flagged rollout splits your traffic into two populations that share a
 * service name, a route and a version. Without the flag on the span there is no
 * way to ask the only question that matters during a rollout — is the new
 * branch slower, or failing more, than the old one — and the usual workaround
 * is to read it in the flag vendor's own dashboard, where the latency and the
 * errors are not.
 *
 * The specification covers this: `feature_flag.key`, `.result.value`,
 * `.result.variant`, `.result.reason`, `.provider.name`, `.context.id`, plus a
 * `feature_flag.evaluation` event. Emitting those means any backend can split
 * any metric by variant, with no vendor in the path.
 *
 * ## Attributes and events both
 *
 * Span attributes hold one flag: a second call overwrites the first. A request
 * that branched on three flags needs one event each, which is what the
 * `feature_flag.evaluation` event is for. Both are recorded — attributes so a
 * single-flag span is filterable without unpacking events, events so a
 * many-flag span keeps them all.
 *
 * ## Record what you branched on
 *
 * Record a flag where the code *reads* it, not where it is fetched. A flag
 * evaluated and ignored explains nothing; the value the request actually took a
 * branch on is the one that explains its behaviour.
 */

import { trace, type Span } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';

/** Canonical `feature_flag.*` attribute keys. */
export const FEATURE_FLAG = {
  KEY: 'feature_flag.key',
  RESULT_VALUE: 'feature_flag.result.value',
  RESULT_VARIANT: 'feature_flag.result.variant',
  RESULT_REASON: 'feature_flag.result.reason',
  PROVIDER_NAME: 'feature_flag.provider.name',
  CONTEXT_ID: 'feature_flag.context.id',
  SET_ID: 'feature_flag.set.id',
  VERSION: 'feature_flag.version',
  /**
   * Why an evaluation failed. `feature_flag.evaluation.error.message` is the
   * deprecated spelling of this and is deliberately not emitted — writing both
   * would double the cardinality to no benefit.
   */
  ERROR_MESSAGE: 'feature_flag.error.message',
} as const;

/** Canonical event name for one evaluation. */
export const FEATURE_FLAG_EVALUATION_EVENT = 'feature_flag.evaluation';

/**
 * Canonical `feature_flag.result.reason` values. The registry defines them in
 * lower snake case; OpenFeature and most SDKs report them upper-cased, and
 * forwarding that splits every group-by into two buckets meaning the same
 * thing.
 */
export const FEATURE_FLAG_REASON = [
  'static',
  'default',
  'targeting_match',
  'split',
  'cached',
  'disabled',
  'unknown',
  'stale',
  'error',
] as const;

export interface FeatureFlagEvaluation {
  /** The flag's key, e.g. `new-checkout`. */
  key: string;
  /** The value the code branched on. Serialised if it is not a string. */
  value: unknown;
  /** Variant name, where the provider has one distinct from the value. */
  variant?: string;
  /**
   * Why this value. Case-normalised to the registry's spelling, so a provider
   * reporting `TARGETING_MATCH` and one reporting `targeting_match` land in the
   * same bucket.
   */
  reason?: string;
  /** The provider that answered, e.g. `posthog`, `launchdarkly`, `flagd`. */
  provider?: string;
  /** Identifier of the evaluation context — the user or account keyed on. */
  contextId?: string;
  /** Identifier of the flag set this flag belongs to. */
  setId?: string;
  /** Version of the flag definition that produced this value. */
  version?: string;
  /** Why the evaluation failed, when it did. */
  errorMessage?: string;
}

/** What an attribute can hold without being flattened to text. */
export type FeatureFlagAttributeValue = string | number | boolean;

/**
 * The smallest thing that can carry an evaluation.
 *
 * `track` is the correlated-log seam a `TraceContext` provides, and it is the
 * only event seam offered: this repository emits events through the Logs API
 * model, and a `Span.addEvent` fallback is how that direction quietly becomes
 * optional. A caller holding a raw span supplies its own `track` — in the
 * browser, `emitEvent` from `autotel-web` is one.
 *
 * A sink with no `track` still records the attributes, which covers the common
 * single-flag span.
 */
export interface FeatureFlagSink {
  setAttributes(attributes: Record<string, FeatureFlagAttributeValue>): void;
  track?(
    name: string,
    attributes?: Record<string, FeatureFlagAttributeValue>,
  ): void;
}

/**
 * A flag value as an attribute.
 *
 * Booleans and numbers are kept as they are: `feature_flag.result.value`
 * permits typed values, and stringifying `true` makes a boolean flag
 * uncomparable with the numeric one next to it. Only a structured value — which
 * no attribute type can hold — is serialised.
 */
function asAttributeValue(value: unknown): FeatureFlagAttributeValue {
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Canonical attributes for one evaluation. Absent fields are omitted. */
export function featureFlagAttributes(
  evaluation: FeatureFlagEvaluation,
): Record<string, FeatureFlagAttributeValue> {
  const attributes: Record<string, FeatureFlagAttributeValue> = {
    [FEATURE_FLAG.KEY]: evaluation.key,
    [FEATURE_FLAG.RESULT_VALUE]: asAttributeValue(evaluation.value),
  };
  const optional: [string, string | undefined][] = [
    [FEATURE_FLAG.RESULT_VARIANT, evaluation.variant],
    [
      FEATURE_FLAG.RESULT_REASON,
      evaluation.reason === undefined
        ? undefined
        : evaluation.reason.toLowerCase(),
    ],
    [FEATURE_FLAG.PROVIDER_NAME, evaluation.provider],
    [FEATURE_FLAG.CONTEXT_ID, evaluation.contextId],
    [FEATURE_FLAG.SET_ID, evaluation.setId],
    [FEATURE_FLAG.VERSION, evaluation.version],
    [FEATURE_FLAG.ERROR_MESSAGE, evaluation.errorMessage],
  ];
  for (const [key, value] of optional) {
    if (value !== undefined) attributes[key] = value;
  }
  return attributes;
}

/**
 * Record a flag evaluation on `sink` — as attributes and as a
 * `feature_flag.evaluation` event.
 *
 * A missing sink is a no-op: instrumentation must never be the reason a branch
 * throws, and a flag read outside any span is a legitimate thing to do.
 */
export function recordFeatureFlag(
  sink: FeatureFlagSink | undefined,
  evaluation: FeatureFlagEvaluation,
): void {
  if (!sink) return;
  const attributes = featureFlagAttributes(evaluation);
  sink.setAttributes(attributes);
  sink.track?.(FEATURE_FLAG_EVALUATION_EVENT, attributes);
}

/**
 * The parts of an OpenFeature hook context this reads. Structurally typed on
 * purpose: matching the shape rather than importing `@openfeature/server-sdk`
 * keeps the SDK out of every bundle that imports a sibling of this module, and
 * works against the web SDK, the server SDK and the React one alike — they
 * agree on this shape and disagree on almost everything else.
 */
export interface OpenFeatureHookContext {
  flagKey: string;
  defaultValue: unknown;
  context?: { targetingKey?: string };
  providerMetadata?: { name?: string };
  clientMetadata?: { name?: string };
}

/** The evaluation result an OpenFeature hook receives. */
export interface OpenFeatureEvaluationDetails {
  value: unknown;
  variant?: string;
  reason?: string;
}

/** Just enough of an OpenFeature hook to be registered as one. */
export interface OpenFeatureHook {
  after?(
    hookContext: OpenFeatureHookContext,
    details: OpenFeatureEvaluationDetails,
  ): void;
  error?(hookContext: OpenFeatureHookContext, error: unknown): void;
}

export interface OpenFeatureHookOptions {
  /**
   * Where to record. Defaults to the active span, which is what you want:
   * the span that branched on the flag is the one whose latency and errors the
   * flag explains.
   */
  getSpan?: () => FeatureFlagSink | undefined;
  /**
   * Where the evaluation event goes when the sink brings no `track` of its own.
   * Defaults to an OpenTelemetry log record. Injected for tests.
   */
  emitLogRecord?: (
    attributes: Record<string, FeatureFlagAttributeValue>,
  ) => void;
}

/**
 * Emit the evaluation as an OpenTelemetry **log record**.
 *
 * This is the Logs API model the repository emits events through. The obvious
 * shortcut — `Span.addEvent` on the active span — puts the evaluation somewhere
 * no log or event pipeline will ever look, which is exactly the failure the
 * invariant exists to prevent. `correlated-events` is not a way around it
 * either: that helper prefers `addEvent` when the target has one, so routing
 * through it lands in the same place with more indirection.
 *
 * `logs.getLogger` returns a no-op logger when no `LoggerProvider` is
 * registered, so this costs nothing in an application that exports no logs.
 */
function emitEvaluationRecord(
  attributes: Record<string, FeatureFlagAttributeValue>,
): void {
  logs.getLogger('autotel').emit({
    eventName: FEATURE_FLAG_EVALUATION_EVENT,
    attributes,
  });
}

function evaluationFrom(
  hookContext: OpenFeatureHookContext,
  value: unknown,
  extra: Partial<FeatureFlagEvaluation>,
): FeatureFlagEvaluation {
  return {
    key: hookContext.flagKey,
    value,
    provider: hookContext.providerMetadata?.name,
    contextId: hookContext.context?.targetingKey,
    setId: hookContext.clientMetadata?.name,
    ...extra,
  };
}

/**
 * An OpenFeature hook that records every evaluation under the canonical
 * `feature_flag.*` convention.
 *
 * This is the zero-config path: OpenFeature already sits between the
 * application and whichever flag vendor it uses, and it already fires on every
 * evaluation — which is exactly the moment worth recording, because it is the
 * moment the code branched.
 *
 * ```ts
 * import { OpenFeature } from '@openfeature/server-sdk';
 * import { autotelOpenFeatureHook } from 'autotel/feature-flags';
 *
 * OpenFeature.addHooks(autotelOpenFeatureHook());
 * ```
 *
 * A failed evaluation is still recorded, with the default value the code
 * actually used and `reason: 'ERROR'`. The default is what the request behaved
 * as; the failure is why.
 */
export function autotelOpenFeatureHook(
  options: OpenFeatureHookOptions = {},
): OpenFeatureHook {
  const getSpan =
    options.getSpan ??
    (() => trace.getActiveSpan() as Span & FeatureFlagSink as FeatureFlagSink);
  const emitLogRecord = options.emitLogRecord ?? emitEvaluationRecord;

  /**
   * Attributes onto the span that branched, and the event wherever the sink
   * says. A sink with no `track` of its own gets a log record — including when
   * there is no span at all, because the evaluation still happened.
   */
  const record = (evaluation: FeatureFlagEvaluation): void => {
    const sink = getSpan();
    const attributes = featureFlagAttributes(evaluation);
    sink?.setAttributes(attributes);
    if (sink?.track) sink.track(FEATURE_FLAG_EVALUATION_EVENT, attributes);
    else emitLogRecord(attributes);
  };

  return {
    after(hookContext, details) {
      record(
        evaluationFrom(hookContext, details.value, {
          variant: details.variant,
          reason: details.reason,
        }),
      );
    },
    error(hookContext, error) {
      record(
        evaluationFrom(hookContext, hookContext.defaultValue, {
          reason: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
    },
  };
}
