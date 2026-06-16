import { describe, expect, it } from 'vitest';

import { jsonSerializer } from './serializer.js';

describe('jsonSerializer', () => {
  it('sorts object keys deterministically by default', () => {
    const s = jsonSerializer({ indent: 0 });
    expect(s.serialize({ b: 1, a: 2 })).toBe(s.serialize({ a: 2, b: 1 }));
    expect(s.serialize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys recursively', () => {
    const s = jsonSerializer({ indent: 0 });
    expect(s.serialize({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it('preserves array order', () => {
    const s = jsonSerializer({ indent: 0 });
    expect(s.serialize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('can preserve key order when asked', () => {
    const s = jsonSerializer({ indent: 0, sortKeys: false });
    expect(s.serialize({ b: 1, a: 2 })).toBe('{"b":1,"a":2}');
  });

  it('round-trips through deserialize', () => {
    const s = jsonSerializer();
    const value = { orderId: 'ord-1', items: [{ sku: 'x', qty: 2 }] };
    expect(s.deserialize(s.serialize(value))).toEqual(value);
  });
});
