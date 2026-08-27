/**
 * Tokenizer for the query language.
 *
 * Every token carries its source range, because the editor highlights and lints
 * from this same stream — the parser is not the only consumer. An unterminated
 * string is emitted as a token with `terminated: false` rather than thrown, so
 * the editor can still colour a half-typed query while the parser reports the
 * error.
 */

import type { Range } from './ast';

export type TokenType =
  | 'word'
  | 'string'
  | 'sigil'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'comma';

export interface Token extends Range {
  type: TokenType;
  /** Decoded text: escapes resolved and quotes stripped for `string`. */
  value: string;
  /** Only meaningful for `string` — false when the closing quote is missing. */
  terminated: boolean;
}

/**
 * Characters a bare word may contain.
 *
 * Deliberately wide: attribute keys in the wild carry dots, slashes, colons and
 * dashes (`http.status_code`, `GET /users`, `db.system`), and requiring quotes
 * around every one of them would make the common query the awkward one. The
 * exclusions are the characters the grammar itself needs.
 */
const WORD_RE = /[^\s()[\],=!<>^$"']/;

/** Multi-character sigils are tested before single-character ones. */
const SIGILS = ['>=', '<=', '!=', '=~', '!~', '=', '>', '<', '^', '$'];

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const push = (
    type: TokenType,
    value: string,
    from: number,
    to: number,
    terminated = true,
  ) => tokens.push({ type, value, from, to, terminated });

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const punctuation: Record<string, TokenType> = {
      '(': 'lparen',
      ')': 'rparen',
      '[': 'lbracket',
      ']': 'rbracket',
      ',': 'comma',
    };
    if (punctuation[ch]) {
      push(punctuation[ch], ch, i, i + 1);
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      i++;
      let value = '';
      let terminated = false;
      while (i < input.length) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
          continue;
        }
        if (input[i] === quote) {
          i++;
          terminated = true;
          break;
        }
        value += input[i];
        i++;
      }
      push('string', value, start, i, terminated);
      continue;
    }

    const sigil = SIGILS.find((s) => input.startsWith(s, i));
    if (sigil) {
      push('sigil', sigil, i, i + sigil.length);
      i += sigil.length;
      continue;
    }

    const start = i;
    while (i < input.length && WORD_RE.test(input[i])) i++;
    // A character that is neither whitespace, punctuation, a quote nor a sigil
    // start cannot occur — WORD_RE excludes exactly those — but guard anyway so
    // a future grammar change can never spin here.
    if (i === start) i++;
    push('word', input.slice(start, i), start, i);
  }

  return tokens;
}
