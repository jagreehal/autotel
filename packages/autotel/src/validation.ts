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
  if (typeof eventName !== 'string') {
    throw new ValidationError(
      `Event name must be a string, got ${typeof eventName}`,
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
  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
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

    // Check for sensitive field
    const isSensitive = config.sensitivePatterns.some((pattern) =>
      pattern.test(key),
    );

    if (isSensitive) {
      // Redact sensitive data
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Sanitize value
    const value = attributes[key];
    sanitized[key] = sanitizeValue(value, config, 1) as
      | string
      | number
      | boolean;
  }

  return sanitized;
}

/**
 * Sanitize attribute value (recursive)
 */
function sanitizeValue(
  value: unknown,
  config: ValidationConfig,
  depth: number,
): unknown {
  // Check nesting depth
  if (depth > config.maxNestingDepth) {
    return '[MAX_DEPTH_EXCEEDED]';
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle primitives
  if (typeof value === 'string') {
    if (value.length > config.maxAttributeValueLength) {
      return value.slice(0, config.maxAttributeValueLength) + '...';
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, config, depth + 1));
  }

  // Handle objects
  if (typeof value === 'object') {
    try {
      // Check for circular references
      JSON.stringify(value);

      const sanitized: Record<string, unknown> = {};
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          sanitized[key] = sanitizeValue(
            (value as Record<string, unknown>)[key],
            config,
            depth + 1,
          );
        }
      }
      return sanitized;
    } catch {
      // Circular reference detected
      return '[CIRCULAR]';
    }
  }

  // Unsupported type (function, symbol, etc.)
  return `[${typeof value}]`;
}

/**
 * Validate and sanitize an events event
 * Returns { eventName, attributes } with sanitized values
 */
export function validateEvent(
  eventName: string,
  attributes?: EventAttributes,
  config?: Partial<ValidationConfig>,
): { eventName: string; attributes?: EventAttributes } {
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
