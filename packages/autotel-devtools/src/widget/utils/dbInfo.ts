/**
 * Extracts structured database information from OpenTelemetry `db.*` span
 * attributes and provides lightweight, display-only SQL keyword highlighting.
 *
 * Supports both legacy (`db.system`, `db.statement`, `db.operation`) and current
 * (`db.system.name`, `db.query.text`, `db.operation.name`) semantic conventions.
 *
 * `highlightSql` never reformats or rewrites the query — it only tokenizes it so
 * the UI can colour keywords and string literals. Reassembling the token text
 * reproduces the input verbatim, so a query can never be mangled.
 */

export interface DbInfo {
  system?: string;
  statement?: string;
  operation?: string;
  table?: string;
  dbName?: string;
  rowCount?: number;
}

function firstString(
  attributes: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const v = attributes[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function firstNumber(
  attributes: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const v = attributes[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

export function extractDbInfo(
  attributes: Record<string, unknown>,
): DbInfo | null {
  const system = firstString(attributes, ['db.system', 'db.system.name']);
  const statement = firstString(attributes, ['db.statement', 'db.query.text']);
  if (!system && !statement) return null;

  return {
    system,
    statement,
    operation: firstString(attributes, ['db.operation', 'db.operation.name']),
    table: firstString(attributes, ['db.sql.table', 'db.collection.name']),
    dbName: firstString(attributes, ['db.name', 'db.namespace']),
    rowCount: firstNumber(attributes, [
      'db.response.returned_rows',
      'db.rows_affected',
    ]),
  };
}

export type SqlTokenKind = 'keyword' | 'string' | 'text';

export interface SqlToken {
  text: string;
  kind: SqlTokenKind;
}

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set',
  'delete', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'on',
  'and', 'or', 'not', 'in', 'is', 'null', 'as', 'order', 'by', 'group',
  'having', 'limit', 'offset', 'distinct', 'union', 'all', 'returning',
  'with', 'using', 'between', 'like', 'asc', 'desc', 'count', 'case', 'when',
  'then', 'else', 'end', 'exists', 'create', 'table', 'alter', 'drop', 'index',
]);

// Split into string literals, identifier/word runs, and everything else, so we
// can classify each chunk without ever dropping or reordering characters.
const SQL_TOKEN_RE = /('(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_]*|[^A-Za-z_']+)/g;

export function highlightSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  for (const [chunk] of sql.matchAll(SQL_TOKEN_RE)) {
    if (chunk.startsWith("'")) {
      tokens.push({ text: chunk, kind: 'string' });
    } else if (/^[A-Za-z_]/.test(chunk) && SQL_KEYWORDS.has(chunk.toLowerCase())) {
      tokens.push({ text: chunk, kind: 'keyword' });
    } else {
      tokens.push({ text: chunk, kind: 'text' });
    }
  }
  return tokens;
}
