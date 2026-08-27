/**
 * Recursive-descent parser for the telemetry query language.
 *
 * Grammar, loosest binding first:
 *
 *   query      := or?
 *   or         := and (OR and)*
 *   and        := condition ((AND)? condition)*     -- juxtaposition means AND
 *   condition  := "(" or ")" | comparison | freeText
 *   comparison := field operator value
 *   value      := string | number | boolean | null | array
 *   array      := "[" (value ("," value)*)? "]"
 *
 * Juxtaposition binding as AND is deliberate: `service = api duration > 100` is
 * what people type, and rejecting it to demand the keyword buys nothing.
 *
 * Errors are collected with source ranges rather than thrown on the first
 * problem, so a half-typed query can still be linted in the editor.
 */

import {
  OPERATORS,
  SIGIL_ALIASES,
  type Operator,
  type ParseResult,
  type QueryError,
  type QueryNode,
  type QueryValue,
  type Range,
} from './ast';
import { tokenize, type Token } from './tokenize';

const BOOLEAN_KEYWORDS = new Set(['and', 'or']);
const NULL_LITERALS = new Set(['null', 'nil']);

/** Keyword operators, lower-cased, mapped to their canonical spelling. */
const KEYWORD_OPERATORS = new Map<string, Operator>([
  ['contains', 'CONTAINS'],
  ['regexp', 'REGEXP'],
  ['in', 'IN'],
]);

