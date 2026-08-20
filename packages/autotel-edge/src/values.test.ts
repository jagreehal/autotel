import { describe, it, expect } from 'vitest';
import { toAttributeValue } from './values';

describe('toAttributeValue', () => {
  it('passes scalars through', () => {
    expect(toAttributeValue('a')).toBe('a');
    expect(toAttributeValue(42)).toBe(42);
    expect(toAttributeValue(0)).toBe(0);
    expect(toAttributeValue(false)).toBe(false);
  });

  it('drops what cannot be an attribute', () => {
    expect(toAttributeValue(undefined)).toBeUndefined();
    expect(toAttributeValue(null)).toBeUndefined();
  });

  // OTLP has no encoding for these, and JSON.stringify renders both as the
  // string "null" - which would claim the attribute holds null.
  it('drops non-finite numbers rather than reporting them as "null"', () => {
    expect(toAttributeValue(Number.NaN)).toBeUndefined();
    expect(toAttributeValue(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(toAttributeValue(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });

  it('keeps homogeneous scalar arrays', () => {
    expect(toAttributeValue(['a', 'b'])).toEqual(['a', 'b']);
    expect(toAttributeValue([1, 2])).toEqual([1, 2]);
    expect(toAttributeValue([true, false])).toEqual([true, false]);
  });

  it('does not send an array of numbers OTLP cannot encode', () => {
    expect(toAttributeValue([1, Number.NaN])).toBe('[1,null]');
  });

  it('stringifies anything else', () => {
    expect(toAttributeValue({ a: 1 })).toBe('{"a":1}');
    expect(toAttributeValue([1, 'a'])).toBe('[1,"a"]');
  });
});
