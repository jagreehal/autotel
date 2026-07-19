/**
 * Telemetry contract model.
 *
 * The premise: when the primary reader of your telemetry is an agent, your
 * span names and attribute keys are a **public API**. Renaming `fast_path_hit`
 * to `fast_path_taken` in a refactor PR silently breaks every prompt that
 * mentions it — there is no compiler to catch it, because to the compiler these
 * are just strings in a JSON blob.
 *
 * `defineContract()` makes that surface explicit, typed, and versionable: you
 * declare which spans your service emits and which attributes live on them,
 * then validate live spans against it ({@link ./validate}) and diff it across
 * commits to catch breaking changes before they ship ({@link ./diff}).
 *
 * This module is dependency-free and side-effect-free by design — safe to
 * import anywhere (browser, edge, CLI) without pulling in the OpenTelemetry SDK.
 */

import { validateScenarioSpec, type ScenarioSpec } from './scenario.js';

/** Scalar and array attribute types permitted on a span (OTLP value shapes). */
export type AttributeType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]';

export const ATTRIBUTE_TYPES: readonly AttributeType[] = [
  'string',
  'number',
  'boolean',
  'string[]',
  'number[]',
  'boolean[]',
];

/**
 * Lifecycle of a span or attribute, mirroring how the OpenTelemetry semantic
 * conventions stage their own surface. `stable` is a promise to agent readers
 * that the name will not change without a major contract bump.
 */
export type Stability = 'stable' | 'experimental' | 'deprecated';

export const STABILITIES: readonly Stability[] = [
  'stable',
  'experimental',
  'deprecated',
];

/** Declaration for a single attribute key on a span. */
export interface AttributeSpec {
  /** OTLP value shape. Validated at runtime against the emitted value. */
  type: AttributeType;
  /** Lifecycle stage. Defaults to `stable`. */
  stability?: Stability;
  /** When `true`, the attribute must be present on every matching span. */
  required?: boolean;
  /** Human/agent-facing description of what the attribute means. */
  description?: string;
  /**
   * Marks an attribute as intentionally high-cardinality (user id, sender
   * domain, request id). For an agent reader these are the single most useful
   * fields on a trace, so {@link ./redaction.highCardinalityKeys} surfaces them
   * as a *protect* list — telling redactors/normalizers NOT to strip them.
   */
  highCardinality?: boolean;
  /** Closed set of permitted values. Reported as `enum_violation` if exceeded. */
  enum?: readonly (string | number)[];
  /** Set when `stability: 'deprecated'`; explains what to use instead. */
  replacedBy?: string;
  /** Free-text note shown alongside deprecation warnings. */
  deprecatedReason?: string;
}

/** Declaration for a single span name your service emits. */
export interface SpanSpec {
  /** Human/agent-facing description of when this span is produced. */
  description?: string;
  /** Lifecycle stage. Defaults to `stable`. */
  stability?: Stability;
  /** Attributes specific to this span, keyed by attribute name. */
  attributes?: Record<string, AttributeSpec>;
  /**
   * When `true`, attributes not declared here are allowed without an
   * `unknown_attribute` violation. Defaults to the contract-level setting.
   */
  additionalAttributes?: boolean;
}

/** The full telemetry contract for one service. */
export interface TelemetryContract {
  /** `service.name` this contract describes. */
  service: string;
  /**
   * Semver of the *contract itself* (not the app). Bumped when the trace
   * surface changes; surfaced to readers as the `telemetry.schema.version`
   * resource attribute via {@link ./attrs.SCHEMA_ATTRS}.
   */
  version: string;
  /** Spans this service emits, keyed by span name. */
  spans: Record<string, SpanSpec>;
  /** Attributes permitted on *any* span (e.g. `user.id`, `tenant.id`). */
  commonAttributes?: Record<string, AttributeSpec>;
  /**
   * Default for `SpanSpec.additionalAttributes` when a span does not set it.
   * Defaults to `false` (declared-only — the stricter, agent-friendlier mode).
   */
  additionalAttributes?: boolean;
  /**
   * Flow-level scenario contracts, keyed by scenario name: which events one
   * exercised flow must emit, their cardinality and topology, and when the
   * observation is complete. Checked with `checkScenario` ({@link ./scenario}).
   */
  scenarios?: Record<string, ScenarioSpec>;
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`autotel-schema: ${message}`);
  }
}

