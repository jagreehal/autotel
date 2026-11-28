import { expect, it } from 'vitest';
import { escapeControlDeep } from './values';

it('preserves a literal __proto__ telemetry attribute while escaping its value', () => {
  const attributes = Object.fromEntries([['__proto__', 'client\u001B[31m']]);
  const escaped = escapeControlDeep(attributes);
  expect(Object.hasOwn(escaped, '__proto__')).toBe(true);
  expect(escaped['__proto__']).toBe(String.raw`client\u001b[31m`);
});

it('preserves distinct attribute keys when one contains a control and another its literal escape', () => {
  const attributes = { 'header\nname': 'first', 'header\\nname': 'second' };
  const escaped = escapeControlDeep(attributes);
  expect(Object.keys(escaped)).toHaveLength(2);
  expect(Object.values(escaped)).toEqual(
    expect.arrayContaining(['first', 'second']),
  );
});
