/**
 * Compiles a query AST to a SQL WHERE-clause fragment plus bound parameters.
 *
 * **Injection boundary.** Two rules hold everywhere in this file, and the tests
 * in `__tests__/compile.test.ts` exist to keep them holding:
 *
 *  1. Every value from the query text becomes a `?` parameter. No exceptions,
 *     including numbers — a number that reached the SQL string by concatenation
 *     would be one refactor away from a string doing the same.
 *  2. Every identifier comes from the caller's `SignalSchema`, never from the
 *     query text. An unknown field is not interpolated as a column name; it
 *     becomes a *parameter* to `json_extract`, so an attribute key is data too.
 *
 * That leaves nothing in the emitted SQL that the user authored.
 */

import type { Operator, QueryNode, QueryValue } from './ast';

export interface ColumnSchema {
  /** Physical column name. May differ from the name used in queries. */
  column: string;
  type: 'string' | 'number' | 'boolean';
}

export interface SignalSchema {
  /** Query field name → physical column. Anything absent is an attribute. */
  columns: Record<string, ColumnSchema>;
  /** Column holding the JSON attribute bag. */
  attributesColumn: string;
  /** Query fields a bare word is matched against. Must be keys of `columns`. */
  freeTextColumns: string[];
  /** Optional normalized attribute index used for exact equality probes. */
  attributeIndex?: {
    table: string;
    signal: string;
    /** Trusted SQL expression identifying the current row. */
    entitySql: string;
  };
  /**
   * Query fields that live in a child table rather than on the row itself, so
   * `event.name = timeout` asks whether *any* event on the span matches.
   *
   * Every part is a trusted SQL fragment from the schema, never from the query
   * text: `table` and `column` are identifiers, `joinSql` is the predicate
   * tying a child row to the current one.
   */
  related?: Record<string, { table: string; column: string; joinSql: string }>;
}

export interface CompiledQuery {
  /** A WHERE-clause fragment. `1` matches everything, `0` matches nothing. */
  sql: string;
  params: unknown[];
}

/** The escape character for LIKE patterns; also escaped within them. */
const LIKE_ESCAPE = '\\';

export function compileWhere(
  node: QueryNode,
  schema: SignalSchema,
): CompiledQuery {
  const params: unknown[] = [];
  const sql = emit(node, schema, params);
  return { sql, params };
}

function emit(
  node: QueryNode,
  schema: SignalSchema,
  params: unknown[],
): string {
  switch (node.type) {
    case 'all':
      return '1';

    case 'and':
    case 'or': {
      const left = emit(node.left, schema, params);
      const right = emit(node.right, schema, params);
      const keyword = node.type === 'and' ? 'AND' : 'OR';
      // Always parenthesise: the AST already encodes precedence, and relying on
      // SQL's own precedence to reproduce it is a bug waiting for the first
      // mixed AND/OR query.
      return `(${left} ${keyword} ${right})`;
    }

    case 'freeText': {
      const pattern = likePattern(node.text, 'contains');
      const clauses = schema.freeTextColumns.map((field) => {
        params.push(pattern);
        return `${targetSql(field, schema, params, { pathAlreadyPushed: false })} LIKE ? ESCAPE '${LIKE_ESCAPE}'`;
      });
      if (clauses.length === 0) return '1';
      if (clauses.length === 1) return clauses[0];
      return `(${clauses.join(' OR ')})`;
    }

    case 'comparison':
      return emitComparison(node.field, node.op, node.value, schema, params);
  }
}

/**
 * SQL for the left-hand side of a comparison.
 *
 * A known field becomes a quoted column identifier taken from the schema. An
 * unknown one becomes `json_extract(<attrs>, ?)` with the JSON path bound as a
 * parameter — so an arbitrary attribute key is queryable without ever being
 * concatenated into SQL.
 *
 * The parameter ordering is fiddly and deliberate: the path parameter must be
 * pushed *before* the value parameter, because it appears earlier in the
 * emitted SQL.
 */
function targetSql(
  field: string,
  schema: SignalSchema,
  params: unknown[],
  opts: { pathAlreadyPushed: boolean },
): string {
  const known = schema.columns[field];
  if (known) return quoteIdent(known.column);

  if (!opts.pathAlreadyPushed) params.push(jsonPath(field));
  return `json_extract(${quoteIdent(schema.attributesColumn)}, ?)`;
}

