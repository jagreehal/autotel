/**
 * The propagation allowlist, and the two forms it has to take.
 *
 * Lean mode decides per request from the parsed origin. Full mode hands the
 * same list to OpenTelemetry's `propagateTraceHeaderCorsUrls`, which is matched
 * against the *whole URL* — a string entry by equality, a regex by `.match()`.
 * Both forms are wrong on their own, in opposite directions, so the two modes
 * have to be checked against each other rather than each on its own terms.
 */
import { describe, expect, it } from 'vitest';

import { isPropagationAllowed, propagationUrlPattern } from './propagate';

const PAGE_ORIGIN = 'https://app.example.com';

describe('isPropagationAllowed (lean mode)', () => {
  it('allows the page origin, listed or not', () => {
    expect(isPropagationAllowed(`${PAGE_ORIGIN}/api`, PAGE_ORIGIN)).toBe(true);
    expect(isPropagationAllowed('/api', PAGE_ORIGIN)).toBe(true);
  });

  it('refuses a cross-origin destination that is not listed', () => {
    expect(isPropagationAllowed('https://api.myapp.com/x', PAGE_ORIGIN)).toBe(
      false,
    );
  });

  it('allows a listed cross-origin destination', () => {
    expect(
      isPropagationAllowed('https://api.myapp.com/x', PAGE_ORIGIN, [
        'api.myapp.com',
      ]),
    ).toBe(true);
  });

  it('fails closed on a URL it cannot parse', () => {
    expect(
      isPropagationAllowed('http://[not a url]/x', PAGE_ORIGIN, ['myapp.com']),
    ).toBe(false);
  });
});

describe('propagationUrlPattern (full mode)', () => {
  it('matches the destination a bare string never could', () => {
    // OpenTelemetry compares a string entry to the whole URL by equality, so
    // `propagateTo: ['api.myapp.com']` passed through raw matched nothing and
    // the header was silently never sent.
    const pattern = propagationUrlPattern('api.myapp.com');

    expect(pattern.test('https://api.myapp.com/users')).toBe(true);
    expect(pattern.test('http://api.myapp.com:8080/users?q=1')).toBe(true);
  });

  it('does not match the needle in the path', () => {
    // A bare substring regex does: `new RegExp('api\\.myapp\\.com')` matches
    // this URL, so a third party would have received the header — and the
    // preflight this default exists to avoid.
    const pattern = propagationUrlPattern('api.myapp.com');

    expect(pattern.test('https://third-party.example/api.myapp.com')).toBe(
      false,
    );
    expect(pattern.test('https://third-party.example/?to=api.myapp.com')).toBe(
      false,
    );
    expect(pattern.test('https://third-party.example/#api.myapp.com')).toBe(
      false,
    );
  });

  it('accepts a value written as a full origin', () => {
    // `location.origin` carries a scheme, so people write one.
    const pattern = propagationUrlPattern('https://api.myapp.com');

    expect(pattern.test('https://api.myapp.com/users')).toBe(true);
  });

  it('keeps the scheme the configured value carries', () => {
    // Stripping it to match on the authority alone widened the allowlist: an
    // explicit `https://` origin would also have permitted plaintext.
    const pattern = propagationUrlPattern('https://api.myapp.com');

    expect(pattern.test('http://api.myapp.com/users')).toBe(false);
  });

  it('keeps a configured value anchored to the start of the authority', () => {
    // `https://api.myapp.com` names one host. Matching its authority as a bare
    // substring would also have permitted every subdomain in front of it.
    const pattern = propagationUrlPattern('https://api.myapp.com');

    expect(pattern.test('https://other.api.myapp.com/users')).toBe(false);
    // A value written without a scheme is a substring of the authority, and
    // still matches a longer host - see the substring test below.
    expect(
      propagationUrlPattern('api.myapp.com').test(
        'https://other.api.myapp.com/users',
      ),
    ).toBe(true);
  });

  it('never matches a value carrying a path', () => {
    // An origin has no path; such a value must not match inside one either.
    const pattern = propagationUrlPattern('api.myapp.com/v1');

    expect(pattern.test('https://api.myapp.com/v1/users')).toBe(false);
  });

  it('is a substring match on the authority, as documented', () => {
    // Pinned, not endorsed: this is what "substring-matched" has always meant
    // here, in lean mode and in `privacy.allowedOrigins` before it. A suffix
    // attack (`api.myapp.com.evil.test`) is inside that contract, so tightening
    // it is its own decision rather than a silent change.
    const pattern = propagationUrlPattern('api.myapp.com');

    expect(pattern.test('https://api.myapp.com.evil.test/x')).toBe(true);
    expect(
      isPropagationAllowed('https://api.myapp.com.evil.test/x', PAGE_ORIGIN, [
        'api.myapp.com',
      ]),
    ).toBe(true);
  });
});

describe('the two modes allow the same destinations', () => {
  // Crossed rather than listed: the scheme-bearing values are exactly what the
  // single scheme-less allowlist this table used to carry could not see.
  const allowlists = [
    'api.myapp.com',
    'https://api.myapp.com',
    'http://api.myapp.com',
    'api.myapp.com/v1',
    'myapp.com',
  ];

  const urls = [
    `${PAGE_ORIGIN}/api/users`,
    'https://api.myapp.com/users',
    'http://api.myapp.com/users',
    'https://other.api.myapp.com/users',
    'https://api.myapp.com:8080/x',
    'https://api.myapp.com.evil.test/x',
    'https://third-party.example/api.myapp.com',
    'https://third-party.example/?to=https://api.myapp.com',
    'https://analytics.google.com/collect',
  ];

  const cases = allowlists.flatMap((allowed) =>
    urls.map((url) => [allowed, url] as const),
  );

  it.each(cases)('agrees on propagateTo %s for %s', (allowed, url) => {
    const lean = isPropagationAllowed(url, PAGE_ORIGIN, [allowed]);
    // OpenTelemetry short-circuits same-origin before it consults the patterns,
    // so full mode's answer is that OR the pattern.
    const sameOrigin = new URL(url, PAGE_ORIGIN).origin === PAGE_ORIGIN;
    const full = sameOrigin || propagationUrlPattern(allowed).test(url);

    expect(full).toBe(lean);
  });
});
