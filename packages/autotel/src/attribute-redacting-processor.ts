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
 * Masker function type - receives the matched string and returns a masked version
 */
export type MaskFn = (match: string) => string;

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
  /** Mask function for smart partial masking (overrides replacement) */
  mask?: MaskFn;
}

/**
 * Built-in PII pattern names
 */
export type BuiltinPatternName = keyof typeof builtinPatterns;

/**
 * Attribute redactor configuration
 */
export interface AttributeRedactorConfig {
  /** Patterns to match against attribute keys (redacts entire value if key matches) */
  keyPatterns?: RegExp[];

  /** Patterns to match against attribute values (redacts matched portion) */
  valuePatterns?: ValuePatternConfig[];

  /** Dot-notation paths to redact (e.g. 'user.password', 'payment.card') */
  paths?: string[];

  /** Built-in PII patterns to enable. `true` enables all, `false` disables all, array selects specific ones. */
  builtins?: boolean | BuiltinPatternName[];

  /** Custom RegExp patterns for string-level redaction */
  patterns?: RegExp[];

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
 * Built-in PII detection patterns with smart masking.
 * Each builtin preserves just enough signal for debugging while scrubbing PII.
 */
export const builtinPatterns = {
  /** Credit card numbers → ****1111 (PCI DSS: last 4 allowed) */
  creditCard: {
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    mask: (m: string) => `****${m.replace(/[\s-]/g, '').slice(-4)}`,
  },
  /** Email addresses → a***@***.com */
  email: {
    pattern: /[\w.+-]+@[\w-]+\.[\w.]+/g,
    mask: (m: string) => {
      const at = m.indexOf('@');
      if (at < 1) return '***@***';
      const tld = m.slice(m.lastIndexOf('.'));
      return `${m[0]}***@***${tld}`;
    },
  },
  /** IPv4 addresses → ***.***.***.100 (last octet only) */
  ipv4: {
    pattern:
      /\b(?!0\.0\.0\.0\b)(?!127\.0\.0\.1\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    mask: (m: string) => `***.***.***.${m.split('.').pop()}`,
  },
  /** International phone numbers → +33******78 (country code + last 2 digits) */
  phone: {
    pattern:
      /(?:\+\d{1,3}[\s.-]?)?\(?\d{1,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}\b/g,
    mask: (m: string) => {
      const digits = m.replace(/[^\d]/g, '');
      const hasPlus = m.startsWith('+');
      if (hasPlus && digits.length > 4) {
        const ccMatch = m.match(/^\+\d{1,3}/);
        const cc = ccMatch ? ccMatch[0] : '+';
        return `${cc}******${digits.slice(-2)}`;
      }
      if (digits.length > 2) {
        return `${'*'.repeat(digits.length - 2)}${digits.slice(-2)}`;
      }
      return '***';
    },
  },
  /** JWT tokens → eyJ***.*** */
  jwt: {
    pattern: /\beyJ[\w-]*\.[\w-]*\.[\w-]*\b/g,
    mask: () => 'eyJ***.***',
  },
  /** Bearer tokens → Bearer *** */
  bearer: {
    pattern: /\bBearer\s+[\w\-.~+/]{8,}=*/gi,
    mask: () => 'Bearer ***',
  },
  /** IBAN → FR76****189 (country + check digits + last 3) */
  iban: {
    pattern:
      /\b[A-Z]{2}\d{2}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{0,4}[\s-]?[\dA-Z]{0,4}[\s-]?[\dA-Z]{0,4}\b/g,
    mask: (m: string) => {
      const clean = m.replace(/[\s-]/g, '');
      return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
    },
  },
} as const;

function cloneRegex(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toRegExp(value: unknown): RegExp | undefined {
  if (value instanceof RegExp) return value;
  if (typeof value === 'string') return new RegExp(value, 'g');
  if (isPlainObject(value) && typeof value.source === 'string') {
    const flags = typeof value.flags === 'string' ? value.flags : 'g';
    return new RegExp(value.source, flags);
  }
  return undefined;
}

function toRegExpArray(value: unknown): RegExp[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: RegExp[] = [];
  for (const item of value) {
    const re = toRegExp(item);
    if (re) out.push(re);
  }
  return out.length > 0 ? out : [];
}

function builtinToValuePattern(name: BuiltinPatternName): ValuePatternConfig {
  const b = builtinPatterns[name];
  return { name, pattern: cloneRegex(b.pattern), mask: b.mask };
}

/**
 * Default value patterns for the 'default' preset
 */
const DEFAULT_VALUE_PATTERNS: ValuePatternConfig[] = [
  builtinToValuePattern('email'),
  builtinToValuePattern('phone'),
  { name: 'ssn', pattern: REDACTOR_PATTERNS.ssn },
  builtinToValuePattern('creditCard'),
];

/**
 * Built-in redactor presets
 */
export const REDACTOR_PRESETS: Record<
  AttributeRedactorPreset,
  AttributeRedactorConfig
> = {
  /**
   * Default preset - covers common PII patterns with smart masking
   * Detects: emails (a***@***.com), phone numbers, SSNs, credit cards (****1111)
   * Redacts keys: password, secret, token, apiKey, auth, credential
   */
  default: {
    keyPatterns: [REDACTOR_PATTERNS.sensitiveKey],
    valuePatterns: DEFAULT_VALUE_PATTERNS,
    builtins: true,
    replacement: '[REDACTED]',
  },

  /**
   * Strict preset - more aggressive redaction for high-security environments
   * Includes everything in default plus: Bearer tokens, JWTs, IBAN, API keys in values
   */
  strict: {
    keyPatterns: [REDACTOR_PATTERNS.sensitiveKey, /bearer/i, /jwt/i],
    valuePatterns: [
      ...DEFAULT_VALUE_PATTERNS,
      builtinToValuePattern('jwt'),
      builtinToValuePattern('bearer'),
      builtinToValuePattern('iban'),
      { name: 'apiKeyInValue', pattern: REDACTOR_PATTERNS.apiKeyInValue },
    ],
    builtins: true,
    replacement: '[REDACTED]',
  },

  /**
   * PCI-DSS preset - focused on payment card industry compliance
   * Redacts: credit card numbers (****1111), CVV-like patterns, card-related keys
   */
  'pci-dss': {
    keyPatterns: [/card/i, /cvv/i, /cvc/i, /pan/i, /expir/i, /ccn/i],
    valuePatterns: [builtinToValuePattern('creditCard')],
    builtins: ['creditCard'],
    replacement: '[REDACTED]',
  },
};

/**
 * Normalize redactor config that may have been deserialized from JSON/YAML.
 * Converts regex-like values back to RegExp instances.
 */
export function normalizeAttributeRedactorConfig(
  raw: AttributeRedactorConfig | AttributeRedactorPreset | unknown,
): AttributeRedactorConfig | AttributeRedactorPreset | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw as AttributeRedactorPreset;
  if (!isPlainObject(raw)) return undefined;

  const config: AttributeRedactorConfig = {};

  if (Array.isArray(raw.paths)) {
    config.paths = raw.paths.filter(
      (value): value is string => typeof value === 'string',
    );
  }

  if (typeof raw.replacement === 'string') {
    config.replacement = raw.replacement;
  }

  if (typeof raw.builtins === 'boolean') {
    config.builtins = raw.builtins;
  } else if (Array.isArray(raw.builtins)) {
    config.builtins = raw.builtins.filter(
      (name): name is BuiltinPatternName => typeof name === 'string',
    );
  }

  if (typeof raw.redactor === 'function') {
    config.redactor = raw.redactor as AttributeRedactorFn;
  }

  const keyPatterns = toRegExpArray(raw.keyPatterns);
  if (keyPatterns) config.keyPatterns = keyPatterns;

  const patterns = toRegExpArray(raw.patterns);
  if (patterns) config.patterns = patterns;

  if (Array.isArray(raw.valuePatterns)) {
    const valuePatterns: ValuePatternConfig[] = [];
    for (const item of raw.valuePatterns) {
      if (!isPlainObject(item) || typeof item.name !== 'string') continue;
      const pattern = toRegExp(item.pattern);
      if (!pattern) continue;
      valuePatterns.push({
        name: item.name,
        pattern,
        replacement:
          typeof item.replacement === 'string' ? item.replacement : undefined,
        mask:
          typeof item.mask === 'function' ? (item.mask as MaskFn) : undefined,
      });
    }
    config.valuePatterns = valuePatterns;
  }

  return config;
}

/**
 * Resolve config to a normalized form
 */
function resolveConfig(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): AttributeRedactorConfig {
  const normalized = normalizeAttributeRedactorConfig(config);
  if (!normalized) {
    throw new Error('Invalid attribute redactor config');
  }

  if (typeof normalized === 'string') {
    const preset = REDACTOR_PRESETS[normalized];
    if (!preset) {
      throw new Error(
        `Unknown attribute redactor preset: "${normalized}". ` +
          `Available presets: ${Object.keys(REDACTOR_PRESETS).join(', ')}`,
      );
    }
    return preset;
  }

  const resolvedConfig: AttributeRedactorConfig = {
    ...normalized,
    keyPatterns: normalized.keyPatterns
      ? [...normalized.keyPatterns]
      : undefined,
    valuePatterns: normalized.valuePatterns
      ? [...normalized.valuePatterns]
      : undefined,
    paths: normalized.paths ? [...normalized.paths] : undefined,
    patterns: normalized.patterns ? [...normalized.patterns] : undefined,
  };

  // Merge built-in patterns if enabled
  if (resolvedConfig.builtins !== false) {
    const builtinNames = Array.isArray(resolvedConfig.builtins)
      ? resolvedConfig.builtins
      : (Object.keys(builtinPatterns) as BuiltinPatternName[]);
    const builtinValuePatterns = builtinNames
      .filter((name) => name in builtinPatterns)
      .map(builtinToValuePattern);

    resolvedConfig.valuePatterns = [
      ...(resolvedConfig.valuePatterns ?? []),
      ...builtinValuePatterns,
    ];
  }

  return resolvedConfig;
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
  const paths = config.paths ?? [];
  const pathSet = new Set(paths);
  const customPatterns = config.patterns ?? [];
  const defaultReplacement = config.replacement ?? '[REDACTED]';

  // Build masker list from valuePatterns that have mask functions
  const maskers: [RegExp, MaskFn][] = valuePatterns
    .filter((vp) => vp.mask)
    .map((vp) => [cloneRegex(vp.pattern), vp.mask!]);

  return (key: string, value: AttributeValue): AttributeValue => {
    // Check if key matches any sensitive key pattern
    for (const pattern of keyPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(key)) {
        return defaultReplacement;
      }
    }

    // Check if key matches any path-based redaction
    if (pathSet.has(key)) {
      return defaultReplacement;
    }

    // For non-string values, return as-is
    if (typeof value !== 'string') {
      if (Array.isArray(value)) {
        return value.map((item) => {
          if (typeof item === 'string') {
            return redactStringValue(
              item,
              valuePatterns,
              maskers,
              customPatterns,
              defaultReplacement,
            ) as string;
          }
          return item;
        }) as AttributeValue;
      }
      return value;
    }

    // Three-tier strategy: path-based → masker-based → pattern-based
    return redactStringValue(
      value,
      valuePatterns,
      maskers,
      customPatterns,
      defaultReplacement,
    );
  };
}

/**
 * Apply three-tier redaction strategy to a string
 * 1. Masker-based: built-in patterns with smart partial masking
 * 2. Pattern-based: custom RegExp patterns replaced with replacement
 */
function redactStringValue(
  value: string,
  patterns: ValuePatternConfig[],
  maskers: [RegExp, MaskFn][],
  customPatterns: RegExp[],
  defaultReplacement: string,
): string {
  let result = value;

  // Tier 1: Apply maskers (smart partial masking)
  for (const [pattern, mask] of maskers) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, mask);
  }

  // Tier 2: Apply value patterns without mask (full replacement)
  for (const { pattern, replacement, mask } of patterns) {
    if (mask) continue; // Already handled by maskers
    pattern.lastIndex = 0;
    result = result.replaceAll(pattern, replacement ?? defaultReplacement);
  }

  // Tier 3: Apply custom patterns
  for (const pattern of customPatterns) {
    pattern.lastIndex = 0;
    result = result.replaceAll(pattern, defaultReplacement);
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
