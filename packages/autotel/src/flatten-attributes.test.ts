import { describe, expect, it } from 'vitest';
import { toAttributeValue, flattenToAttributes } from './flatten-attributes';

describe('toAttributeValue', () => {
  it('returns primitives as-is', () => {
    expect(toAttributeValue('hello')).toBe('hello');
    expect(toAttributeValue(42)).toBe(42);
    expect(toAttributeValue(true)).toBe(true);
  });

  it('returns homogeneous arrays as-is', () => {
    expect(toAttributeValue(['a', 'b'])).toEqual(['a', 'b']);
    expect(toAttributeValue([1, 2])).toEqual([1, 2]);
    expect(toAttributeValue([true, false])).toEqual([true, false]);
  });

  it('serialises mixed arrays to JSON', () => {
    expect(toAttributeValue([1, 'a'])).toBe('[1,"a"]');
  });

  it('converts Date to ISO string', () => {
    const d = new Date('2025-01-01T00:00:00Z');
    expect(toAttributeValue(d)).toBe('2025-01-01T00:00:00.000Z');
  });

  it('converts Error to its message', () => {
    expect(toAttributeValue(new Error('boom'))).toBe('boom');
  });

  it('returns a Set as the array it carries', () => {
    expect(toAttributeValue(new Set(['a', 'b']))).toEqual(['a', 'b']);
    expect(toAttributeValue(new Set([1, 2]))).toEqual([1, 2]);
  });

  it('returns undefined for plain objects', () => {
    expect(toAttributeValue({ a: 1 })).toBeUndefined();
  });
});

describe('flattenToAttributes', () => {
  it('flattens nested objects with dot-notation keys', () => {
    expect(
      flattenToAttributes({ user: { id: 'u1', plan: 'pro' }, count: 3 }),
    ).toEqual({
      'user.id': 'u1',
      'user.plan': 'pro',
      count: 3,
    });
  });

  it('uses prefix when provided', () => {
    expect(flattenToAttributes({ key: 'val' }, 'error.details')).toEqual({
      'error.details.key': 'val',
    });
  });

  it('skips null and undefined values', () => {
    expect(
      flattenToAttributes({ a: 1, b: null, c: undefined, d: 'ok' }),
    ).toEqual({ a: 1, d: 'ok' });
  });

  it('handles circular references without stack overflow', () => {
    const obj: Record<string, unknown> = { name: 'root' };
    obj.self = obj;

    const result = flattenToAttributes(obj);
    expect(result).toEqual({
      name: 'root',
      'self.name': 'root',
      'self.self': '<circular-reference>',
    });
  });

  it('flattens a Map like a nested object', () => {
    const result = flattenToAttributes({
      seats: new Map([
        ['1a', 'taken'],
        ['1b', 'free'],
      ]),
    });
    expect(result).toEqual({ 'seats.1a': 'taken', 'seats.1b': 'free' });
  });

  it('flattens a Map with non-string keys', () => {
    const result = flattenToAttributes({ byId: new Map([[7, 'seven']]) });
    expect(result).toEqual({ 'byId.7': 'seven' });
  });

  it('handles a self-referential Map like a self-referential object', () => {
    const map = new Map<string, unknown>([['name', 'root']]);
    map.set('self', map);

    const obj: Record<string, unknown> = { name: 'root' };
    obj.self = obj;

    expect(flattenToAttributes({ nested: map })).toEqual({
      'nested.name': 'root',
      'nested.self': '<circular-reference>',
    });
    expect(flattenToAttributes({ nested: obj })).toEqual({
      'nested.name': 'root',
      'nested.self': '<circular-reference>',
    });
  });

  it('serialises non-plain objects to JSON', () => {
    const result = flattenToAttributes({
      date: new Date('2025-01-01T00:00:00Z'),
    });
    expect(result).toEqual({ date: '2025-01-01T00:00:00.000Z' });
  });
});

// Conversion runs on whatever the application hands an attribute setter, so it
// has to be total: anything it cannot represent becomes a marker, and nothing
// throws back into the caller's code path.
describe('values that cannot be converted', () => {
  it('marks an invalid date rather than throwing', () => {
    expect(toAttributeValue(new Date('nonsense'))).toBe('<invalid-date>');
    expect(flattenToAttributes({ at: new Date('nonsense') })).toEqual({
      at: '<invalid-date>',
    });
  });

  it('marks a non-finite number rather than encoding one', () => {
    expect(toAttributeValue(Number.NaN)).toBe('<invalid-number>');
    expect(toAttributeValue(Number.POSITIVE_INFINITY)).toBe('<invalid-number>');
    expect(toAttributeValue(0)).toBe(0);
    expect(toAttributeValue(-1.5)).toBe(-1.5);
  });

  it('still records a valid date as ISO 8601', () => {
    const at = new Date('2026-09-10T08:00:00.000Z');
    expect(toAttributeValue(at)).toBe('2026-09-10T08:00:00.000Z');
  });

  it('survives a getter that throws', () => {
    const value = {
      ok: 1,
      get boom(): string {
        throw new Error('getter exploded');
      },
    };

    expect(flattenToAttributes({ value })).toEqual({
      'value.ok': 1,
      'value.boom': '<serialization-failed>',
    });
  });

  it('survives a toString that throws inside a Map key', () => {
    const key = {
      toString() {
        throw new Error('key exploded');
      },
    };

    expect(() =>
      flattenToAttributes({ meta: new Map([[key, 'v']]) }),
    ).not.toThrow();
  });

  it('survives an object whose own enumeration throws', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('enumeration exploded');
        },
      },
    );

    expect(flattenToAttributes({ hostile })).toEqual({
      hostile: '<serialization-failed>',
    });
  });
});
