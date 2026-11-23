/**
 * Safe baggage propagation with guardrails
 *
 * Provides type-safe baggage schemas with built-in protection against
 * common pitfalls: high-cardinality values, PII leakage, and oversized payloads.
 *
 * @example Define a custom schema
 * ```typescript
 * import { createSafeBaggageSchema } from 'autotel/business-baggage';
 *
 * const OrderBaggage = createSafeBaggageSchema({
 *   orderId: { type: 'string' },
 *   customerId: { type: 'string', hash: true },  // Auto-hash for privacy
 *   priority: { type: 'enum', values: ['low', 'normal', 'high'] },
 * });
 *
 * // Usage in traced function
 * OrderBaggage.set(ctx, { orderId: 'ord-123', customerId: 'cust-456', priority: 'high' });
 * const { orderId, priority } = OrderBaggage.get(ctx);
 * ```
 *
 * @example Use pre-built BusinessBaggage
 * ```typescript
 * import { BusinessBaggage } from 'autotel/business-baggage';
 *
 * BusinessBaggage.set(ctx, { tenantId: 'acme', userId: 'user-123' });
 * const { tenantId } = BusinessBaggage.get(ctx);
 * ```
 *
 * @module
 */

import { propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { MAX_HEADER_SIZE, planBatch } from './baggage-header';
import {
  getActiveContextWithBaggage,
  LONE_SURROGATE,
  writeBaggage,
  type TraceContext,
} from './trace-context';
import type { UnknownRecord } from './values';
import { asBoolean, asNumber, asString, describeValue } from './values';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported field types in baggage schema
 */
export type BaggageFieldType = 'string' | 'number' | 'boolean' | 'enum';

/**
 * What a caller may put in a baggage field: one of the scalars baggage can
 * carry, or nothing - a field left out, or one waiting for its default.
 */
export type BaggageFieldValue = string | number | boolean | null | undefined;

/**
 * Field definition in a baggage schema
 */
export interface BaggageFieldDefinition {
  /** Field type */
  type: BaggageFieldType;

  /** Maximum length for string values (default: 256) */
  maxLength?: number;

  /** Hash value before storing (for privacy) */
  hash?: boolean;

  /** Allowed values for enum type */
  values?: readonly string[];

  /** Default value if not provided */
  defaultValue?: string | number | boolean;

  /** Whether field is required */
  required?: boolean;

  /** Custom validation function */
  validate?: (value: BaggageFieldValue) => boolean;
}

/**
 * Options for creating a safe baggage schema
 */
export interface SafeBaggageOptions {
  /** Maximum key length (default: 64) */
  maxKeyLength?: number;

  /** Maximum value length (default: 256) */
  maxValueLength?: number;

  /**
   * Maximum size of the whole outgoing `baggage` header in bytes, as sent:
   * URI-encoded, with separators (default and maximum: 8192, the most
   * OpenTelemetry's propagator sends)
   */
  maxTotalSize?: number;

  /** Prefix for all keys (default: none) */
  prefix?: string;

  /** Hash high-cardinality values automatically */
  hashHighCardinality?: boolean;

  /** Detect and redact PII patterns */
  redactPII?: boolean;

  /** Allowed keys whitelist (others rejected) */
  allowedKeys?: string[];

  /** Custom error handler */
  onError?: (error: BaggageError) => void;
}

/**
 * Schema definition type - maps field names to definitions
 */
export type BaggageSchemaDefinition = Record<string, BaggageFieldDefinition>;

/**
 * Inferred type from schema definition
 */
export type InferBaggageType<T extends BaggageSchemaDefinition> = {
  [K in keyof T]?: T[K]['type'] extends 'string'
    ? string
    : T[K]['type'] extends 'number'
      ? number
      : T[K]['type'] extends 'boolean'
        ? boolean
        : T[K]['type'] extends 'enum'
          ? T[K]['values'] extends readonly string[]
            ? T[K]['values'][number]
            : string
          : unknown;
};

/**
 * Baggage error details
 */
export interface BaggageError {
  type:
    | 'validation'
    | 'size'
    | 'pii'
    | 'key_length'
    | 'value_length'
    /** A write with no trace or OTel scope around it to end with. */
    | 'no_trace';
  key: string;
  message: string;
  value?: unknown;
}

/**
 * Safe baggage schema interface
 */
export interface SafeBaggageSchema<T extends BaggageSchemaDefinition> {
  /**
   * Get baggage values from context
   */
  get(ctx?: TraceContext): Partial<InferBaggageType<T>>;

  /**
   * Set baggage values for the rest of the request, like ctx.setBaggage():
   * read back by get() and sent on outgoing calls.
   */
  set(
    ctx: TraceContext | undefined,
    values: Partial<InferBaggageType<T>>,
  ): void;

  /**
   * Get a single baggage value
   */
  getValue<K extends keyof T>(
    key: K,
    ctx?: TraceContext,
  ): InferBaggageType<T>[K] | undefined;

  /**
   * Set a single baggage value
   */
  setValue<K extends keyof T>(
    key: K,
    value: InferBaggageType<T>[K],
    ctx?: TraceContext,
  ): void;

  /**
   * Clear all schema baggage values
   */
  clear(ctx?: TraceContext): void;

  /**
   * Get all baggage as headers for propagation
   */
  toHeaders(ctx?: TraceContext): Record<string, string>;

  /**
   * Restore baggage from headers
   */
  fromHeaders(headers: Record<string, string>, ctx?: TraceContext): void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_KEY_LENGTH = 64;
const DEFAULT_MAX_VALUE_LENGTH = 256;
const DEFAULT_MAX_TOTAL_SIZE = 8192;

// PII patterns to detect and redact
const PII_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // Phone (US)
  /\b\d{3}[-]?\d{2}[-]?\d{4}\b/, // SSN
  /\b\d{16}\b/, // Credit card (basic)
];

// What hashValue() produces: FNV-1a's 32 bits as hex
const HASHED = /^h_[\da-f]{1,8}$/;

// High-cardinality value patterns
const HIGH_CARDINALITY_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^\d{13,}$/, // Timestamps
  /^[A-Za-z0-9+/]{20,}={0,2}$/, // Base64
];

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a safe baggage schema with validation and guardrails
 *
 * @param schema - Field definitions
 * @param options - Safety options
 * @returns Type-safe baggage schema
 *
 * @example
 * ```typescript
 * const MyBaggage = createSafeBaggageSchema({
 *   userId: { type: 'string', hash: true },
 *   region: { type: 'enum', values: ['us', 'eu', 'ap'] },
 *   debug: { type: 'boolean', defaultValue: false },
 * });
 * ```
 */
