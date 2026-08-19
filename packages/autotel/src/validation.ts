/**
 * Input validation for events events and attributes
 *
 * Prevents:
 * - Invalid event names
 * - Oversized payloads
 * - Circular references
 * - Sensitive data leaks
 */

import type { EventAttributes } from './event-subscriber';
import type { UnknownRecord } from './values';
import {
  asBoolean,
  asNumber,
  asRecord,
  asString,
  describeValue,
} from './values';

export interface ValidationConfig {
  /** Max event name length (default: 100) */
  maxEventNameLength: number;
  /** Max attribute key length (default: 100) */
  maxAttributeKeyLength: number;
  /** Max attribute value length for strings (default: 1000) */
  maxAttributeValueLength: number;
  /** Max total attributes per event (default: 50) */
  maxAttributeCount: number;
  /** Max nesting depth for objects (default: 3) */
  maxNestingDepth: number;
  /** Sensitive field patterns to redact */
  sensitivePatterns: RegExp[];
}

const DEFAULT_CONFIG: ValidationConfig = {
  maxEventNameLength: 100,
  maxAttributeKeyLength: 100,
  maxAttributeValueLength: 1000,
  maxAttributeCount: 50,
  maxNestingDepth: 3,
  sensitivePatterns: [
    /password/i,
    /secret/i,
    /token/i,
    /api[_-]?key/i,
    /access[_-]?key/i,
    /private[_-]?key/i,
    /auth/i,
    /credential/i,
    /ssn/i,
    /credit[_-]?card/i,
  ],
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate and sanitize event name
 * Throws ValidationError if invalid
 */
export function validateEventName(
  eventName: string,
  config: ValidationConfig = DEFAULT_CONFIG,
): string {
  // Check type
  if (asString(eventName) === undefined) {
    throw new ValidationError(
      `Event name must be a string, got ${describeValue(eventName)}`,
    );
  }

  // Check non-empty
  const trimmed = eventName.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Event name cannot be empty');
  }

  // Check length
  if (trimmed.length > config.maxEventNameLength) {
    throw new ValidationError(
      `Event name too long (${trimmed.length} chars). ` +
        `Max: ${config.maxEventNameLength}`,
    );
  }

  // Check valid characters (alphanumeric, dots, underscores, hyphens)
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new ValidationError(
      `Event name contains invalid characters: "${trimmed}". ` +
        'Use only letters, numbers, dots, underscores, and hyphens.',
    );
  }

  return trimmed;
}

/**
 * Validate and sanitize attributes
 * Returns sanitized attributes (sensitive data redacted)
 */
export function validateAttributes(
  attributes: EventAttributes | undefined,
  config: ValidationConfig = DEFAULT_CONFIG,
): EventAttributes | undefined {
  if (attributes === undefined || attributes === null) {
    return undefined;
  }

  // Check type
  if (!asRecord(attributes)) {
    throw new ValidationError('Attributes must be an object');
  }

  // Count attributes
  const keys = Object.keys(attributes);
  if (keys.length > config.maxAttributeCount) {
    throw new ValidationError(
      `Too many attributes (${keys.length}). ` +
        `Max: ${config.maxAttributeCount}`,
    );
  }

  // Validate and sanitize each attribute
  const sanitized: EventAttributes = {};

  for (const key of keys) {
    // Validate key
    if (key.length > config.maxAttributeKeyLength) {
      throw new ValidationError(
        `Attribute key too long: "${key.slice(0, 20)}..." ` +
          `(${key.length} chars). Max: ${config.maxAttributeKeyLength}`,
      );
    }

    const value = attributes[key];

    // Redact sensitive *strings* only. Numeric/boolean values are not
    // credentials and replacing them with the literal string '[REDACTED]'
    // both leaks no useful signal and breaks downstream type expectations
    // (e.g. an LLM `promptTokens` counter becoming a string poisons every
    // consumer that treats it as a number).
    if (isSensitiveString(key, value, config)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // SAFETY: sanitizeValue answers with the same kind of value it was given -
    // a truncated string for a string, the number or boolean as it stands, a
    // sanitized copy for a container - so it stays a valid attribute value.
    sanitized[key] = sanitizeValue(value, config, 1) as
      string | number | boolean;
  }

  return sanitized;
}

/**
 * A value that has been through sanitization: a primitive, or a container of
 * sanitized values. Strings may be truncated, credentials replaced, and a
 * value the exporters cannot carry is described rather than dropped.
 */
export type SanitizedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SanitizedValue[]
  | { [key: string]: SanitizedValue };

/**
 * Whether this key/value pair is a credential to redact. Strings only:
 * numeric and boolean values are not credentials, and replacing them with the
 * literal '[REDACTED]' leaks no signal while breaking every consumer that
 * treats them as a number.
 */
function isSensitiveString(
  key: string,
  value: unknown,
  config: ValidationConfig,
): boolean {
  return (
    asString(value) !== undefined &&
    config.sensitivePatterns.some((pattern) => pattern.test(key))
  );
}

/**
 * Sanitize attribute value (recursive)
 */
function sanitizeValue(
  value: unknown,
  config: ValidationConfig,
  depth: number,
): SanitizedValue {
  // Check nesting depth
  if (depth > config.maxNestingDepth) {
    return '[MAX_DEPTH_EXCEEDED]';
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle primitives
  const text = asString(value);
  if (text !== undefined) {
    return text.length > config.maxAttributeValueLength
      ? text.slice(0, config.maxAttributeValueLength) + '...'
      : text;
  }

  const scalar = asNumber(value) ?? asBoolean(value);
  if (scalar !== undefined) return scalar;

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, config, depth + 1));
  }

  // Handle objects
  const record = asRecord(value);
  if (record) {
    try {
      // Check for circular references
      JSON.stringify(record);

      const sanitized: Record<string, SanitizedValue> = {};
      for (const [key, nested] of Object.entries(record)) {
        // See top-level branch above: only string values are redacted.
        sanitized[key] = isSensitiveString(key, nested, config)
          ? '[REDACTED]'
          : sanitizeValue(nested, config, depth + 1);
      }
      return sanitized;
    } catch {
      // Circular reference detected
      return '[CIRCULAR]';
    }
  }

  // Unsupported type (function, symbol, etc.)
  return `[${describeValue(value)}]`;
}

/** An event that has been through validation, ready to emit. */
export interface ValidatedEvent {
  eventName: string;
  attributes?: EventAttributes;
}

/**
 * Validate and sanitize an events event
 * Returns { eventName, attributes } with sanitized values
 */
export function validateEvent(
  eventName: string,
  attributes?: EventAttributes,
  config?: Partial<ValidationConfig>,
): ValidatedEvent {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    eventName: validateEventName(eventName, fullConfig),
    attributes: validateAttributes(attributes, fullConfig),
  };
}

/**
 * Get default validation config (for testing/customization)
 */
export function getDefaultValidationConfig(): ValidationConfig {
  return { ...DEFAULT_CONFIG };
}
