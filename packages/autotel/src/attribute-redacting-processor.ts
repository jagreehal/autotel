/**
 * Attribute Redacting Processor
 *
 * Automatically redacts PII and sensitive data from span attributes before export.
 * This is critical for compliance (GDPR, PCI-DSS, HIPAA) and data security.
 *
 * @example Basic usage with preset
 * ```typescript
 * init({
 *   service: 'my-app',
 *   attributeRedactor: 'default'
 * })
 * ```
 *
 * @example Custom patterns
 * ```typescript
 * init({
 *   service: 'my-app',
 *   attributeRedactor: {
 *     keyPatterns: [/password/i, /secret/i],
 *     valuePatterns: [
 *       { name: 'customerId', pattern: /CUST-\d{8}/g, replacement: 'CUST-***' }
 *     ]
 *   }
 * })
 * ```
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Context, AttributeValue, Attributes } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';

/**
 * Custom redactor function type
 */
export type AttributeRedactorFn = (
  key: string,
  value: AttributeValue,
) => AttributeValue;

/**
 * Built-in redactor preset names
 */
export type AttributeRedactorPreset = 'default' | 'strict' | 'pci-dss';

/**
 * Value pattern configuration
 */
export interface ValuePatternConfig {
  /** Name for debugging/logging */
  name: string;
  /** Regex pattern to match in values */
  pattern: RegExp;
  /** Custom replacement (default: uses global replacement) */
  replacement?: string;
}

/**
 * Attribute redactor configuration
 */
export interface AttributeRedactorConfig {
  /** Patterns to match against attribute keys (redacts entire value if key matches) */
  keyPatterns?: RegExp[];

  /** Patterns to match against attribute values (redacts matched portion) */
  valuePatterns?: ValuePatternConfig[];

  /** Default replacement string (default: '[REDACTED]') */
  replacement?: string;

  /** Custom redactor function for full control */
  redactor?: AttributeRedactorFn;
}

/**
 * Processor options
 */
export interface AttributeRedactingProcessorOptions {
  redactor: AttributeRedactorConfig | AttributeRedactorPreset;
}

/**
 * Built-in patterns for detecting sensitive data
 */
export const REDACTOR_PATTERNS = {
  // Value patterns (match content in attribute values)
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
  phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  ssn: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
  creditCard: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
  bearerToken: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  apiKeyInValue: /(?:api[_-]?key|apikey|api_secret)[=:][\s"']*[A-Za-z0-9_-]+/gi,
  jwt: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,

  // Key patterns (match attribute names - redacts entire value)
  sensitiveKey:
    /^(password|passwd|pwd|secret|token|api[_-]?key|auth|credential|private[_-]?key|authorization)$/i,
} as const;

/**
 * Default value patterns for the 'default' preset
 */
const DEFAULT_VALUE_PATTERNS: ValuePatternConfig[] = [
  { name: 'email', pattern: REDACTOR_PATTERNS.email },
  { name: 'phone', pattern: REDACTOR_PATTERNS.phone },
  { name: 'ssn', pattern: REDACTOR_PATTERNS.ssn },
  { name: 'creditCard', pattern: REDACTOR_PATTERNS.creditCard },
];

/**
 * Built-in redactor presets
 */
export const REDACTOR_PRESETS: Record<
  AttributeRedactorPreset,
  AttributeRedactorConfig
> = {
  /**
   * Default preset - covers common PII patterns
   * Detects: emails, phone numbers, SSNs, credit cards
   * Redacts keys: password, secret, token, apiKey, auth, credential
   */
  default: {
    keyPatterns: [REDACTOR_PATTERNS.sensitiveKey],
    valuePatterns: DEFAULT_VALUE_PATTERNS,
    replacement: '[REDACTED]',
  },

  /**
   * Strict preset - more aggressive redaction for high-security environments
   * Includes everything in default plus: Bearer tokens, JWTs, API keys in values
   */
  strict: {
    keyPatterns: [REDACTOR_PATTERNS.sensitiveKey, /bearer/i, /jwt/i],
    valuePatterns: [
      ...DEFAULT_VALUE_PATTERNS,
      { name: 'bearerToken', pattern: REDACTOR_PATTERNS.bearerToken },
      { name: 'apiKeyInValue', pattern: REDACTOR_PATTERNS.apiKeyInValue },
      { name: 'jwt', pattern: REDACTOR_PATTERNS.jwt },
    ],
    replacement: '[REDACTED]',
  },

  /**
   * PCI-DSS preset - focused on payment card industry compliance
   * Redacts: credit card numbers, CVV-like patterns, card-related keys
   */
  'pci-dss': {
    keyPatterns: [/card/i, /cvv/i, /cvc/i, /pan/i, /expir/i, /ccn/i],
    valuePatterns: [
      { name: 'creditCard', pattern: REDACTOR_PATTERNS.creditCard },
    ],
    replacement: '[REDACTED]',
  },
};

/**
 * Resolve config to a normalized form
 */
function resolveConfig(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): AttributeRedactorConfig {
  if (typeof config === 'string') {
    const preset = REDACTOR_PRESETS[config];
    if (!preset) {
      throw new Error(
        `Unknown attribute redactor preset: "${config}". ` +
          `Available presets: ${Object.keys(REDACTOR_PRESETS).join(', ')}`,
      );
    }
    return preset;
  }
  return config;
}

/**
 * Create a redactor function from config
 */
function createRedactorFromConfig(
  config: AttributeRedactorConfig,
): AttributeRedactorFn {
  // If custom redactor provided, use it directly
  if (config.redactor) {
    return config.redactor;
  }

  const keyPatterns = config.keyPatterns ?? [];
  const valuePatterns = config.valuePatterns ?? [];
  const defaultReplacement = config.replacement ?? '[REDACTED]';

  return (key: string, value: AttributeValue): AttributeValue => {
    // Check if key matches any sensitive key pattern
    for (const pattern of keyPatterns) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      if (pattern.test(key)) {
        return defaultReplacement;
      }
    }

    // For non-string values, return as-is (can't pattern match)
    if (typeof value !== 'string') {
      // Handle arrays of strings
      if (Array.isArray(value)) {
        return value.map((item) => {
          if (typeof item === 'string') {
            return redactStringValue(
              item,
              valuePatterns,
              defaultReplacement,
            ) as string;
          }
          return item;
        }) as AttributeValue;
      }
      return value;
    }

    // Apply value patterns to string values
    return redactStringValue(value, valuePatterns, defaultReplacement);
  };
}

