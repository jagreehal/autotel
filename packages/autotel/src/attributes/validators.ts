/**
 * Attribute validation, PII detection, and guardrails
 * Provides safe-by-default attribute handling with configurable policies
 */

import { REDACTOR_PATTERNS } from '../attribute-redacting-processor';

export interface AttributeGuardrails {
  /** How to handle PII in attributes */
  pii?: 'allow' | 'redact' | 'hash' | 'block';

  /** Maximum length for attribute values */
  maxLength?: number;

  /** Validate enum values against known values */
  validateEnum?: boolean;

  /** Log warnings for deprecated attributes instead of throwing */
  warnDeprecated?: boolean;

  /** Custom deprecation warnings */
  deprecatedWarnings?: Record<string, string>;
}

export interface AttributePolicy {
  guardrails?: AttributeGuardrails;
  /** Custom deprecation warnings for specific attributes */
  deprecatedWarnings?: Record<string, string>;
}

const DEPRECATED_ATTRIBUTES = {
  'enduser.id': 'user.id',
  'enduser.role': 'user.roles',
  'enduser.scope': undefined,
  'http.method': 'http.request.method',
  'http.host': 'server.address',
  'http.status_code': 'http.response.status_code',
  'http.target': 'url.path',
  'http.url': 'url.full',
  'http.user_agent': 'user_agent.original',
  'http.flavor': 'network.protocol.name',
  'http.scheme': 'url.scheme',
  'http.server_name': 'server.address',
  'db.name': 'db.namespace',
  'db.operation': 'db.operation.name',
  'db.statement': 'db.query.text',
  'db.system': 'db.system.name',
  'db.collection': 'db.collection.name',
  'db.instance.id': undefined,
  'db.jdbc.driver_classname': undefined,
  'db.mssql.instance_name': 'mssql.instance.name',
  'db.sql.table': 'db.collection.name',
  'http.client_ip': 'client.address',
  'user_agent.original': 'user_agent.original',
} as const;

const HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'QUERY',
  '_OTHER',
]);

export function validateAttribute(
  key: string,
  value: unknown,
  policy: AttributePolicy = {},
): unknown {
  const { guardrails = {} } = policy;

  if (value === undefined || value === null) {
    return undefined;
  }

  // For non-string values that don't need transformation, preserve the original type
  if (typeof value !== 'string') {
    // PII checks only apply to strings
    // maxLength only applies to strings
    // validateEnum only applies to strings
    return value;
  }

  const stringValue = value;

  if (guardrails.pii) {
    const piiResult = applyPIIPolicy(key, stringValue, guardrails.pii);
    if (piiResult !== stringValue) {
      return piiResult;
    }
  }

  if (guardrails.maxLength && stringValue.length > guardrails.maxLength) {
    return truncateValue(key, stringValue, guardrails.maxLength);
  }

  if (guardrails.validateEnum && HTTP_METHODS.has(stringValue)) {
    const normalizedMethod = normalizeHTTPMethod(stringValue);
    if (normalizedMethod !== stringValue) {
      return normalizedMethod;
    }
  }

  return stringValue;
}

function applyPIIPolicy(
  key: string,
  value: string,
  pii: AttributeGuardrails['pii'],
): string {
  if (pii === 'allow') {
    return value;
  }

  if (pii === 'redact') {
    return redactIfPII(key, value);
  }

  if (pii === 'hash') {
    return hashIfPII(key, value);
  }

  if (pii === 'block' && isPIIKey(key)) {
    throw new Error(
      `PII attribute "${key}" is blocked by guardrails. Use pii: "allow" to enable it.`,
    );
  }

  return value;
}

function isPIIKey(key: string): boolean {
  const piiKeyPatterns = [
    'email',
    'phone',
    'ssn',
    'credit_card',
    'password',
    'secret',
    'token',
    'api_key',
    'authorization',
  ];
  const lowerKey = key.toLowerCase();
  return piiKeyPatterns.some((pattern) => lowerKey.includes(pattern));
}

function redactIfPII(key: string, value: string): string {
  if (isPIIKey(key)) {
    // REDACTOR_PATTERNS values are RegExp patterns
    for (const [, pattern] of Object.entries(REDACTOR_PATTERNS)) {
      if (pattern instanceof RegExp && pattern.test(value)) {
        return '[REDACTED]';
      }
    }
    // If no pattern matched but key is PII, still redact
    return '[REDACTED]';
  }
  return value;
}

function hashIfPII(key: string, value: string): string {
  if (!isPIIKey(key)) {
    return value;
  }

  // Use a simple but consistent hash that produces 32-char hex
  // FNV-1a hash variant producing 128-bit output (32 hex chars)
  const FNV_PRIME = 0x01_00_01_93;
  const FNV_OFFSET = 0x81_1c_9d_c5;

  // Generate 4 32-bit hashes to produce 32 hex chars
  const hashes: number[] = [];
  for (let round = 0; round < 4; round++) {
    let hash = FNV_OFFSET;
    for (let i = 0; i < value.length; i++) {
      hash ^= (value.codePointAt(i) ?? 0) + round;
      hash = Math.imul(hash, FNV_PRIME);
    }
    hashes.push(hash >>> 0); // Convert to unsigned
  }

  return `hash_${hashes.map((h) => h.toString(16).padStart(8, '0')).join('')}`;
}

function truncateValue(key: string, value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength - 3) + '...';
}

function normalizeHTTPMethod(method: string): string {
  const upper = method.toUpperCase();
  if (HTTP_METHODS.has(upper)) {
    return upper;
  }
  return upper;
}

export function checkDeprecatedAttribute(
  key: string,
  policy: AttributePolicy = {},
): string | null {
  const { guardrails = {}, deprecatedWarnings = {} } = policy;
  const { warnDeprecated = true } = guardrails;

  if (!warnDeprecated) {
    return null;
  }

  // Check if the key exists in the deprecated attributes map
  const isDeprecated = key in DEPRECATED_ATTRIBUTES;
  if (isDeprecated) {
    const replacement =
      DEPRECATED_ATTRIBUTES[key as keyof typeof DEPRECATED_ATTRIBUTES];
    if (replacement === undefined) {
      // Deprecated with no replacement (e.g., enduser.scope)
      console.warn(
        `[autotel/attributes] Attribute "${key}" is deprecated and has no replacement. ` +
          `Remove or find a replacement in OpenTelemetry semantic conventions.`,
      );
    } else {
      // Deprecated with a known replacement
      console.warn(
        `[autotel/attributes] Attribute "${key}" is deprecated. Use "${replacement}" instead.`,
      );
    }
  }

  if (deprecatedWarnings[key]) {
    console.warn(`[autotel/attributes] ${deprecatedWarnings[key]}`);
  }

  const replacement =
    DEPRECATED_ATTRIBUTES[key as keyof typeof DEPRECATED_ATTRIBUTES];
  return replacement ?? null;
}

export function autoRedactPII(
  attributes: Record<string, unknown>,
  policy: AttributePolicy = {},
): Record<string, unknown> {
  const { guardrails = { pii: 'redact' } } = policy;

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    redacted[key] = validateAttribute(key, value, { guardrails });
  }
  return redacted;
}

export function defaultGuardrails(): AttributeGuardrails {
  return {
    pii: 'redact',
    maxLength: 255,
    validateEnum: true,
    warnDeprecated: true,
  };
}
