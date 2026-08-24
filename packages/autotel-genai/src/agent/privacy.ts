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

/**
 * What a privacy profile took out of a payload. Redaction reduces risk; it
 * cannot prove a payload is clean, and a sanitised payload with no counts is
 * indistinguishable from one that never held anything sensitive.
 */
export interface SanitizationEvidence {
  /** Values dropped entirely (`dropKeys`). */
  redacted: number;
  /** Values replaced by a hash (`hashKeys`). */
  hashed: number;
  /** Values partially obscured (`maskKeys`). */
  masked: number;
  /** Strings cut at `maxStringLength`. */
  truncated: number;
}

function emptyEvidence(): SanitizationEvidence {
  return { redacted: 0, hashed: 0, masked: 0, truncated: 0 };
}

function maskValue(value: unknown): string {
  const text = asString(value);
  if (text === undefined) return '<masked>';
  if (text.length <= 6) return '***';
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

function matches(patterns: RegExp[] | undefined, key: string): boolean {
  return patterns?.some((pattern) => pattern.test(key)) ?? false;
}

function truncateString(
  value: string,
  maxLength: number | undefined,
  tally: SanitizationEvidence,
): string {
  if (maxLength === undefined || value.length <= maxLength) {
    return value;
  }

  tally.truncated += 1;
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
  tally: SanitizationEvidence,
): SanitizedValue {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const lowered = keyPath.toLowerCase();

  if (matches(profile.dropKeys, lowered)) {
    tally.redacted += 1;
    return '<redacted>';
  }

  if (matches(profile.hashKeys, lowered)) {
    tally.hashed += 1;
    return hashPayload(value);
  }

  if (matches(profile.maskKeys, lowered)) {
    tally.masked += 1;
    return maskValue(value);
  }

  const text = asString(value);
  if (text !== undefined) {
    return truncateString(text, profile.maxStringLength, tally);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizeNode(entry, profile, `${keyPath}[${index}]`, tally),
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
        tally,
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
  return sanitizeAuditPayloadWithEvidence(value, profile).value;
}

/**
 * Sanitize, and report what was taken out. Use this wherever the sanitised
 * payload is shown, exported, or shared — the counts are what let a reader
 * tell a clean payload from a stripped one.
 */
export function sanitizeAuditPayloadWithEvidence(
  value: unknown,
  profile: PrivacyProfileInput = 'strict',
): { value: SanitizedValue; evidence: SanitizationEvidence } {
  const tally = emptyEvidence();
  const sanitized = sanitizeNode(
    value,
    resolvePrivacyProfile(profile),
    '',
    tally,
  );
  return { value: sanitized, evidence: tally };
}
