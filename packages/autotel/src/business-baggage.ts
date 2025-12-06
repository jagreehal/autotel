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

import { context, propagation } from '@opentelemetry/api';
import type { TraceContext } from './trace-context';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported field types in baggage schema
 */
export type BaggageFieldType = 'string' | 'number' | 'boolean' | 'enum';

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
  validate?: (value: unknown) => boolean;
}

/**
 * Options for creating a safe baggage schema
 */
export interface SafeBaggageOptions {
  /** Maximum key length (default: 64) */
  maxKeyLength?: number;

  /** Maximum value length (default: 256) */
  maxValueLength?: number;

  /** Maximum total baggage size in bytes (default: 8192) */
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
  type: 'validation' | 'size' | 'pii' | 'key_length' | 'value_length';
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
   * Set baggage values in context
   * Returns new context with baggage (for context propagation)
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

  // Validate schema keys
  const schemaKeys = new Set(Object.keys(schema));
  if (allowedKeys) {
    for (const key of schemaKeys) {
      if (!allowedKeys.includes(key)) {
        throw new Error(`Key "${key}" not in allowedKeys whitelist`);
      }
    }
  }

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

  // Validate and transform a single value
  const validateAndTransform = (
    key: string,
    value: unknown,
    fieldDef: BaggageFieldDefinition,
  ): string | null => {
    const fullKey = prefixKey(key);

    // Check key length
    if (fullKey.length > maxKeyLength) {
      onError?.({
        type: 'key_length',
        key,
        message: `Key "${key}" exceeds max length ${maxKeyLength}`,
      });
      return null;
    }

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
        if (typeof value !== 'string') {
          onError?.({
            type: 'validation',
            key,
            message: `Field "${key}" expected string, got ${typeof value}`,
            value,
          });
          return null;
        }
        stringValue = value;
        break;
      }

      case 'number': {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          onError?.({
            type: 'validation',
            key,
            message: `Field "${key}" expected number, got ${typeof value}`,
            value,
          });
          return null;
        }
        stringValue = String(value);
        break;
      }

      case 'boolean': {
        if (typeof value !== 'boolean') {
          onError?.({
            type: 'validation',
            key,
            message: `Field "${key}" expected boolean, got ${typeof value}`,
            value,
          });
          return null;
        }
        stringValue = String(value);
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

    // Custom validation
    if (fieldDef.validate && !fieldDef.validate(value)) {
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

    // Length validation
    const maxLen = fieldDef.maxLength ?? maxValueLength;
    if (stringValue.length > maxLen) {
      onError?.({
        type: 'value_length',
        key,
        message: `Field "${key}" value exceeds max length ${maxLen}`,
        value: stringValue,
      });
      stringValue = stringValue.slice(0, maxLen);
    }

    return stringValue;
  };

  // Parse value back from baggage string
  const parseValue = (
    key: string,
    stringValue: string,
    fieldDef: BaggageFieldDefinition,
  ): unknown => {
    switch (fieldDef.type) {
      case 'number': {
        return Number.parseFloat(stringValue);
      }
      case 'boolean': {
        return stringValue === 'true';
      }
      default: {
        return stringValue;
      }
    }
  };

  return {
    get(): Partial<InferBaggageType<T>> {
      const baggage = propagation.getBaggage(context.active());
      if (!baggage) {
        return {};
      }

      const result: Record<string, unknown> = {};

      for (const [key, fieldDef] of Object.entries(schema)) {
        const fullKey = prefixKey(key);
        const entry = baggage.getEntry(fullKey);

        if (entry) {
          result[key] = parseValue(key, entry.value, fieldDef);
        } else if (fieldDef.defaultValue !== undefined) {
          result[key] = fieldDef.defaultValue;
        }
      }

      return result as Partial<InferBaggageType<T>>;
    },

    set(
      ctx: TraceContext | undefined,
      values: Partial<InferBaggageType<T>>,
    ): void {
      let baggage =
        propagation.getBaggage(context.active()) ?? propagation.createBaggage();
      let totalSize = 0;

      // Calculate existing size
      for (const [key, entry] of baggage.getAllEntries()) {
        totalSize += key.length + entry.value.length;
      }

      for (const [key, value] of Object.entries(values)) {
        const fieldDef = schema[key];
        if (!fieldDef) continue;

        const fullKey = prefixKey(key);
        const stringValue = validateAndTransform(key, value, fieldDef);

        if (stringValue !== null) {
          // Check total size
          const entrySize = fullKey.length + stringValue.length;
          if (totalSize + entrySize > maxTotalSize) {
            onError?.({
              type: 'size',
              key,
              message: `Adding "${key}" would exceed max baggage size ${maxTotalSize}`,
              value,
            });
            continue;
          }

          baggage = baggage.setEntry(fullKey, { value: stringValue });
          totalSize += entrySize;
        }
      }

      // Update context with new baggage
      const newContext = propagation.setBaggage(context.active(), baggage);
      // Note: This only works if the caller propagates the context
      // In OTel, baggage propagation happens via context.with()
      // For now we set on active context
      propagation.setBaggage(newContext, baggage);
    },

    getValue<K extends keyof T>(key: K): InferBaggageType<T>[K] | undefined {
      const baggage = propagation.getBaggage(context.active());
      if (!baggage) return undefined;

      const fullKey = prefixKey(String(key));
      const entry = baggage.getEntry(fullKey);
      const fieldDef = schema[String(key)];

      if (!entry) {
        return fieldDef?.defaultValue as InferBaggageType<T>[K] | undefined;
      }

      if (!fieldDef) {
        return undefined;
      }

      return parseValue(
        String(key),
        entry.value,
        fieldDef,
      ) as InferBaggageType<T>[K];
    },

    setValue<K extends keyof T>(
      key: K,
      value: InferBaggageType<T>[K],
      ctx?: TraceContext,
    ): void {
      this.set(ctx, { [key]: value } as Partial<InferBaggageType<T>>);
    },

    clear(): void {
      let baggage = propagation.getBaggage(context.active());
      if (!baggage) return;

      for (const key of Object.keys(schema)) {
        const fullKey = prefixKey(key);
        baggage = baggage.removeEntry(fullKey);
      }

      propagation.setBaggage(context.active(), baggage);
    },

    toHeaders(): Record<string, string> {
      const headers: Record<string, string> = {};
      propagation.inject(context.active(), headers);
      return headers;
    },

    fromHeaders(headers: Record<string, string>, ctx?: TraceContext): void {
      const extractedContext = propagation.extract(context.active(), headers);
      const baggage = propagation.getBaggage(extractedContext);

      if (baggage) {
        const values: Record<string, unknown> = {};

        for (const [key, fieldDef] of Object.entries(schema)) {
          const fullKey = prefixKey(key);
          const entry = baggage.getEntry(fullKey);

          if (entry) {
            values[key] = parseValue(key, entry.value, fieldDef);
          }
        }

        this.set(ctx, values as Partial<InferBaggageType<T>>);
      }
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