export function createSafeBaggageSchema<T extends BaggageSchemaDefinition>(
  schema: T,
  options: SafeBaggageOptions = {},
): SafeBaggageSchema<T> {
  const {
    maxKeyLength = DEFAULT_MAX_KEY_LENGTH,
    maxValueLength = DEFAULT_MAX_VALUE_LENGTH,
    maxTotalSize = DEFAULT_MAX_TOTAL_SIZE,
    prefix = '',
    hashHighCardinality = false,
    redactPII = false,
    allowedKeys,
    onError,
  } = options;

  // A larger limit cannot hold: the serializer leaves out what would not fit.
  const headerLimit = Math.min(maxTotalSize, MAX_HEADER_SIZE);

  // Validate schema keys
  const schemaKeys = new Set(Object.keys(schema));
  for (const key of [
    prefix,
    ...schemaKeys,
    ...Object.values(schema).flatMap((f) => f.values ?? []),
  ])
    if (LONE_SURROGATE.test(key))
      throw new Error(`Baggage schema name "${key}" is not valid Unicode`);
  if (allowedKeys) {
    for (const key of schemaKeys) {
      if (!allowedKeys.includes(key)) {
        throw new Error(`Key "${key}" not in allowedKeys whitelist`);
      }
    }
  }

  /**
   * Whether this schema can turn a value of the field into a hash, so a hash
   * arriving in a header may be the sender's transform. A boolean never is;
   * an enum only when one of its own values is PII or high-cardinality.
   */
  const mayHash = (fieldDef: BaggageFieldDefinition): boolean => {
    if (fieldDef.hash) return true;
    const transforms = (value: string) =>
      (redactPII && containsPII(value)) ||
      (hashHighCardinality && isHighCardinality(value));
    switch (fieldDef.type) {
      case 'boolean': {
        return false;
      }
      case 'enum': {
        return fieldDef.values?.some((value) => transforms(value)) ?? false;
      }
      default: {
        return redactPII || hashHighCardinality;
      }
    }
  };

  // Prefix a key
  const prefixKey = (key: string): string =>
    prefix ? `${prefix}.${key}` : key;

  // Hash a value using simple FNV-1a (synchronous, no crypto dependency)
  const hashValue = (value: string): string => {
    let hash = 2_166_136_261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.codePointAt(i) ?? 0;
      hash = (hash * 16_777_619) >>> 0;
    }
    return `h_${hash.toString(16)}`;
  };

  // Check for PII
  const containsPII = (value: string): boolean => {
    return PII_PATTERNS.some((pattern) => pattern.test(value));
  };

  // Check for high-cardinality
  const isHighCardinality = (value: string): boolean => {
    return HIGH_CARDINALITY_PATTERNS.some((pattern) => pattern.test(value));
  };

  const keyFits = (key: string): boolean => {
    if (prefixKey(key).length <= maxKeyLength) return true;
    onError?.({
      type: 'key_length',
      key,
      message: `Key "${key}" exceeds max length ${maxKeyLength}`,
    });
    return false;
  };

  const fitLength = (
    key: string,
    stringValue: string,
    fieldDef: BaggageFieldDefinition,
  ): string | null => {
    const maxLen = fieldDef.maxLength ?? maxValueLength;
    if (stringValue.length <= maxLen) return stringValue;
    onError?.({
      type: 'value_length',
      key,
      message: `Field "${key}" value exceeds max length ${maxLen}`,
      value: stringValue,
    });
    // Whole code points only: slicing mid-pair leaves a lone surrogate.
    let truncated = '';
    for (const char of stringValue) {
      if (truncated.length + char.length > maxLen) break;
      truncated += char;
    }
    return truncated === '' ? null : truncated;
  };

  // Validate and transform a value the caller supplied
  const validateAndTransform = (
    key: string,
    value: BaggageFieldValue,
    fieldDef: BaggageFieldDefinition,
  ): string | null => {
    if (!keyFits(key)) return null;

    // Handle undefined/null with default
    if (value === undefined || value === null) {
      if (fieldDef.required) {
        onError?.({
          type: 'validation',
          key,
          message: `Required field "${key}" is missing`,
        });
        return null;
      }
      if (fieldDef.defaultValue === undefined) {
        return null;
      } else {
        value = fieldDef.defaultValue;
      }
    }

    // Type validation
    let stringValue: string;

    switch (fieldDef.type) {
      case 'string': {
        const text = asString(value);
        if (text === undefined) {
          onError?.({
            type: 'validation',
            key,
            message: `Field "${key}" expected string, got ${describeValue(value)}`,
            value,
          });
          return null;
        }
        stringValue = text;
        break;
      }

      case 'number': {
        const numeric = asNumber(value);
        if (numeric === undefined) {
          onError?.({
            type: 'validation',
            key,
            message: `Field "${key}" expected number, got ${describeValue(value)}`,
            value,
          });
          return null;
        }
        stringValue = String(numeric);
        break;
      }

      case 'boolean': {
        const flag = asBoolean(value);
        if (flag === undefined) {
          onError?.({
            type: 'validation',
            key,
            message: `Field "${key}" expected boolean, got ${describeValue(value)}`,
            value,
          });
          return null;
        }
        stringValue = String(flag);
        break;
      }

      case 'enum': {
        if (!fieldDef.values?.includes(String(value))) {
          onError?.({
            type: 'validation',
            key,
            message: `Field "${key}" value "${value}" not in allowed values: ${fieldDef.values?.join(', ')}`,
            value,
          });
          return null;
        }
        stringValue = String(value);
        break;
      }

      default: {
        stringValue = String(value);
      }
    }

    if (LONE_SURROGATE.test(stringValue)) {
      onError?.({
        type: 'validation',
        key,
        message: `Field "${key}" is not valid Unicode (a lone surrogate)`,
      });
      return null;
    }

    // Custom validation: one that throws counts as a failure, so a baggage
    // write never aborts the caller.
    let valid = true;
    if (fieldDef.validate) {
      try {
        valid = fieldDef.validate(value);
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      onError?.({
        type: 'validation',
        key,
        message: `Field "${key}" failed custom validation`,
        value,
      });
      return null;
    }

    // PII check
    if (redactPII && containsPII(stringValue)) {
      onError?.({
        type: 'pii',
        key,
        message: `Field "${key}" contains PII pattern`,
        value: '[REDACTED]',
      });
      stringValue = hashValue(stringValue);
    }

    // Hash if requested or high-cardinality
    if (
      fieldDef.hash ||
      (hashHighCardinality && isHighCardinality(stringValue))
    ) {
      stringValue = hashValue(stringValue);
    }

    return fitLength(key, stringValue, fieldDef);
  };

  /**
   * A value another service wrote, as its header carried it. A hash in a
   * field this schema can hash ({@link mayHash}) is the sender's transform,
   * so it is kept as it is (only the
   * length limits apply): hashing it again would change the identifier at
   * every hop, and raw-value validation cannot hold for a hash. Any other
   * value is parsed for its type and imported like a caller's, so a sender
   * that did not hash still has its value hashed.
   */
  const importValue = (
    key: string,
    raw: string,
    fieldDef: BaggageFieldDefinition,
  ): string | null => {
    if (mayHash(fieldDef) && HASHED.test(raw))
      return keyFits(key) ? fitLength(key, raw, fieldDef) : null;
    const parsed = parseValue(raw, fieldDef);
    if (parsed === undefined) {
      onError?.({
        type: 'validation',
        key,
        message: `Field "${key}" header value is not a valid ${fieldDef.type}`,
        value: raw,
      });
      return null;
    }
    return validateAndTransform(key, parsed, fieldDef);
  };

  /**
   * A stored string as its field's type, or `undefined` when it is not one:
   * a hashed or redacted number, a flag that is not `true`/`false`, an enum
   * value outside the list. Readers then treat the field as absent.
   */
  const parseValue = (
    stringValue: string,
    fieldDef: BaggageFieldDefinition,
  ): string | number | boolean | undefined => {
    switch (fieldDef.type) {
      case 'number': {
        const numeric = Number(stringValue);
        return stringValue.trim() !== '' && Number.isFinite(numeric)
          ? numeric
          : undefined;
      }
      case 'boolean': {
        if (stringValue === 'true') return true;
        return stringValue === 'false' ? false : undefined;
      }
      case 'enum': {
        return fieldDef.values?.includes(stringValue) ? stringValue : undefined;
      }
      default: {
        return stringValue;
      }
    }
  };

  /**
   * Write prepared values (field key to baggage string) the same way as
   * ctx.setBaggage(): for the rest of the request, propagated on outgoing
   * calls. Outside a trace there is no request to hold them: nothing is
   * written, and the caller hears why.
   */
  const commit = (prepared: Map<string, string>): void => {
    const baggage =
      propagation.getBaggage(getActiveContextWithBaggage()) ??
      propagation.createBaggage();
    const { accepted, rejected } = planBatch(
      new Map(baggage.getAllEntries()),
      [...prepared].map(([key, value]) => ({
        key,
        fullKey: prefixKey(key),
        entry: { value },
      })),
      headerLimit,
    );
    for (const { key, entry } of rejected)
      onError?.({
        type: 'size',
        key,
        message: `Adding "${key}" would not fit the baggage header the propagator sends (max ${headerLimit} bytes)`,
        value: entry.value,
      });
    const changes = new Map(
      accepted.map(({ fullKey, entry }) => [fullKey, entry]),
    );

    if (changes.size > 0 && !writeBaggage(changes))
      onError?.({
        type: 'no_trace',
        key: [...changes.keys()].join(','),
        message:
          'Baggage can only be set inside a trace or an OpenTelemetry context scope',
      });
  };

  /** A schema field as stored, parsed; an invalid value reads as absent. */
  const read = (key: string): string | number | boolean | undefined => {
    const fieldDef = schema[key];
    const entry = propagation
      .getBaggage(getActiveContextWithBaggage())
      ?.getEntry(prefixKey(key));
    const parsed =
      fieldDef && entry ? parseValue(entry.value, fieldDef) : undefined;
    return parsed ?? fieldDef?.defaultValue;
  };

  return {
    get(): Partial<InferBaggageType<T>> {
      const result: UnknownRecord = {};
      for (const key of Object.keys(schema)) {
        const value = read(key);
        if (value !== undefined) result[key] = value;
      }
      // SAFETY: every key came from `schema`, and parseValue produced its
      // value from that field's declared type - which is exactly what
      // InferBaggageType derives. The mapping is the schema's, not a guess.
      return result as Partial<InferBaggageType<T>>;
    },

    set(
      _ctx: TraceContext | undefined,
      values: Partial<InferBaggageType<T>>,
    ): void {
      const prepared = new Map<string, string>();
      for (const [key, value] of Object.entries(values)) {
        const fieldDef = schema[key];
        if (!fieldDef) continue;
        const stringValue = validateAndTransform(key, value, fieldDef);
        if (stringValue !== null) prepared.set(key, stringValue);
      }
      commit(prepared);
    },

    getValue<K extends keyof T>(key: K): InferBaggageType<T>[K] | undefined {
      // SAFETY: see the note in get() - read() answers in the field's
      // declared type, or with its declared default.
      return read(String(key)) as InferBaggageType<T>[K] | undefined;
    },

    setValue<K extends keyof T>(
      key: K,
      value: InferBaggageType<T>[K],
      ctx?: TraceContext,
    ): void {
      // SAFETY: `value` is already typed as this key's value; the computed
      // key is what TypeScript cannot follow into a mapped type.
      this.set(ctx, { [key]: value } as Partial<InferBaggageType<T>>);
    },

    clear(): void {
      const keys = Object.keys(schema).map((key) => prefixKey(key));
      if (!writeBaggage(new Map(keys.map((key) => [key, undefined]))))
        onError?.({
          type: 'no_trace',
          key: keys.join(','),
          message:
            'Baggage can only be cleared inside a trace or an OpenTelemetry context scope',
        });
    },

    toHeaders() {
      const headers: Record<string, string> = {};
      propagation.inject(getActiveContextWithBaggage(), headers);
      return headers;
    },

    fromHeaders(headers: Record<string, string>): void {
      // Against an empty context: only what the headers carry is imported,
      // never baggage already in scope (a callback's, which would outlive it).
      const baggage = propagation.getBaggage(
        propagation.extract(ROOT_CONTEXT, headers),
      );
      if (!baggage) return;
      const prepared = new Map<string, string>();
      for (const [key, fieldDef] of Object.entries(schema)) {
        const entry = baggage.getEntry(prefixKey(key));
        if (!entry) continue;
        const stringValue = importValue(key, entry.value, fieldDef);
        if (stringValue !== null) prepared.set(key, stringValue);
      }
      commit(prepared);
    },
  };
}

