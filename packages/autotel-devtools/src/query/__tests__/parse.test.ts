/**
 * Parser contract for the telemetry query language.
 *
 * The seam is `parse(text)` — text in, AST or positioned errors out. Nothing
 * here reaches into the tokenizer or the parser's internals: the tokenizer is
 * free to change shape as long as these behaviours hold.
 *
 * Positions matter as much as the tree: the editor draws squiggles from them,
 * so an error without an accurate range is a bug even when the message is right.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parse';
import type { QueryNode } from '../ast';

/** Assert a successful parse and hand back the tree. */
function tree(text: string): QueryNode {
  const result = parse(text);
  if (!result.ok) {
    throw new Error(
      `expected "${text}" to parse, got: ${result.errors.map((e) => e.message).join('; ')}`,
    );
  }
  return result.node;
}

/** Assert a failed parse and hand back the errors. */
function errors(text: string) {
  const result = parse(text);
  if (result.ok) throw new Error(`expected "${text}" to fail, but it parsed`);
  return result.errors;
}

describe('parse — empty input', () => {
  it('treats empty and whitespace-only input as "match everything"', () => {
    for (const text of ['', '   ', '\t\n']) {
      const result = parse(text);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.node).toEqual({ type: 'all' });
    }
  });
});

describe('parse — comparisons', () => {
  it('parses a bare field/operator/value triple', () => {
    expect(tree('service = api')).toEqual({
      type: 'comparison',
      field: 'service',
      op: '=',
      value: { type: 'string', value: 'api' },
      range: { from: 0, to: 13 },
    });
  });

  it('does not require whitespace around the operator', () => {
    expect(tree('service=api')).toMatchObject({
      type: 'comparison',
      field: 'service',
      op: '=',
      value: { type: 'string', value: 'api' },
    });
  });

  it.each([
    ['=', '='],
    ['!=', '!='],
    ['>', '>'],
    ['<', '<'],
    ['>=', '>='],
    ['<=', '<='],
    // Sigil spellings canonicalise onto their keyword operator, so downstream
    // code branches on one value rather than two spellings of one meaning.
    ['=~', 'REGEXP'],
    ['!~', 'NOT REGEXP'],
    ['^', '^'],
    ['$', '$'],
  ])('parses the %s operator', (symbol, op) => {
    expect(tree(`duration ${symbol} 100`)).toMatchObject({
      type: 'comparison',
      op,
    });
  });

  it.each([
    ['CONTAINS', 'CONTAINS'],
    ['contains', 'CONTAINS'],
    ['REGEXP', 'REGEXP'],
    ['regexp', 'REGEXP'],
  ])('parses the keyword operator %s case-insensitively', (written, op) => {
    expect(tree(`name ${written} checkout`)).toMatchObject({
      type: 'comparison',
      op,
    });
  });

  it('parses the two-word negated keyword operators', () => {
    expect(tree('name NOT CONTAINS health')).toMatchObject({
      type: 'comparison',
      field: 'name',
      op: 'NOT CONTAINS',
      value: { type: 'string', value: 'health' },
    });
    expect(tree('service NOT IN [api, web]')).toMatchObject({
      type: 'comparison',
      op: 'NOT IN',
    });
  });

  it('accepts a quoted field name, for attribute keys a bare word cannot spell', () => {
    // OTel attribute keys are arbitrary strings; quoting is the only way to
    // name one containing spaces, brackets or an operator sigil.
    expect(tree('"my attr" = 5')).toMatchObject({
      type: 'comparison',
      field: 'my attr',
      op: '=',
      value: { type: 'number', value: 5 },
    });
    expect(tree('"weird=key" != 1')).toMatchObject({ field: 'weird=key' });
  });

  it('still reads a bare quoted phrase with no operator as free text', () => {
    expect(tree('"GET /users"')).toMatchObject({ type: 'freeText' });
  });

  it('reads a dotted attribute path as one field name', () => {
    expect(tree('http.status_code >= 500')).toMatchObject({
      type: 'comparison',
      field: 'http.status_code',
      op: '>=',
      value: { type: 'number', value: 500 },
    });
  });
});

