import { describe, it, expect } from 'vitest';
import { matchesNeedle } from './textMatch';

describe('matchesNeedle', () => {
  it('matches everything when the needle is empty', () => {
    expect(matchesNeedle('', ['anything'])).toBe(true);
    expect(matchesNeedle('', [null, undefined])).toBe(true);
  });

  it('matches when any field contains the needle (case-insensitive)', () => {
    // The caller lower-cases the needle; fields may be any case.
    expect(matchesNeedle('checkout', ['CheckoutService'])).toBe(true);
    expect(matchesNeedle('pay', ['orders', 'payments-api'])).toBe(true);
  });

  it('returns false when no field contains the needle', () => {
    expect(matchesNeedle('xyz', ['orders', 'payments'])).toBe(false);
  });

  it('skips nullish fields without throwing', () => {
    expect(matchesNeedle('foo', [null, undefined, 'foobar'])).toBe(true);
    expect(matchesNeedle('foo', [null, undefined])).toBe(false);
  });

  it('stringifies number fields', () => {
    expect(matchesNeedle('42', [42, 'svc'])).toBe(true);
  });
});