function validateAttribute(
  scope: string,
  key: string,
  spec: AttributeSpec,
): void {
  assert(
    ATTRIBUTE_TYPES.includes(spec.type),
    `${scope} attribute "${key}" has invalid type "${spec.type}"`,
  );
  if (spec.stability) {
    assert(
      STABILITIES.includes(spec.stability),
      `${scope} attribute "${key}" has invalid stability "${spec.stability}"`,
    );
  }
  if (spec.stability === 'deprecated') {
    assert(
      spec.replacedBy !== undefined || spec.deprecatedReason !== undefined,
      `${scope} attribute "${key}" is deprecated but has no replacedBy or deprecatedReason`,
    );
  }
  if (spec.enum) {
    assert(
      spec.enum.length > 0,
      `${scope} attribute "${key}" declares an empty enum`,
    );
  }
}

/**
 * Validate and freeze a telemetry contract. Throws on structural mistakes
 * (bad semver, unknown attribute type, deprecation with no replacement) so the
 * contract fails loudly at module load, not silently at runtime.
 *
 * @example
 * ```ts
 * export const contract = defineContract({
 *   service: 'checkout',
 *   version: '1.2.0',
 *   commonAttributes: {
 *     'user.id': { type: 'string', highCardinality: true, description: 'Authenticated user' },
 *   },
 *   spans: {
 *     'checkout.charge': {
 *       description: 'Charge a payment method',
 *       attributes: {
 *         'payment.provider': { type: 'string', required: true, enum: ['stripe', 'paypal'] },
 *         'payment.amount_cents': { type: 'number', required: true },
 *       },
 *     },
 *   },
 * });
 * ```
 */
export function defineContract(contract: TelemetryContract): TelemetryContract {
  assert(
    typeof contract.service === 'string' && contract.service.length > 0,
    'contract.service must be a non-empty string',
  );
  assert(
    SEMVER_RE.test(contract.version),
    `contract.version "${contract.version}" is not valid semver (e.g. "1.2.0")`,
  );
  assert(
    contract.spans && typeof contract.spans === 'object',
    'contract.spans must be an object',
  );

  for (const [spanName, spanSpec] of Object.entries(contract.spans)) {
    if (spanSpec.stability) {
      assert(
        STABILITIES.includes(spanSpec.stability),
        `span "${spanName}" has invalid stability "${spanSpec.stability}"`,
      );
    }
    for (const [key, spec] of Object.entries(spanSpec.attributes ?? {})) {
      validateAttribute(`span "${spanName}"`, key, spec);
    }
  }
  for (const [key, spec] of Object.entries(contract.commonAttributes ?? {})) {
    validateAttribute('common', key, spec);
  }
  for (const [name, spec] of Object.entries(contract.scenarios ?? {})) {
    validateScenarioSpec(name, spec);
  }

  return Object.freeze(contract);
}

/**
 * Resolve the effective attribute spec for `key` on `spanName`: span-specific
 * attributes win over common attributes. Returns `undefined` when the key is
 * declared nowhere.
 */
export function resolveAttributeSpec(
  contract: TelemetryContract,
  spanName: string,
  key: string,
): AttributeSpec | undefined {
  return (
    contract.spans[spanName]?.attributes?.[key] ??
    contract.commonAttributes?.[key]
  );
}

/** Whether attributes outside the declared set are tolerated for a span. */
export function allowsAdditionalAttributes(
  contract: TelemetryContract,
  spanName: string,
): boolean {
  return (
    contract.spans[spanName]?.additionalAttributes ??
    contract.additionalAttributes ??
    false
  );
}