describe('parse — values', () => {
  it('types a bare integer and float as numbers', () => {
    expect(tree('duration > 100')).toMatchObject({
      value: { type: 'number', value: 100 },
    });
    expect(tree('duration > 1.5')).toMatchObject({
      value: { type: 'number', value: 1.5 },
    });
  });

  it('types a negative number', () => {
    expect(tree('delta > -3')).toMatchObject({
      value: { type: 'number', value: -3 },
    });
  });

  it('types true/false as booleans, case-insensitively', () => {
    expect(tree('ok = true')).toMatchObject({
      value: { type: 'boolean', value: true },
    });
    expect(tree('ok = FALSE')).toMatchObject({
      value: { type: 'boolean', value: false },
    });
  });

  it('types NULL/nil as null, case-insensitively', () => {
    for (const written of ['NULL', 'null', 'NIL', 'nil']) {
      expect(tree(`parent ${'='} ${written}`)).toMatchObject({
        value: { type: 'null' },
      });
    }
  });

  it('keeps a quoted value as a string even when it looks like a number', () => {
    expect(tree('code = "500"')).toMatchObject({
      value: { type: 'string', value: '500' },
    });
    expect(tree("code = '500'")).toMatchObject({
      value: { type: 'string', value: '500' },
    });
  });

  it('unescapes backslash escapes inside a quoted value', () => {
    expect(tree('name = "say \\"hi\\""')).toMatchObject({
      value: { type: 'string', value: 'say "hi"' },
    });
  });

  it('preserves spaces inside a quoted value', () => {
    expect(tree('name = "GET /users"')).toMatchObject({
      value: { type: 'string', value: 'GET /users' },
    });
  });

  it('parses an array value with mixed element types', () => {
    expect(tree('service IN [api, "web app", 3]')).toMatchObject({
      op: 'IN',
      value: {
        type: 'array',
        values: [
          { type: 'string', value: 'api' },
          { type: 'string', value: 'web app' },
          { type: 'number', value: 3 },
        ],
      },
    });
  });

  it('parses an empty array', () => {
    expect(tree('service IN []')).toMatchObject({
      value: { type: 'array', values: [] },
    });
  });
});

describe('parse — boolean structure', () => {
  it('parses AND and OR case-insensitively', () => {
    expect(tree('a = 1 AND b = 2')).toMatchObject({ type: 'and' });
    expect(tree('a = 1 and b = 2')).toMatchObject({ type: 'and' });
    expect(tree('a = 1 OR b = 2')).toMatchObject({ type: 'or' });
    expect(tree('a = 1 or b = 2')).toMatchObject({ type: 'or' });
  });

  it('binds AND tighter than OR', () => {
    // a OR (b AND c) — not (a OR b) AND c
    expect(tree('a = 1 OR b = 2 AND c = 3')).toMatchObject({
      type: 'or',
      left: { type: 'comparison', field: 'a' },
      right: {
        type: 'and',
        left: { type: 'comparison', field: 'b' },
        right: { type: 'comparison', field: 'c' },
      },
    });
  });

  it('associates same-precedence operators to the left', () => {
    // (a AND b) AND c
    expect(tree('a = 1 AND b = 2 AND c = 3')).toMatchObject({
      type: 'and',
      left: { type: 'and' },
      right: { type: 'comparison', field: 'c' },
    });
  });

  it('lets parentheses override precedence', () => {
    expect(tree('(a = 1 OR b = 2) AND c = 3')).toMatchObject({
      type: 'and',
      left: { type: 'or' },
      right: { type: 'comparison', field: 'c' },
    });
  });

  it('treats adjacent conditions with no keyword as AND', () => {
    expect(tree('service = api duration > 100')).toMatchObject({
      type: 'and',
      left: { type: 'comparison', field: 'service' },
      right: { type: 'comparison', field: 'duration' },
    });
  });
});

describe('parse — free text', () => {
  it('parses a bare word as free text', () => {
    expect(tree('checkout')).toMatchObject({
      type: 'freeText',
      text: 'checkout',
    });
  });

  it('parses a bare quoted phrase as free text', () => {
    expect(tree('"GET /users"')).toMatchObject({
      type: 'freeText',
      text: 'GET /users',
    });
  });

  it('mixes free text with comparisons', () => {
    expect(tree('checkout AND service = api')).toMatchObject({
      type: 'and',
      left: { type: 'freeText', text: 'checkout' },
      right: { type: 'comparison', field: 'service' },
    });
  });
});

describe('parse — errors', () => {
  it('reports an operator with no right-hand value, with a range', () => {
    const [err] = errors('service =');
    expect(err.message).toMatch(/value/i);
    expect(err.range.from).toBeGreaterThanOrEqual(8);
    expect(err.range.to).toBeGreaterThanOrEqual(err.range.from);
  });

  it('reports an unclosed parenthesis', () => {
    const [err] = errors('(a = 1');
    expect(err.message).toMatch(/paren|\)/i);
  });

  it('reports an unclosed quote', () => {
    const [err] = errors('name = "unterminated');
    expect(err.message).toMatch(/quot|string/i);
  });

  it('reports an unclosed array bracket', () => {
    const [err] = errors('service IN [api');
    expect(err.message).toMatch(/bracket|\]/i);
  });

  it('reports a dangling boolean keyword', () => {
    const [err] = errors('service = api AND');
    expect(err.message).toMatch(/expect|incomplete|condition/i);
  });

  it('points the error range at the offending text, not the whole query', () => {
    const [err] = errors('service = api AND');
    expect(err.range.from).toBeGreaterThan(0);
  });
});
