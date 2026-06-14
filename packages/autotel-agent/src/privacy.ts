import { hashPayload } from './hash.js';
import type { PrivacyProfile, PrivacyProfileName } from './types.js';

export type PrivacyProfileInput = PrivacyProfileName | PrivacyProfile;

const PRIVACY_PROFILES: Record<PrivacyProfileName, PrivacyProfile> = {
  strict: {
    name: 'strict',
    hashKeys: [
      /email/i,
      /phone/i,
      /user_?id/i,
      /account/i,
      /customer/i,
      /card/i,
      /iban/i,
      /tax/i,
    ],
    dropKeys: [
      /secret/i,
      /token/i,
      /api[_-]?key/i,
      /authorization/i,
      /cookie/i,
      /password/i,
      /bearer/i,
    ],
    maskKeys: [/name/i, /address/i, /prompt/i, /message/i, /content/i],
    maxStringLength: 256,
  },
  pci: {
    name: 'pci',
    hashKeys: [/card/i, /pan/i, /account/i, /customer/i, /email/i],
    dropKeys: [/cvv/i, /cvc/i, /secret/i, /token/i, /api[_-]?key/i],
    maskKeys: [/name/i, /address/i],
    maxStringLength: 128,
  },
  healthcare: {
    name: 'healthcare',
    hashKeys: [/patient/i, /mrn/i, /member/i, /email/i, /phone/i],
    dropKeys: [/diagnosis/i, /notes/i, /secret/i, /token/i, /password/i],
    maskKeys: [/name/i, /address/i, /symptom/i],
    maxStringLength: 128,
  },
};

function maskValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return '<masked>';
  }

  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function matches(patterns: RegExp[] | undefined, key: string): boolean {
  return patterns?.some((pattern) => pattern.test(key)) ?? false;
}

function truncateString(value: string, maxLength?: number): string {
  if (maxLength === undefined || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

function sanitizeNode(
  value: unknown,
  profile: PrivacyProfile,
  keyPath: string,
): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const lowered = keyPath.toLowerCase();

  if (matches(profile.dropKeys, lowered)) {
    return '<redacted>';
  }

  if (matches(profile.hashKeys, lowered)) {
    return hashPayload(value);
  }

  if (matches(profile.maskKeys, lowered)) {
    return maskValue(value);
  }

  if (typeof value === 'string') {
    return truncateString(value, profile.maxStringLength);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizeNode(entry, profile, `${keyPath}[${index}]`),
    );
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeNode(entry, profile, keyPath ? `${keyPath}.${key}` : key),
      ]),
    );
  }

  if (typeof value === 'bigint') {
    return value.toString(10);
  }

  return value;
}

export function resolvePrivacyProfile(
  profile: PrivacyProfileInput = 'strict',
): PrivacyProfile {
  return typeof profile === 'string' ? PRIVACY_PROFILES[profile] : profile;
}

export function sanitizeAuditPayload(
  value: unknown,
  profile: PrivacyProfileInput = 'strict',
): unknown {
  return sanitizeNode(value, resolvePrivacyProfile(profile), '');
}