/**
 * Apply value patterns to a string
 */
function redactStringValue(
  value: string,
  patterns: ValuePatternConfig[],
  defaultReplacement: string,
): string {
  let result = value;
  for (const { pattern, replacement } of patterns) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replaceAll(pattern, replacement ?? defaultReplacement);
  }
  return result;
}

/**
 * Create a proxy wrapper around ReadableSpan with redacted attributes
 *
 * Since ReadableSpan.attributes is readonly, we use a Proxy to intercept
 * attribute access and return the redacted version.
 */
function createRedactedSpan(
  span: ReadableSpan,
  redactor: AttributeRedactorFn,
): ReadableSpan {
  // Pre-compute redacted attributes (cached for efficiency)
  const redactedAttributes: Attributes = {};
  for (const [key, value] of Object.entries(span.attributes)) {
    if (value !== undefined) {
      redactedAttributes[key] = redactor(key, value);
    }
  }

  // Return a proxy that intercepts attribute access
  return new Proxy(span, {
    get(target, prop) {
      if (prop === 'attributes') {
        return redactedAttributes;
      }
      // For all other properties, delegate to the original span
      const value = Reflect.get(target, prop);
      // Bind methods to the original target
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

/**
 * Create an attribute redactor function from a config or preset.
 *
 * This is useful when you need to apply the same redaction logic
 * outside of the span processor pipeline (e.g., for canonical log lines).
 *
 * @example
 * ```typescript
 * const redactor = createAttributeRedactor('default');
 * const redactedValue = redactor('user.password', 'secret123');
 * // redactedValue === '[REDACTED]'
 * ```
 */
export function createAttributeRedactor(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): AttributeRedactorFn {
  return createRedactorFromConfig(resolveConfig(config));
}

/**
 * Span processor that redacts sensitive data from span attributes.
 *
 * Redaction happens in onEnd() when all attributes are finalized.
 * Uses a Proxy wrapper to intercept attribute access since ReadableSpan
 * attributes are readonly.
 *
 * Common use cases:
 * - PII compliance (GDPR, CCPA)
 * - PCI-DSS compliance for payment data
 * - Preventing secrets from leaking to observability backends
 */
export class AttributeRedactingProcessor implements SpanProcessor {
  private readonly wrappedProcessor: SpanProcessor;
  private readonly redactor: AttributeRedactorFn;

  constructor(
    wrappedProcessor: SpanProcessor,
    options: AttributeRedactingProcessorOptions,
  ) {
    this.wrappedProcessor = wrappedProcessor;
    const config = resolveConfig(options.redactor);
    this.redactor = createRedactorFromConfig(config);
  }

  /**
   * Pass through onStart unchanged - attributes aren't finalized yet
   */
  onStart(span: Span, parentContext: Context): void {
    this.wrappedProcessor.onStart(span, parentContext);
  }

  /**
   * Redact attributes and forward to wrapped processor
   */
  onEnd(span: ReadableSpan): void {
    try {
      const redactedSpan = createRedactedSpan(span, this.redactor);
      this.wrappedProcessor.onEnd(redactedSpan);
    } catch {
      // Fail-open: if redaction fails, forward original span
      // This ensures we don't lose telemetry due to redaction errors
      this.wrappedProcessor.onEnd(span);
    }
  }

  forceFlush(): Promise<void> {
    return this.wrappedProcessor.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.wrappedProcessor.shutdown();
  }
}

/**
 * Export createRedactedSpan for advanced users who want to use it directly
 */
export { createRedactedSpan };
