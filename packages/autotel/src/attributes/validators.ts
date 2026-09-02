/**
 * Attribute validation, PII detection, and guardrails
 * Provides safe-by-default attribute handling with configurable policies
 */

import type { AttributeValue, Attributes } from '@opentelemetry/api';
import { REDACTOR_PATTERNS } from '../attribute-redacting-processor';
import { asString } from '../values';

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

/**
 * Attributes OpenTelemetry has renamed, mapped to their replacement - or to
 * `null` where the convention dropped them outright.
 */
const DEPRECATED_ATTRIBUTES = new Map<string, string | null>([
  ['enduser.id', 'user.id'],
  ['enduser.role', 'user.roles'],
  ['enduser.scope', null],
  ['http.method', 'http.request.method'],
  ['http.host', 'server.address'],
  ['http.status_code', 'http.response.status_code'],
  ['http.target', 'url.path'],
  ['http.url', 'url.full'],
  ['http.user_agent', 'user_agent.original'],
  ['http.flavor', 'network.protocol.name'],
  ['http.scheme', 'url.scheme'],
  ['http.server_name', 'server.address'],
  ['db.name', 'db.namespace'],
  ['db.operation', 'db.operation.name'],
  ['db.statement', 'db.query.text'],
  ['db.system', 'db.system.name'],
  ['rpc.system', 'rpc.system.name'],
  ['messaging.operation', 'messaging.operation.type'],
  ['db.collection', 'db.collection.name'],
  ['db.instance.id', null],
  ['db.jdbc.driver_classname', null],
  ['db.mssql.instance_name', 'mssql.instance.name'],
  ['db.sql.table', 'db.collection.name'],
  ['http.client_ip', 'client.address'],
  ['user_agent.original', 'user_agent.original'],
]);

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
  value: AttributeValue | undefined,
  policy: AttributePolicy = {},
): AttributeValue | undefined {
  const { guardrails = {} } = policy;

  if (value === undefined || value === null) {
    return undefined;
  }

  // PII, maxLength and validateEnum all only apply to strings; anything else
  // is preserved as it arrived.
  const stringValue = asString(value);
  if (stringValue === undefined) {
    return value;
  }

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

  const replacement = DEPRECATED_ATTRIBUTES.get(key) ?? null;
  if (DEPRECATED_ATTRIBUTES.has(key)) {
    if (replacement === null) {
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

  return replacement;
}

export function autoRedactPII(
  attributes: Attributes,
  policy: AttributePolicy = {},
): Attributes {
  const { guardrails = { pii: 'redact' } } = policy;

  const redacted: Attributes = {};
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