// ============================================================================
// Pre-built Business Context Schema
// ============================================================================

/**
 * Pre-built baggage schema for common business context fields
 *
 * Fields:
 * - `tenantId`: Multi-tenant identifier (string, max 64 chars)
 * - `userId`: User identifier (hashed for privacy)
 * - `correlationId`: Request correlation ID (string)
 * - `workflowId`: Workflow/saga instance ID (string)
 * - `priority`: Request priority (low, normal, high, critical)
 * - `region`: Geographic region (string)
 * - `channel`: Request channel (web, mobile, api, internal)
 *
 * @example
 * ```typescript
 * import { BusinessBaggage } from 'autotel/business-baggage';
 *
 * // Set business context at entry point
 * BusinessBaggage.set(ctx, {
 *   tenantId: 'acme-corp',
 *   userId: 'user-123',
 *   priority: 'high',
 *   channel: 'api',
 * });
 *
 * // Access anywhere in the trace
 * const { tenantId, priority } = BusinessBaggage.get(ctx);
 * ```
 */
export const BusinessBaggage = createSafeBaggageSchema(
  {
    tenantId: {
      type: 'string',
      maxLength: 64,
    },
    userId: {
      type: 'string',
      hash: true, // Auto-hash for privacy
      maxLength: 64,
    },
    correlationId: {
      type: 'string',
      maxLength: 128,
    },
    workflowId: {
      type: 'string',
      maxLength: 128,
    },
    priority: {
      type: 'enum',
      values: ['low', 'normal', 'high', 'critical'] as const,
      defaultValue: 'normal',
    },
    region: {
      type: 'string',
      maxLength: 32,
    },
    channel: {
      type: 'enum',
      values: [
        'web',
        'mobile',
        'api',
        'internal',
        'webhook',
        'scheduled',
      ] as const,
    },
  },
  {
    prefix: 'biz',
    redactPII: true,
    hashHighCardinality: true,
  },
);

/**
 * Type alias for BusinessBaggage values
 */
export type BusinessBaggageValues = {
  tenantId?: string;
  userId?: string;
  correlationId?: string;
  workflowId?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  region?: string;
  channel?: 'web' | 'mobile' | 'api' | 'internal' | 'webhook' | 'scheduled';
};
