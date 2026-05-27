import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  setBaggage,
  clearBaggage,
  getBaggageEntries,
  getBaggageHeader,
  hasBaggage,
  serializeBaggage,
  validateBaggageEntry,
  isBaggageDestinationAllowed,
  resetBaggageForTesting,
  MAX_BAGGAGE_BYTES,
} from './baggage';

describe('baggage module', () => {
  beforeEach(() => {
    resetBaggageForTesting();
  });

  describe('validateBaggageEntry', () => {
    it('accepts a valid dotted key and string value', () => {
      expect(validateBaggageEntry('tenant.id', 'acme')).toBeNull();
    });

    it('rejects empty or non-string keys', () => {
      expect(validateBaggageEntry('', 'x')).toMatch(/non-empty string/);
      expect(validateBaggageEntry(123 as unknown, 'x')).toMatch(/non-empty string/);
    });

    it('rejects keys with characters outside the W3C token set', () => {
      expect(validateBaggageEntry('tenant id', 'x')).toMatch(/not allowed/);
      expect(validateBaggageEntry('tenant=id', 'x')).toMatch(/not allowed/);
      expect(validateBaggageEntry('tenant,id', 'x')).toMatch(/not allowed/);
    });

    it('rejects non-string values', () => {
      expect(validateBaggageEntry('tenant.id', 42 as unknown)).toMatch(/must be a string/);
      expect(validateBaggageEntry('tenant.id', null as unknown)).toMatch(/must be a string/);
    });
  });

  describe('setBaggage / clearBaggage / getBaggageEntries', () => {
    it('merges entries additively', () => {
      setBaggage({ 'tenant.id': 'acme' });
      setBaggage({ 'user.id': 'u1' });
      expect(getBaggageEntries()).toEqual({ 'tenant.id': 'acme', 'user.id': 'u1' });
    });

    it('overwrites an existing key', () => {
      setBaggage({ 'tenant.id': 'acme' });
      setBaggage({ 'tenant.id': 'globex' });
      expect(getBaggageEntries()).toEqual({ 'tenant.id': 'globex' });
    });

    it('drops invalid entries but keeps valid ones', () => {
      setBaggage({ 'tenant.id': 'acme', 'bad key': 'x', other: 5 as unknown as string });
      expect(getBaggageEntries()).toEqual({ 'tenant.id': 'acme' });
    });

    it('clears a single key or everything', () => {
      setBaggage({ 'tenant.id': 'acme', 'user.id': 'u1' });
      clearBaggage('tenant.id');
      expect(getBaggageEntries()).toEqual({ 'user.id': 'u1' });
      clearBaggage();
      expect(getBaggageEntries()).toEqual({});
      expect(hasBaggage()).toBe(false);
    });

    it('warns on invalid entries only in debug mode', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setBaggage({ 'bad key': 'x' }, false);
      expect(warn).not.toHaveBeenCalled();
      setBaggage({ 'bad key': 'x' }, true);
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    });

    it('never throws on a non-object argument', () => {
      expect(() => setBaggage(undefined as unknown as Record<string, string>)).not.toThrow();
      expect(getBaggageEntries()).toEqual({});
    });
  });

  describe('serializeBaggage', () => {
    it('returns undefined when empty', () => {
      expect(serializeBaggage(new Map())).toBeUndefined();
      expect(serializeBaggage({})).toBeUndefined();
    });

    it('serializes to W3C baggage format preserving order', () => {
      const header = serializeBaggage({ 'tenant.id': 'acme', 'user.id': 'u1' });
      expect(header).toBe('tenant.id=acme,user.id=u1');
    });

    it('percent-encodes values', () => {
      const header = serializeBaggage({ 'tenant.id': 'acme corp,inc' });
      expect(header).toBe('tenant.id=acme%20corp%2Cinc');
    });

    it('drops trailing entries that would exceed the byte budget', () => {
      const big = 'v'.repeat(MAX_BAGGAGE_BYTES);
      const header = serializeBaggage({ a: 'small', b: big });
      // 'a=small' fits; 'b=<huge>' does not, so it is dropped.
      expect(header).toBe('a=small');
    });
  });

  describe('getBaggageHeader', () => {
    it('reflects current module state', () => {
      expect(getBaggageHeader()).toBeUndefined();
      setBaggage({ 'tenant.id': 'acme' });
      expect(getBaggageHeader()).toBe('tenant.id=acme');
    });
  });

  describe('isBaggageDestinationAllowed (fail-closed)', () => {
    const origin = 'https://app.example.com';

    it('allows same-origin absolute URLs', () => {
      expect(isBaggageDestinationAllowed('https://app.example.com/api', origin)).toBe(true);
    });

    it('allows relative URLs (resolve to same origin)', () => {
      expect(isBaggageDestinationAllowed('/api/users', origin)).toBe(true);
    });

    it('blocks cross-origin by default', () => {
      expect(isBaggageDestinationAllowed('https://analytics.google.com/c', origin)).toBe(false);
      expect(isBaggageDestinationAllowed('https://api.example.com/x', origin)).toBe(false);
    });

    it('allows cross-origin only when explicitly allowlisted', () => {
      expect(
        isBaggageDestinationAllowed('https://api.example.com/x', origin, ['api.example.com']),
      ).toBe(true);
      expect(
        isBaggageDestinationAllowed('https://analytics.google.com/c', origin, ['api.example.com']),
      ).toBe(false);
    });

    it('fails closed on an unparseable URL', () => {
      expect(isBaggageDestinationAllowed('http://[bad', origin, ['anything'])).toBe(false);
    });
  });
});

afterEach(() => {
  resetBaggageForTesting();
});
