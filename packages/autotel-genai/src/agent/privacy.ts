import { hashPayload } from './hash.js';
import { asBoolean, asNumber, asRecord, asString } from '../values.js';
import type { PrivacyProfile, PrivacyProfileName } from './types.js';

export type PrivacyProfileInput = PrivacyProfileName | PrivacyProfile;

const PRIVACY_PROFILES = {
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

function maskValue(value: unknown): string {
  const text = asString(value);
  if (text === undefined) return '<masked>';
  if (text.length <= 6) return '***';
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
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

/** A value after sanitising: primitives, or containers of sanitised values. */
export type SanitizedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SanitizedValue[]
  | { [key: string]: SanitizedValue };

function sanitizeNode(
  value: unknown,
  profile: PrivacyProfile,
  keyPath: string,
): SanitizedValue {
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

  const text = asString(value);
  if (text !== undefined) {
    return truncateString(text, profile.maxStringLength);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizeNode(entry, profile, `${keyPath}[${index}]`),
    );
  }

  const record = asRecord(value);
  if (record) {
    const out: { [key: string]: SanitizedValue } = {};
    for (const [key, entry] of Object.entries(record)) {
      out[key] = sanitizeNode(
        entry,
        profile,
        keyPath ? `${keyPath}.${key}` : key,
      );
    }
    return out;
  }

  if (typeof value === 'bigint') return value.toString(10);

  return (
    asNumber(value) ?? asBoolean(value) ?? (value === null ? null : undefined)
  );
}

export function resolvePrivacyProfile(
  profile: PrivacyProfileInput = 'strict',
): PrivacyProfile {
  // typeof, not asString: this narrows a union of a profile name and a
  // profile object, which only TypeScript's own operator does.
  return typeof profile === 'string' ? PRIVACY_PROFILES[profile] : profile;
}

export function sanitizeAuditPayload(
  value: unknown,
  profile: PrivacyProfileInput = 'strict',
): SanitizedValue {
  return sanitizeNode(value, resolvePrivacyProfile(profile), '');
}
