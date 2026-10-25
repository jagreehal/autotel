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
 * Span attributes hold one flag, and cannot be removed, so the span keeps the
 * first evaluation it saw. A request that branched on three flags needs one
 * event each, which is what the `feature_flag.evaluation` event is for: the
 * events are the complete record, the attributes let a single-flag span be
 * filtered without unpacking them.
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
  /** The class of error an evaluation ended with, e.g. `flag_not_found`. */
  ERROR_TYPE: 'error.type',
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
  /**
   * The class of error the evaluation ended with, e.g. `flag_not_found` or
   * OpenFeature's `FLAG_NOT_FOUND`, lower-cased to the registry's spelling.
   * Defaults to `general` when only `errorMessage` is given.
   */
  errorType?: string;
  /** Why the evaluation failed, when it did. */
  errorMessage?: string;
}

export interface FeatureFlagRecordOptions {
  /**
   * Record `feature_flag.result.value` even when a variant names the result.
   * Off by default, as the convention asks: a value can be large or private,
   * and the variant already identifies it. A flag with no variant always
   * records its value.
   */
  includeValue?: boolean;
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

/**
 * Canonical attributes for one evaluation. Absent fields are omitted, and the
 * value goes only when no variant names it, unless `includeValue` asks.
 */
export function featureFlagAttributes(
  evaluation: FeatureFlagEvaluation,
  options: FeatureFlagRecordOptions = {},
): Record<string, FeatureFlagAttributeValue> {
  const attributes: Record<string, FeatureFlagAttributeValue> = {
    [FEATURE_FLAG.KEY]: evaluation.key,
  };
  if (evaluation.variant === undefined || options.includeValue) {
    attributes[FEATURE_FLAG.RESULT_VALUE] = asAttributeValue(evaluation.value);
  }
  const errorType =
    evaluation.errorType?.toLowerCase() ??
    (evaluation.errorMessage === undefined ? undefined : 'general');
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
    [FEATURE_FLAG.ERROR_TYPE, errorType],
  ];
  for (const [key, value] of optional) {
    if (value !== undefined) attributes[key] = value;
  }
  return attributes;
}

/**
 * Record a flag evaluation as attributes and a `feature_flag.evaluation`
 * event.
 *
 * Without a sink it records onto the active span and emits the event as a log
 * record, as the OpenFeature hook does:
 *
 * ```ts
 * recordFeatureFlag({ key: 'new-checkout', value: enabled });
 * ```
 *
 * With one (`ctx` inside `trace()`) it records there. An explicit `undefined`
 * sink is a no-op: instrumentation must never be the reason a branch throws,
 * and a flag read outside any span is a legitimate thing to do.
 */
export function recordFeatureFlag(
  evaluation: FeatureFlagEvaluation,
  options?: FeatureFlagRecordOptions,
): void;
export function recordFeatureFlag(
  sink: FeatureFlagSink | undefined,
  evaluation: FeatureFlagEvaluation,
  options?: FeatureFlagRecordOptions,
): void;
export function recordFeatureFlag(
  first: FeatureFlagSink | FeatureFlagEvaluation | undefined,
  second?: FeatureFlagEvaluation | FeatureFlagRecordOptions,
  third?: FeatureFlagRecordOptions,
): void {
  if (first !== undefined && !('setAttributes' in first)) {
    record(
      activeSpan(),
      featureFlagAttributes(first, second as FeatureFlagRecordOptions),
      emitEvaluationRecord,
    );
    return;
  }
  if (!first) return;
  const attributes = featureFlagAttributes(
    second as FeatureFlagEvaluation,
    third,
  );
  record(first, attributes, emitEvaluationRecord);
}

/**
 * Spans that already carry an evaluation's attributes. Weakly held, so a span
 * is remembered for exactly as long as it exists.
 */
const projected = new WeakSet<object>();

/** Where a `TraceContext` keeps its span (see `trace-context.ts`). */
const TRACE_CONTEXT_SPAN = Symbol.for('autotel.traceContext.span');

/**
 * The span a sink writes to. A `TraceContext` carries it, however it is
 * reached: the ambient `ctx`, a fresh `getActiveTraceContext()`, or a parent's
 * context saved and used under a child span. A raw span, or any other sink,
 * is its own.
 */
function spanOf(sink: FeatureFlagSink): object {
  const span = (sink as unknown as Record<symbol, unknown>)[TRACE_CONTEXT_SPAN];
  return typeof span === 'object' && span !== null ? span : sink;
}

/** Whether this is the first evaluation recorded on the sink's span. */
function firstOnSpan(sink: FeatureFlagSink): boolean {
  const span = spanOf(sink);
  if (projected.has(span)) return false;
  projected.add(span);
  return true;
}

/**
 * The span's own copy of an evaluation, for filtering a single-flag span
 * without unpacking events. The first evaluation on a span keeps it: span
 * attributes cannot be removed, so a second would mix its fields with the
 * first's. Every evaluation, the first included, is a complete event.
 * `error.type` stays on the event, since on a span it describes the span's
 * own outcome.
 */
function projectOntoSpan(
  sink: FeatureFlagSink,
  attributes: Record<string, FeatureFlagAttributeValue>,
): void {
  if (!firstOnSpan(sink)) return;
  const { [FEATURE_FLAG.ERROR_TYPE]: _errorType, ...onSpan } = attributes;
  sink.setAttributes(onSpan);
}

function activeSpan(): FeatureFlagSink | undefined {
  return trace.getActiveSpan() as (Span & FeatureFlagSink) | undefined;
}

/**
 * Attributes onto the span that branched, and the event wherever the sink
 * says. A sink with no `track` of its own gets a log record, including when
 * there is no span at all, because the evaluation still happened.
 */
