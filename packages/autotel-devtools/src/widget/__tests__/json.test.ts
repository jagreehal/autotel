import { describe, it, expect } from 'vitest';
import { tryParseJsonContainer } from '../utils/json';

describe('tryParseJsonContainer', () => {
  it('parses a JSON object string', () => {
    expect(tryParseJsonContainer('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a JSON array string (e.g. gen_ai messages)', () => {
    const msg = '[{"role":"user","parts":[{"type":"text","content":"hi"}]}]';
    expect(tryParseJsonContainer(msg)).toEqual([
      { role: 'user', parts: [{ type: 'text', content: 'hi' }] },
    ]);
  });

  it('passes through already-structured objects/arrays', () => {
    const obj = { a: 1 };
    expect(tryParseJsonContainer(obj)).toBe(obj);
    const arr = [1, 2];
    expect(tryParseJsonContainer(arr)).toBe(arr);
  });

  it('returns null for scalar strings that happen to be valid JSON', () => {
    expect(tryParseJsonContainer('42')).toBeNull();
    expect(tryParseJsonContainer('true')).toBeNull();
    expect(tryParseJsonContainer('null')).toBeNull();
    expect(tryParseJsonContainer('"stop"')).toBeNull();
  });

  it('returns null for plain text', () => {
    expect(tryParseJsonContainer('chat')).toBeNull();
    expect(tryParseJsonContainer('ollama')).toBeNull();
  });

  it('returns null for truncated / invalid JSON', () => {
    expect(tryParseJsonContainer('[{"role":"user"')).toBeNull();
    expect(tryParseJsonContainer('{not json}')).toBeNull();
  });

  it('returns null for non-string primitives', () => {
    expect(tryParseJsonContainer(42)).toBeNull();
    expect(tryParseJsonContainer(null)).toBeNull();
    expect(tryParseJsonContainer(undefined)).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(tryParseJsonContainer('  { "a": 1 }  ')).toEqual({ a: 1 });
  });
});
