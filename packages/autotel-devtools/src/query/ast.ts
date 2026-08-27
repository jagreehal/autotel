/**
 * AST and vocabulary for the telemetry query language.
 *
 * Shared by everything that touches a query: the parser produces these nodes,
 * the SQL compiler consumes them, and the editor reads the same operator table
 * to offer completions. One definition, so a new operator cannot be added to
 * the language without the compiler and the editor both seeing it.
 */

/** Half-open source range `[from, to)`, used for editor squiggles. */
export interface Range {
  from: number;
  to: number;
}

/**
 * Every operator the language accepts.
 *
 * Sigils and keywords are two spellings of one set — `=~` and `REGEXP` produce
 * the same node — so downstream code branches on one canonical value.
 */
export const OPERATORS = {
  '=': { label: 'equals', kind: 'comparison' },
  '!=': { label: 'does not equal', kind: 'comparison' },
  '>': { label: 'greater than', kind: 'ordered' },
  '<': { label: 'less than', kind: 'ordered' },
  '>=': { label: 'greater than or equal', kind: 'ordered' },
  '<=': { label: 'less than or equal', kind: 'ordered' },
  '^': { label: 'starts with', kind: 'text' },
  $: { label: 'ends with', kind: 'text' },
  CONTAINS: { label: 'contains', kind: 'text' },
  'NOT CONTAINS': { label: 'does not contain', kind: 'text' },
  REGEXP: { label: 'matches regex', kind: 'text' },
  'NOT REGEXP': { label: 'does not match regex', kind: 'text' },
  IN: { label: 'is one of', kind: 'set' },
  'NOT IN': { label: 'is not one of', kind: 'set' },
} as const;

export type Operator = keyof typeof OPERATORS;

/** Sigil spellings that map onto a keyword operator. */
export const SIGIL_ALIASES: Readonly<Record<string, Operator>> = {
  '=~': 'REGEXP',
  '!~': 'NOT REGEXP',
};

export type QueryValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'array'; values: QueryValue[] };

export type QueryNode =
  /** Empty query: matches everything. Distinct from an error. */
  | { type: 'all' }
  | { type: 'and'; left: QueryNode; right: QueryNode; range: Range }
  | { type: 'or'; left: QueryNode; right: QueryNode; range: Range }
  | {
      type: 'comparison';
      field: string;
      op: Operator;
      value: QueryValue;
      range: Range;
    }
  /** A bare word or phrase, matched across a signal's default text fields. */
  | { type: 'freeText'; text: string; range: Range };

export interface QueryError {
  message: string;
  range: Range;
}

export type ParseResult =
  { ok: true; node: QueryNode } | { ok: false; errors: QueryError[] };