export function parse(input: string): ParseResult {
  const tokens = tokenize(input);
  const errors: QueryError[] = [];

  /** Range used when a problem is found past the last token. */
  const endRange = (): Range => ({
    from: tokens.length ? tokens[tokens.length - 1].to : 0,
    to: input.length,
  });

  let pos = 0;
  const peek = (offset = 0): Token | undefined => tokens[pos + offset];
  const next = (): Token | undefined => tokens[pos++];
  const fail = (message: string, range: Range) =>
    errors.push({ message, range });

  /** Lower-cased text of a `word` token, or undefined for any other token. */
  const wordAt = (offset = 0): string | undefined => {
    const token = peek(offset);
    return token?.type === 'word' ? token.value.toLowerCase() : undefined;
  };

  const isBooleanKeyword = (offset = 0) => {
    const word = wordAt(offset);
    return word !== undefined && BOOLEAN_KEYWORDS.has(word);
  };

  function span(from: Range, to: Range): Range {
    return { from: from.from, to: to.to };
  }

  function parseValue(): QueryValue | undefined {
    const token = next();
    if (!token) {
      fail('Expected a value', endRange());
      return undefined;
    }

    if (token.type === 'string') {
      if (!token.terminated) {
        fail('Unterminated quoted string', { from: token.from, to: token.to });
      }
      // Quoted values stay strings even when they look like numbers: quoting is
      // how you say "this is text".
      return { type: 'string', value: token.value };
    }

    if (token.type === 'lbracket') {
      const values: QueryValue[] = [];
      if (peek()?.type === 'rbracket') {
        next();
        return { type: 'array', values };
      }
      for (;;) {
        const element = parseValue();
        if (!element) return { type: 'array', values };
        values.push(element);

        const separator = peek();
        if (separator?.type === 'comma') {
          next();
          continue;
        }
        if (separator?.type === 'rbracket') {
          next();
          return { type: 'array', values };
        }
        fail('Expected "," or "]" in array', separator ?? endRange());
        return { type: 'array', values };
      }
    }

    if (token.type === 'word') {
      const lower = token.value.toLowerCase();
      if (NULL_LITERALS.has(lower)) return { type: 'null' };
      if (lower === 'true') return { type: 'boolean', value: true };
      if (lower === 'false') return { type: 'boolean', value: false };
      // `Number('')` is 0 and `Number('  ')` is 0, but a word token is never
      // empty or blank, so a finite result here is a genuine numeric literal.
      const numeric = Number(token.value);
      if (Number.isFinite(numeric)) return { type: 'number', value: numeric };
      return { type: 'string', value: token.value };
    }

    fail(`Expected a value, found "${token.value}"`, token);
    return undefined;
  }

  /**
   * Read an operator at the cursor, or undefined if there isn't one.
   *
   * Handles all three spellings: a sigil (`>=`), a keyword (`CONTAINS`), and a
   * two-word negation (`NOT IN`).
   */
  function parseOperator(): Operator | undefined {
    const token = peek();
    if (!token) return undefined;

    if (token.type === 'sigil') {
      next();
      return SIGIL_ALIASES[token.value] ?? (token.value as Operator);
    }

    if (token.type !== 'word') return undefined;
    const lower = token.value.toLowerCase();

    if (lower === 'not') {
      const following = wordAt(1);
      const base = following ? KEYWORD_OPERATORS.get(following) : undefined;
      if (base) {
        next();
        next();
        return `NOT ${base}` as Operator;
      }
      return undefined;
    }

    const keyword = KEYWORD_OPERATORS.get(lower);
    if (keyword) {
      next();
      return keyword;
    }
    return undefined;
  }

  function parseCondition(): QueryNode | undefined {
    const token = peek();
    if (!token) {
      fail('Expected a condition', endRange());
      return undefined;
    }

    if (token.type === 'lparen') {
      next();
      const inner = parseOr();
      const closing = peek();
      if (closing?.type === 'rparen') {
        next();
      } else {
        fail('Unclosed parenthesis — expected ")"', closing ?? endRange());
      }
      return inner;
    }

    // A field name followed by an operator is a comparison; anything else that
    // starts with a word or string is free text.
    if (token.type === 'word' || token.type === 'string') {
      const savedPos = pos;
      next();
      const op = parseOperator();

      // A quoted field name is legal, and necessary: OTel attribute keys are
      // arbitrary strings, so `"my attr" = 5` and `"a.b c" > 1` have to work.
      // Quoting is the only way to name a key containing spaces, brackets or an
      // operator sigil.
      if (op) {
        const value = parseValue();
        if (!value) return undefined;
        const previous = tokens[pos - 1];
        return {
          type: 'comparison',
          field: token.value,
          op,
          value,
          range: span(token, previous ?? token),
        };
      }

      pos = savedPos;
      next();
      if (token.type === 'string' && !token.terminated) {
        fail('Unterminated quoted string', { from: token.from, to: token.to });
      }
      return {
        type: 'freeText',
        text: token.value,
        range: { from: token.from, to: token.to },
      };
    }

    fail(`Unexpected "${token.value}"`, token);
    next();
    return undefined;
  }

  /** True when the cursor sits on something that could begin a condition. */
  function atConditionStart(): boolean {
    const token = peek();
    if (!token) return false;
    if (token.type === 'rparen' || token.type === 'rbracket') return false;
    if (token.type === 'comma') return false;
    return !isBooleanKeyword();
  }

  function parseAnd(): QueryNode | undefined {
    let left = parseCondition();
    if (!left) return undefined;

    for (;;) {
      if (wordAt() === 'and') {
        next();
        const right = parseCondition();
        if (!right) return left;
        left = { type: 'and', left, right, range: nodeSpan(left, right) };
        continue;
      }
      // Juxtaposition: two conditions with no keyword between them.
      if (atConditionStart()) {
        const right = parseCondition();
        if (!right) return left;
        left = { type: 'and', left, right, range: nodeSpan(left, right) };
        continue;
      }
      return left;
    }
  }

  function parseOr(): QueryNode | undefined {
    let left = parseAnd();
    if (!left) return undefined;

    while (wordAt() === 'or') {
      next();
      const right = parseAnd();
      if (!right) return left;
      left = { type: 'or', left, right, range: nodeSpan(left, right) };
    }
    return left;
  }

  if (tokens.length === 0) return { ok: true, node: { type: 'all' } };

  const node = parseOr();

  // Anything left over is a structural error — most often a stray ")".
  const leftover = peek();
  if (leftover) fail(`Unexpected "${leftover.value}"`, leftover);

  if (errors.length > 0 || !node) {
    return {
      ok: false,
      errors:
        errors.length > 0
          ? errors
          : [{ message: 'Invalid query', range: endRange() }],
    };
  }
  return { ok: true, node };
}

/** Source range covering two nodes, tolerating the range-less `all` node. */
function nodeSpan(left: QueryNode, right: QueryNode): Range {
  const from = 'range' in left ? left.range.from : 0;
  const to = 'range' in right ? right.range.to : from;
  return { from, to };
}

/** Re-exported so callers need only one import to work with operators. */
export { OPERATORS };
