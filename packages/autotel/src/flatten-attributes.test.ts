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

  it('serialises non-plain objects to JSON', () => {
    const result = flattenToAttributes({
      date: new Date('2025-01-01T00:00:00Z'),
    });
    expect(result).toEqual({ date: '2025-01-01T00:00:00.000Z' });
  });
});
