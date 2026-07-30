import type { FileFacts } from './facts';
import type { RawRouteEntry, Sensitivity } from './types';

const MONEY_PACKAGES = [
  'stripe',
  '@stripe/stripe-js',
  '@paddle/paddle-node-sdk',
  '@lemonsqueezy/lemonsqueezy.js',
  'braintree',
];

const AUTH_PACKAGES = [
  'better-auth',
  'next-auth',
  'lucia',
  '@auth/core',
  '@clerk/nextjs',
  '@clerk/backend',
  'passport',
];

const MONEY_TERMS = [
  'checkout',
  'payment',
  'billing',
  'invoice',
  'refund',
  'subscription',
  'charge',
  'payout',
  'order',
];

const AUTH_TERMS = [
  'auth',
  'oauth',
  'login',
  'logout',
  'signin',
  'signup',
  'register',
  'password',
  'token',
  'session',
  'mfa',
  'otp',
  'admin',
];

/**
 * Whole-word matcher per term, allowing a plural.
 *
 * Anchoring matters more than it looks: with plain substrings `/api/authors`
 * reads as authentication. A route wrongly marked sensitive is handed a
 * 25-point audit requirement it has no reason to satisfy, and counts double in
 * the global score — the fastest way to make the number untrustworthy.
 */
function compileTerms(terms: readonly string[]): (readonly [string, RegExp])[] {
  return terms.map(
    (term) =>
      [
        term,
        new RegExp(`(?:^|[^a-z0-9])${term}s?(?:[^a-z0-9]|$)`, 'i'),
      ] as const,
  );
}

const MONEY_PATTERNS = compileTerms(MONEY_TERMS);
const AUTH_PATTERNS = compileTerms(AUTH_TERMS);

function matchTerm(
  value: string,
  patterns: (readonly [string, RegExp])[],
): string | null {
  for (const [term, pattern] of patterns) {
    if (pattern.test(value)) return term;
  }
  return null;
}

const PII_FIELDS = /email|phone|address|ssn|iban|dateOfBirth|passport/i;
const WRITE_CALLS = new Set(['create', 'update', 'insert', 'upsert', 'delete']);

function importsPackage(facts: FileFacts, pkg: string): boolean {
  for (const specifier of facts.modules) {
    if (specifier === pkg || specifier.startsWith(`${pkg}/`)) return true;
  }
  return false;
}

/**
 * Classify an entry point as money / auth / PII sensitive.
 *
 * Reads resolved imports and the identifiers actually in the AST rather than
 * searching raw source: substring matching cannot tell an import from a
 * comment, so a `// TODO: drop stripe` would be enough to mark a route as
 * handling money.
 */
export function classifySensitivity(
  route: RawRouteEntry,
  facts: FileFacts,
): Sensitivity {
  const reasons: string[] = [];

  for (const pkg of MONEY_PACKAGES) {
    if (importsPackage(facts, pkg)) reasons.push(`money: imports ${pkg}`);
  }
  const moneyTerm = matchTerm(route.path, MONEY_PATTERNS);
  if (moneyTerm) reasons.push(`money: path says "${moneyTerm}"`);

  for (const pkg of AUTH_PACKAGES) {
    if (importsPackage(facts, pkg)) reasons.push(`auth: imports ${pkg}`);
  }
  const authTerm = matchTerm(route.path, AUTH_PATTERNS);
  if (authTerm) reasons.push(`auth: path says "${authTerm}"`);

  const touchesPii = [...facts.names].some((name) => PII_FIELDS.test(name));
  const writes = facts.calls.some((call) =>
    WRITE_CALLS.has(call.member.toLowerCase()),
  );
  if (touchesPii && writes) {
    reasons.push('pii: write operation with sensitive fields');
  }

  const hasMoney = reasons.some((reason) => reason.startsWith('money:'));
  const hasAuth = reasons.some((reason) => reason.startsWith('auth:'));
  const hasPii = reasons.some((reason) => reason.startsWith('pii:'));

  if (hasMoney || hasAuth) return { level: 'high', reasons };
  if (hasPii) return { level: 'medium', reasons };
  return { level: 'none', reasons: [] };
}

/** What makes this entry point sensitive — `money`, `auth`, `pii`, or nothing. */
export function sensitivityLabel(sensitivity: Sensitivity): string {
  if (sensitivity.reasons.some((r) => r.startsWith('money:'))) return 'money';
  if (sensitivity.reasons.some((r) => r.startsWith('auth:'))) return 'auth';
  if (sensitivity.level === 'medium') return 'pii';
  return '';
}
