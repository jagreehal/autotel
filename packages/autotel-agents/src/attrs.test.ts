import { describe, expect, it } from 'vitest';

import { bool, num, str } from './attrs';

describe('attribute coercion', () => {
  it('reads the first key that carries a scalar', () => {
    expect(str({ b: 'second' }, 'a', 'b')).toBe('second');
    expect(str({ a: '', b: 'second' }, 'a', 'b')).toBe('second');
    expect(str({ a: 42 }, 'a')).toBe('42');
    expect(str({ a: false }, 'a')).toBe('false');
  });

  it('reads numbers whether they arrive as numbers or as strings', () => {
    expect(num({ a: 3 }, 'a')).toBe(3);
    expect(num({ a: '3.5' }, 'a')).toBe(3.5);
    expect(num({ a: '  ' }, 'a')).toBeUndefined();
    expect(num({ a: 'nope' }, 'a')).toBeUndefined();
    expect(num({ a: Number.POSITIVE_INFINITY }, 'a')).toBeUndefined();
  });

  it('reads booleans whether they arrive as booleans or as strings', () => {
    expect(bool({ a: true }, 'a')).toBe(true);
    expect(bool({ a: 'false' }, 'a')).toBe(false);
    expect(bool({ a: 'yes' }, 'a')).toBeUndefined();
  });

  it('ignores nested values, which have no scalar reading', () => {
    expect(str({ a: { nested: 'x' } }, 'a')).toBeUndefined();
    expect(str({ a: ['x'] }, 'a')).toBeUndefined();
    expect(num({ a: [1] }, 'a')).toBeUndefined();
    expect(num({ a: { b: 1 } }, 'a')).toBeUndefined();
  });

  it('does not read a boolean as a number', () => {
    expect(num({ ok: true }, 'ok')).toBeUndefined();
  });
});