function record(
  sink: FeatureFlagSink | undefined,
  attributes: Record<string, FeatureFlagAttributeValue>,
  emitLogRecord: (
    attributes: Record<string, FeatureFlagAttributeValue>,
  ) => void,
): void {
  if (sink) projectOntoSpan(sink, attributes);
  if (sink?.track) sink.track(FEATURE_FLAG_EVALUATION_EVENT, attributes);
  else emitLogRecord(attributes);
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
}

/** The evaluation result an OpenFeature hook receives. */
export interface OpenFeatureEvaluationDetails {
  value: unknown;
  variant?: string;
  reason?: string;
  /**
   * What the provider reports about the flag. OpenFeature names `flagSetId`
   * and `version` here for OpenTelemetry's `feature_flag.set.id` and
   * `feature_flag.version`.
   */
  flagMetadata?: Readonly<Record<string, string | number | boolean>>;
}

/** Just enough of an OpenFeature hook to be registered as one. */
export interface OpenFeatureHook {
  after?(
    hookContext: OpenFeatureHookContext,
    details: OpenFeatureEvaluationDetails,
  ): void;
  error?(hookContext: OpenFeatureHookContext, error: unknown): void;
}

export interface OpenFeatureHookOptions extends FeatureFlagRecordOptions {
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

function metadataText(
  value: string | number | boolean | undefined,
): string | undefined {
  return value === undefined ? undefined : String(value);
}

/**
 * OpenFeature's error code (`FLAG_NOT_FOUND`, `TYPE_MISMATCH`, …), which
 * lower-cases to the convention's `error.type` value. `general` otherwise.
 */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== '' ? code : 'general';
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
    ...extra,
  };
}

/**
 * Evaluations already recorded, by the result object OpenFeature hands every
 * hook in one evaluation (`details`, or the error), and a new one each time.
 */
const recordedEvaluations = new WeakSet<object>();

/** Marks a hook as this one, so `init()` does not register a second. */
const AUTOTEL_HOOK = Symbol.for('autotel.openfeature.hook');

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
 * used, `reason: 'error'` and OpenFeature's error code as
 * `error.type`. The default is what the request behaved as; the failure is
 * why. A flag set id and version the provider reports in `flagMetadata` go on
 * as `feature_flag.set.id` and `feature_flag.version`.
 */
export function autotelOpenFeatureHook(
  options: OpenFeatureHookOptions = {},
): OpenFeatureHook {
  const getSpan = options.getSpan ?? activeSpan;
  const emitLogRecord = options.emitLogRecord ?? emitEvaluationRecord;

  const recordOnce = (
    result: unknown,
    evaluation: FeatureFlagEvaluation,
  ): void => {
    // A second copy of this hook (one from `init()`, one added by hand) sees
    // the same result object and records nothing.
    if (typeof result === 'object' && result !== null) {
      if (recordedEvaluations.has(result)) return;
      recordedEvaluations.add(result);
    }
    record(
      getSpan(),
      featureFlagAttributes(evaluation, options),
      emitLogRecord,
    );
  };

  const hook: OpenFeatureHook = {
    after(hookContext, details) {
      recordOnce(
        details,
        evaluationFrom(hookContext, details.value, {
          variant: details.variant,
          reason: details.reason,
          setId: metadataText(details.flagMetadata?.flagSetId),
          version: metadataText(details.flagMetadata?.version),
        }),
      );
    },
    error(hookContext, error) {
      recordOnce(
        error,
        evaluationFrom(hookContext, hookContext.defaultValue, {
          reason: 'error',
          errorType: errorCode(error),
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
    },
  };
  return Object.assign(hook, { [AUTOTEL_HOOK]: true });
}

/** Where OpenFeature keeps its API singleton, shared by its CJS and ESM builds. */
const OPENFEATURE_API = Symbol.for('@openfeature/js-sdk/api');

/** @internal The slice of OpenFeature's API singleton `init()` uses. */
export interface OpenFeatureApi {
  addHooks(...hooks: OpenFeatureHook[]): unknown;
  getHooks(): readonly unknown[];
}

function asOpenFeatureApi(value: unknown): OpenFeatureApi | undefined {
  const api = value as Partial<OpenFeatureApi> | undefined;
  return typeof api?.addHooks === 'function' &&
    typeof api.getHooks === 'function'
    ? (api as OpenFeatureApi)
    : undefined;
}

/**
 * The OpenFeature API the app uses: the singleton it already loaded, or the
 * server SDK loaded with `load`. Undefined when OpenFeature is not installed.
 *
 * @internal
 */
export function findOpenFeature(
  load: (id: string) => unknown,
): OpenFeatureApi | undefined {
  return (
    asOpenFeatureApi(
      (globalThis as Record<symbol, unknown>)[OPENFEATURE_API],
    ) ??
    asOpenFeatureApi(
      (load('@openfeature/server-sdk') as { OpenFeature?: unknown } | undefined)
        ?.OpenFeature,
    )
  );
}

/**
 * Register {@link autotelOpenFeatureHook} with OpenFeature, once. `init()` calls
 * this, so an app with `@openfeature/server-sdk` installed records every
 * evaluation without registering anything. A hook the app registered itself
 * counts.
 *
 * @internal
 */
export function installOpenFeatureHook(
  api: OpenFeatureApi,
  options: OpenFeatureHookOptions = {},
): void {
  const registered = api
    .getHooks()
    .some((hook) => (hook as Record<symbol, unknown>)?.[AUTOTEL_HOOK]);
  if (!registered) api.addHooks(autotelOpenFeatureHook(options));
}