function emitComparison(
  field: string,
  op: Operator,
  value: QueryValue,
  schema: SignalSchema,
  params: unknown[],
): string {
  // A child-table field asks whether *any* related row matches, so the whole
  // comparison moves inside an EXISTS rather than reading a column on this row.
  const related = schema.related?.[field];
  if (related) {
    const target = `rel.${quoteIdent(related.column)}`;
    const predicate = applyOperator(target, op, value, params);
    return `EXISTS (SELECT 1 FROM ${quoteIdent(related.table)} rel WHERE ${related.joinSql} AND ${predicate})`;
  }

  const isAttribute = !schema.columns[field];
  if (
    isAttribute &&
    op === '=' &&
    value.type !== 'null' &&
    schema.attributeIndex
  ) {
    params.push(
      schema.attributeIndex.signal,
      field,
      JSON.stringify(jsonScalar(value)),
    );
    return `EXISTS (SELECT 1 FROM ${quoteIdent(schema.attributeIndex.table)} ai WHERE ai.signal = ? AND ai.entity_id = ${schema.attributeIndex.entitySql} AND ai.key = ? AND ai.value_json = ?)`;
  }
  // Push the JSON path first when the target is an attribute — it precedes the
  // value placeholder in the emitted SQL, and params must match that order.
  if (isAttribute) params.push(jsonPath(field));
  const target = targetSql(field, schema, params, {
    pathAlreadyPushed: isAttribute,
  });
  return applyOperator(target, op, value, params);
}

/**
 * The operator half of a comparison, against an already-built target
 * expression. Split out so a child-table field can reuse it inside an EXISTS.
 */
function applyOperator(
  target: string,
  op: Operator,
  value: QueryValue,
  params: unknown[],
): string {
  // NULL is a predicate, not a value: `= NULL` is never true in SQL, so the
  // only useful reading of what the user typed is IS NULL.
  if (value.type === 'null') {
    if (op === '=') return `${target} IS NULL`;
    if (op === '!=') return `${target} IS NOT NULL`;
  }

  switch (op) {
    case '=':
    case '!=':
    case '>':
    case '<':
    case '>=':
    case '<=':
      params.push(scalar(value));
      return `${target} ${op} ?`;

    case 'CONTAINS':
    case 'NOT CONTAINS':
    case '^':
    case '$': {
      const mode = op === '^' ? 'prefix' : op === '$' ? 'suffix' : 'contains';
      params.push(likePattern(String(scalar(value) ?? ''), mode));
      const keyword = op === 'NOT CONTAINS' ? 'NOT LIKE' : 'LIKE';
      return `${target} ${keyword} ? ESCAPE '${LIKE_ESCAPE}'`;
    }

    case 'REGEXP':
    case 'NOT REGEXP':
      params.push(String(scalar(value) ?? ''));
      return `${target} ${op} ?`;

    case 'IN':
    case 'NOT IN': {
      const elements = value.type === 'array' ? value.values : [value];
      if (elements.length === 0) {
        // `IN ()` is a syntax error in SQLite. An empty set matches nothing,
        // and an empty NOT IN matches everything.
        return op === 'IN' ? '0' : '1';
      }
      for (const element of elements) params.push(scalar(element));
      return `${target} ${op} (${elements.map(() => '?').join(', ')})`;
    }
  }
}

type JsonScalar = string | number | boolean | null | JsonScalar[];

function jsonScalar(value: QueryValue): JsonScalar {
  if (value.type === 'array') return value.values.map(jsonScalar);
  if (value.type === 'null') return null;
  if (value.type === 'boolean') return value.value;
  return value.value;
}

/** The bindable value for a scalar node. Arrays never reach here. */
function scalar(value: QueryValue): string | number | boolean | null {
  switch (value.type) {
    case 'string':
      return value.value;
    case 'number':
      return value.value;
    case 'boolean':
      // SQLite has no boolean type; 1/0 is what a JSON `true` extracts as.
      return value.value ? 1 : 0;
    case 'null':
      return null;
    case 'array':
      // Defensive: an array in scalar position is a caller bug, and rendering
      // it as text beats emitting a malformed statement.
      return JSON.stringify(value.values);
  }
}

/**
 * A JSON path for an attribute key.
 *
 * The key is wrapped in double quotes so dots inside it (`http.status_code`)
 * are one key rather than a nested path, and embedded quotes and backslashes
 * are escaped so the path itself stays well-formed. This string is *bound as a
 * parameter*, never concatenated into SQL — the escaping here protects the JSON
 * path grammar, not the SQL.
 */
function jsonPath(key: string): string {
  const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `$."${escaped}"`;
}

/**
 * Build a LIKE pattern, escaping the wildcards LIKE would otherwise honour.
 *
 * Someone searching for `100%` or `user_id` means those characters literally;
 * without escaping, `%` matches anything and `_` matches any single character,
 * and the search quietly returns far too much.
 */
function likePattern(
  text: string,
  mode: 'contains' | 'prefix' | 'suffix',
): string {
  const escaped = text
    .replace(/\\/g, `${LIKE_ESCAPE}\\`)
    .replace(/%/g, `${LIKE_ESCAPE}%`)
    .replace(/_/g, `${LIKE_ESCAPE}_`);
  if (mode === 'prefix') return `${escaped}%`;
  if (mode === 'suffix') return `%${escaped}`;
  return `%${escaped}%`;
}

/**
 * Quote a SQL identifier.
 *
 * Identifiers only ever come from a `SignalSchema` the caller authored, so this
 * is defence in depth rather than the primary control — but a schema built from
 * config one day should not become an injection vector.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
