/**
 * The telemetry query language, as a public surface.
 *
 * Exported so anything that *generates* a query — the MCP `devtools` backend
 * compiling a structured search, a CLI flag, a saved view — can check that what
 * it emits actually parses, against the same grammar the server compiles with.
 * Without a shared export, a generator and the parser drift silently and the
 * first sign is a 400 for a query the user never typed.
 */

export { parse } from './parse';
export { tokenize } from './tokenize';
export type { Token, TokenType } from './tokenize';
export { compileWhere } from './compile';
export type { ColumnSchema, CompiledQuery, SignalSchema } from './compile';
export { OPERATORS, SIGIL_ALIASES } from './ast';
export type {
  Operator,
  ParseResult,
  QueryError,
  QueryNode,
  QueryValue,
  Range,
} from './ast';
