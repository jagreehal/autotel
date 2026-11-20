/**
 * Databases, driver-agnostic: pass `query(sql)` from whatever client the app
 * already has (pg, mysql2, node:sqlite, a Snowflake SDK) and get the
 * database's own catalog, sampled rows, full-table quality metrics and SLA
 * ages. Every value placed into SQL comes from the contract or the catalog,
 * and is quoted as an identifier or a literal.
 */
import {
  findObject,
  isZeroTolerance,
  meetsThreshold,
  ruleMetric,
  unmeasurable,
  type DataContract,
  type LogicalType,
  type QualityRule,
  type SchemaObject,
  type SchemaProperty,
} from './contract.js';
import {
  checkRecords,
  contractGaps,
  duplicateKeyFinding,
  inferObject,
  nestedRulesNotRun,
  unknownColumns,
  profileRecords,
  report,
  type CheckReport,
  type Finding,
  type InferOptions,
  type QualityResult,
  type SlaResult,
} from './profile.js';
import { strictConstraints, uniqueKeys } from './constraints.js';
import { measureSla, slasFor, toEpochMs } from './sla.js';

export type QueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>;

/**
 * `mssql` is SQL Server / Azure SQL (`TOP`, bracketed names). `ansi` reads
 * `information_schema` with double-quoted names and samples with `LIMIT`:
 * Snowflake, Redshift, DuckDB, Trino. A database that has neither `LIMIT`
 * nor `TOP` (Oracle) is not supported.
 */
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'ansi';

export interface DatabaseOptions {
  query: QueryFn;
  dialect: Dialect;
  /** Schema (namespace) to read. Default: the connection's current schema. Required for `ansi`. */
  schema?: string;
  /** Tables to read. Default: all base tables in the schema. */
  tables?: string[];
  /** Rows sampled per table for value checks and profiling: a non-negative integer, or Infinity for every row. Default 1000. 0 skips sampling. */
  sampleSize?: number;
  /** Clock for SLA ages, epoch ms. Default Date.now. */
  now?: () => number;
  /**
   * Called with every failed query, in-process. Reports carry only a stable
   * reason (`query failed (42703)`): a driver's message can quote the value
   * it rejected, and reports get shared.
   */
  onQueryError?: (error: unknown, sql: string) => void;
  /** Clock-skew allowance: a newest value later than now plus this cannot be measured. Default 5 min. */
  maxClockSkewMs?: number;
}

/** A query failure as a report can carry it: the driver's error code, never its message. */
export function queryFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[\w.-]{1,40}$/.test(code)
    ? `query failed (${code})`
    : typeof code === 'number'
      ? `query failed (${code})`
      : 'query failed';
}

/** Run a query through the caller's client, reporting a failure to `onQueryError` before rethrowing. */
async function runQuery(
  options: DatabaseOptions,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    return await options.query(sql);
  } catch (error) {
    options.onQueryError?.(error, sql);
    throw error;
  }
}

export interface ColumnInfo {
  name: string;
  /** The full type, with length or precision when the catalog has it: `varchar(100)`, `numeric(10,2)`. */
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface TableInfo {
  name: string;
  /** What the catalog holds it as. */
  kind: 'table' | 'view';
  columns: ColumnInfo[];
}

export function quoteIdent(dialect: Dialect, name: string): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``;
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`;
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteLiteral(dialect: Dialect, value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  let text = String(value).replaceAll("'", "''");
  // MySQL treats backslash as an escape inside string literals by default.
  if (dialect === 'mysql') text = text.replaceAll('\\', String.raw`\\`);
  return `'${text}'`;
}

const lower = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));

/** Read tables and columns from the database's own catalog. */
export async function introspect(
  options: DatabaseOptions,
  /** Catalog objects to read. A draft reads tables; an audit also finds the views a contract declares. */
  kinds: ReadonlyArray<'table' | 'view'> = ['table'],
): Promise<TableInfo[]> {
  const { dialect } = options;
  let rows: Array<Record<string, unknown>>;
  if (dialect === 'sqlite') {
    rows = await runQuery(
      options,
      `SELECT m.name AS table_name, m.type AS table_kind, p.name AS column_name, p.type AS data_type,
              CASE WHEN p."notnull" = 1 THEN 'NO' ELSE 'YES' END AS is_nullable, p.pk AS pk
         FROM sqlite_master m JOIN pragma_table_info(m.name) p
        WHERE m.type IN (${kinds.map((k) => `'${k}'`).join(', ')}) AND m.name NOT LIKE 'sqlite_%'
        ORDER BY m.name, p.cid`,
    );
  } else {
    const schema =
      options.schema === undefined
        ? dialect === 'postgres'
          ? 'current_schema()'
          : dialect === 'mysql'
            ? 'DATABASE()'
            : dialect === 'mssql'
              ? 'SCHEMA_NAME()'
              : undefined
        : quoteLiteral(dialect, options.schema);
    if (!schema) throw new Error(`dialect ${dialect} needs options.schema`);
    const columns = await runQuery(
      options,
      `SELECT c.table_name, t.table_type AS table_kind, c.column_name, c.data_type, c.is_nullable,
              c.character_maximum_length, c.numeric_precision, c.numeric_scale${dialect === 'mysql' ? ', c.column_type' : dialect === 'postgres' ? ', c.udt_name' : ''}
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = ${schema} AND t.table_type IN (${kinds.map((k) => (k === 'view' ? "'VIEW'" : "'BASE TABLE'")).join(', ')})
        ORDER BY c.table_name, c.ordinal_position`,
    );
    const pkRows = await runQuery(
      options,
      `SELECT k.table_name, k.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage k
               ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                  AND k.table_name = tc.table_name
            WHERE tc.table_schema = ${schema} AND tc.constraint_type = 'PRIMARY KEY'`,
    ).catch(() => []); // primary keys are a nicety; a catalog without these views still audits
    const pks = new Set(
      pkRows
        .map((r) => lower(r))
        .map((r) => `${String(r.table_name)}\0${String(r.column_name)}`),
    );
    rows = columns
      .map((r) => lower(r))
      .map((r) => ({
        ...r,
        pk: pks.has(`${String(r.table_name)}\0${String(r.column_name)}`)
          ? 1
          : 0,
      }));
  }
  const tables = new Map<string, TableInfo>();
  for (const raw of rows) {
    const r = lower(raw);
    const name = String(r.table_name);
    if (options.tables && !options.tables.includes(name)) continue;
    let t = tables.get(name);
    if (!t)
      tables.set(
        name,
        (t = {
          name,
          kind: /view/i.test(String(r.table_kind)) ? 'view' : 'table',
          columns: [],
        }),
      );
    t.columns.push({
      name: String(r.column_name),
      dataType: fullType(r),
      nullable: String(r.is_nullable).toUpperCase() !== 'NO',
      primaryKey: Number(r.pk) > 0,
    });
  }
  return [...tables.values()];
}

/**
 * The column's type with its length or precision. information_schema keeps
 * them apart from data_type; MySQL's column_type already joins them (and
 * says `unsigned`); SQLite's pragma type is written as declared.
 */
function fullType(r: Record<string, unknown>): string {
  if (typeof r.column_type === 'string') return r.column_type;
  // Postgres reports extension and enum types (citext, a CREATE TYPE … AS ENUM) as USER-DEFINED; the name is in udt_name.
  const base =
    String(r.data_type).toUpperCase() === 'USER-DEFINED' &&
    typeof r.udt_name === 'string'
      ? r.udt_name
      : String(r.data_type);
  if (/\(/.test(base)) return base;
  const length = r.character_maximum_length;
  if (length !== null && length !== undefined)
    return `${base}(${Number(length) === -1 ? 'max' : String(length)})`;
  // Precision belongs in the type only for exact decimals; integer columns report it too.
  if (
    /^(numeric|decimal|number)$/i.test(base) &&
    r.numeric_precision !== null &&
    r.numeric_precision !== undefined
  )
    return `${base}(${String(r.numeric_precision)},${String(r.numeric_scale ?? 0)})`;
  return base;
}

const TYPE_SYNONYMS: Record<string, string> = {
  'character varying': 'varchar',
  varchar2: 'varchar',
  character: 'char',
  bpchar: 'char',
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  float8: 'double',
  'double precision': 'double',
  float4: 'real',
  decimal: 'numeric',
  bool: 'boolean',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
  'time without time zone': 'time',
};

/** A physical type as base + arguments, with synonyms folded: `CHARACTER VARYING(100)` → varchar, [100]. */
export function parsePhysicalType(t: string): { base: string; args: string[] } {
  // Base runs to the `(` or the end; anything after the arguments (`unsigned`, `with time zone`) stays on it.
  const m = /^\s*([^(]*?)\s*(?:\(([^)]*)\)\s*(.*))?$/.exec(t.toLowerCase())!;
  const base = m[1]!.replaceAll(/\s+/g, ' ');
  const rest = m[3] ? ` ${m[3].trim()}` : '';
  return {
    base: (TYPE_SYNONYMS[base] ?? base) + rest,
    args: m[2] === undefined ? [] : m[2].split(',').map((a) => a.trim()),
  };
}

/**
 * Whether a column's type keeps the contract's physicalType. Arguments the
 * contract states (a length, a precision) must match; a contract that states
 * none (`VARCHAR`) accepts any.
 */
export function samePhysicalType(declared: string, actual: string): boolean {
  const d = parsePhysicalType(declared);
  const a = parsePhysicalType(actual);
  if (d.base !== a.base) return false;
  return d.args.length === 0 || d.args.join(',') === a.args.join(',');
}

/**
 * The sample size, checked: a non-negative integer, or Infinity (every row)
 * only when asked for by name. NaN, a negative or a fraction is a
 * configuration error, never an unbounded read.
 */
export function sampleSizeOf(options: { sampleSize?: number }): number {
  return rowLimit(options.sampleSize ?? 1000);
}

function rowLimit(n: number): number {
  if (n === Infinity || (Number.isSafeInteger(n) && n >= 0)) return n;
  throw new RangeError(
    `sampleSize must be a non-negative integer or Infinity, not ${String(n)}`,
  );
}

export async function sampleRows(
  options: DatabaseOptions,
  table: string,
  n = sampleSizeOf(options),
): Promise<Array<Record<string, unknown>>> {
  if (rowLimit(n) === 0) return [];
  // First N rows, not a random sample; use TABLESAMPLE per dialect if skew matters.
  // Infinity reads the whole table, for a verdict on every row.
  if (n === Infinity)
    return runQuery(options, `SELECT * FROM ${tableRef(options, table)}`);
  return runQuery(
    options,
    options.dialect === 'mssql'
      ? `SELECT TOP ${n} * FROM ${tableRef(options, table)}`
      : `SELECT * FROM ${tableRef(options, table)} LIMIT ${n}`,
  );
}

/** Logical type for a database column type, by the usual names across dialects. */
export function logicalTypeOf(dataType: string): LogicalType {
  const t = dataType.toLowerCase();
  if (/bool|bit\b/.test(t)) return 'boolean';
  if (/^(tiny|small|medium|big)?int|integer|serial|^int\d/.test(t))
    return 'integer';
  if (/numeric|decimal|real|double|float|money|number/.test(t)) return 'number';
  if (/timestamp|datetime/.test(t)) return 'timestamp';
  if (t.startsWith('date')) return 'date';
  if (t.startsWith('time')) return 'time';
  if (/json|struct|object|variant|map/.test(t)) return 'object';
  if (/array|\[\]/.test(t)) return 'array';
  return 'string';
}

export interface DraftOptions extends InferOptions {
  id: string;
  name?: string;
  /** Server entry recorded in the draft, without credentials. */
  server?: Record<string, unknown>;
}

/**
 * Data-first: draft an ODCS contract from a database as it is, catalog types
 * plus what a sample of rows shows. Status `draft`, version `0.1.0`: enrich
 * it, then flip the direction so the data follows the contract.
 */
export async function draftContractFromDatabase(
  options: DatabaseOptions,
  draft: DraftOptions,
): Promise<DataContract> {
  sampleSizeOf(options); // a bad size fails before any query
  const schema: SchemaObject[] = [];
  for (const table of await introspect(options)) {
    const rows = await sampleRows(options, table.name);
    const inferred = inferObject(table.name, profileRecords(rows), draft);
    schema.push({
      name: table.name,
      physicalName: table.name,
      physicalType: 'table',
      properties: table.columns.map((c) => {
        const prop: SchemaProperty = {
          ...inferred.properties?.find((p) => p.name === c.name),
          name: c.name,
          physicalType: c.dataType,
          logicalType: logicalTypeOf(c.dataType),
        };
        // Only the catalog's NOT NULL is a promise; a sample without nulls is not.
        delete prop.required;
        if (!c.nullable) prop.required = true;
        if (c.primaryKey) prop.primaryKey = true;
        return prop;
      }),
    });
  }
  return {
    apiVersion: 'v3.1.0',
    kind: 'DataContract',
    id: draft.id,
    name: draft.name ?? draft.id,
    version: '0.1.0',
    status: 'draft',
    ...(draft.server ? { servers: [draft.server] } : {}),
    schema,
  };
}

/**
 * Hold a live database to its contract. Per schema object: catalog drift
 * (columns the contract does not know, columns it promises that are gone,
 * type and nullability drift), value checks over a sample, every library and
 * sql quality rule over the whole table, and freshness/retention SLAs.
 */
export async function auditDatabase(
  contract: DataContract,
  options: DatabaseOptions,
): Promise<CheckReport[]> {
  sampleSizeOf(options); // a bad size fails before any query
  const tables = await introspect({ ...options, tables: undefined }, [
    'table',
    'view',
  ]);
  const reports: CheckReport[] = [];
  for (const obj of contract.schema ?? []) {
    if (options.tables && !options.tables.includes(obj.name)) continue;
    const physical = obj.physicalName ?? obj.name;
    const table =
      tables.find((t) => t.name === physical) ??
      tables.find((t) => t.name.toLowerCase() === physical.toLowerCase());
    if (!table) {
      reports.push(
        report(
          contract,
          obj.name,
          0,
          [
            {
              object: obj.name,
              path: '$',
              code: 'missing-column',
              severity: 'error',
              message: `table ${physical} not found`,
            },
          ],
          [],
        ),
      );
      continue;
    }
    reports.push(await auditTable(contract, obj, table, options));
  }
  if (!options.tables) {
    const statements = await checkVerifiedStatements(contract, options);
    if (statements.length)
      reports.push(report(contract, CONTEXT_OBJECT, 0, [], statements));
  }
  return reports;
}

/** The report that carries the AI context's verified statements. */
export const CONTEXT_OBJECT = '(context)';

/**
 * The AI context's verified statements: answers the provider vouches for,
 * which agents reuse instead of writing their own query. Each answer must
 * still run against the live database; one that no longer does (a renamed
 * column, a dropped table) is a broken promise to every agent that reuses it.
 * Run verbatim, as sql quality rules are: the contract is trusted content.
 * Only whether it runs is checked; nothing records what it returned.
 */
export async function checkVerifiedStatements(
  contract: DataContract,
  options: DatabaseOptions,
): Promise<QualityResult[]> {
  const list = (
    contract.context as { verifiedStatements?: unknown } | undefined
  )?.verifiedStatements;
  const out: QualityResult[] = [];
  for (const [i, st] of (Array.isArray(list) ? list : []).entries()) {
    const { question, answer } = (st ?? {}) as {
      question?: unknown;
      answer?: unknown;
    };
    const base = {
      object: CONTEXT_OBJECT,
      metric: `verifiedStatements[${i}]`,
      rule: {
        type: 'sql',
        ...(typeof question === 'string' ? { description: question } : {}),
        ...(typeof answer === 'string' ? { query: answer } : {}),
      },
    };
    if (typeof answer !== 'string' || typeof question !== 'string') {
      out.push({
        ...base,
        status: 'not-run',
        skipped: 'needs a question and an answer query',
      });
      continue;
    }
    try {
      const rows = await runQuery(options, answer);
      out.push({ ...base, status: 'passed', passed: true, value: rows.length });
    } catch (error) {
      out.push({
        ...base,
        status: 'failed',
        passed: false,
        error: `the answer no longer runs: ${queryFailure(error)}`,
      });
    }
  }
  return out;
}

/**
 * The query a tolerant reader runs: the columns it names, never `SELECT *`,
 * so a column the provider adds later changes nothing for it. Columns are the
 * contract's names, read from their physical names. Throws on a name the
 * contract does not promise: a consumer reading it relies on nothing.
 */
export function tolerantSelect(
  contract: DataContract,
  object: string,
  options: Pick<DatabaseOptions, 'dialect' | 'schema'>,
  columns?: string[],
): string {
  const obj = (contract.schema ?? []).find((o) => o.name === object);
  if (!obj) throw new Error(`no schema object ${object}`);
  const props = obj.properties ?? [];
  const wanted = columns ?? props.map((p) => p.name);
  const q = (name: string) => quoteIdent(options.dialect, name);
  const list = wanted.map((name) => {
    const prop = props.find((p) => p.name === name);
    if (!prop) throw new Error(`${object} promises no property ${name}`);
    const physical = prop.physicalName ?? prop.name;
    return physical === prop.name
      ? q(physical)
      : `${q(physical)} AS ${q(prop.name)}`;
  });
  if (list.length === 0)
    throw new Error(`${object} promises no properties to select`);
  return `SELECT ${list.join(', ')} FROM ${tableRef(options, obj.physicalName ?? obj.name)}`;
}

/**
 * One table. Every query failure is caught here and named in `unchecked`, so
 * one table's broken query leaves its own report incomplete and the audit
 * goes on to the next.
 */
async function auditTable(
  contract: DataContract,
  obj: SchemaObject,
  table: TableInfo,
  options: DatabaseOptions,
): Promise<CheckReport> {
  const unchecked: string[] = [];
  const findings = catalogDrift(obj, table);
  findings.push(...contractGaps(obj).filter((f) => f.code === 'undocumented'));

  let total: number | undefined;
  try {
    total = await rowCount(options, table.name);
    if (!Number.isFinite(total)) throw new Error('row count is not a number');
  } catch (error) {
    total = undefined;
    unchecked.push(`row count: ${queryFailure(error)}`);
  }
  // sampleSize 0 is a choice: no value checks, and nothing to fall back on.
  let sampled: CheckReport | undefined;
  let sampleRowsRead = 0;
  // Whether the sample read every row. One row past sampleSize says there is
  // more: a row count taken before the sample can be stale (a row inserted in
  // between), so it alone never proves the sample whole.
  let wholeTable = false;
  const size = sampleSizeOf(options);
  let sampleRecords: Array<Record<string, unknown>> = [];
  if (size > 0) {
    try {
      const read = await sampleRows(options, table.name, size + 1);
      const rows = read.slice(0, size);
      sampleRowsRead = rows.length;
      sampleRecords = rows.map((r) => renameColumns(obj, table, r));
      sampled = checkRecords(contract, obj.name, sampleRecords, {
        lenient: true,
        unknownFields: false,
        sampled: true,
      });
      // Both must agree: the extra row catches an insert after the count, the count a short read.
      wholeTable =
        read.length <= size && (total === undefined || rows.length >= total);
      // Catalog drift already covers unknown and absent columns; keep the value-level findings.
      findings.push(
        ...sampled.findings.filter(
          (f) => f.code !== 'never-present' && f.code !== 'undocumented',
        ),
      );
    } catch (error) {
      unchecked.push(`sample: ${queryFailure(error)}`);
    }
  }
  // What the database holds as the declared type, per property, proven once.
  const proofs = new Map<string, boolean>();
  for (const prop of obj.properties ?? []) {
    const column = columnOf(table, prop.physicalName ?? prop.name);
    if (!column) continue;
    const proven = await storageMatches(
      options,
      table.name,
      prop,
      column,
      quoteIdent(options.dialect, column.name),
    ).catch(() => false); // runQuery already told onQueryError, with the SQL
    proofs.set(prop.name, proven);
  }
  /** The exact SQL operand for a property (against these values, or to group on), or undefined. */
  const operandFor: OperandFor = (name, values) => {
    const prop = obj.properties?.find((p) => p.name === name);
    const column = prop && columnOf(table, prop.physicalName ?? prop.name);
    return (
      column &&
      exactOperand(
        options,
        column,
        quoteIdent(options.dialect, column.name),
        proofs.get(name) ?? false,
        values,
      )
    );
  };

  // Uniqueness over the whole table, where SQL groups exactly as the runtime
  // compares; otherwise the sample's count (complete only on a whole-table sample).
  for (const key of uniqueKeys(obj)) {
    const ops = key.map((k) => operandFor(k));
    if (ops.some((o) => o === undefined)) {
      if (!wholeTable)
        unchecked.push(
          `unique ${key.join(',')}: no exact comparison in SQL here; the sample read ${sampleRowsRead} of ${total ?? 'an unknown number of'} rows`,
        );
      continue;
    }
    try {
      const count = Number(
        await scalar(
          options,
          duplicateSql(options, table.name, ops as string[]),
        ),
      );
      if (!Number.isFinite(count))
        throw new Error('duplicate count is not a number');
      const at = findings.findIndex(
        (f) => f.code === 'duplicate-key' && f.path === key.join(','),
      );
      const sampleCount = at === -1 ? 0 : (findings[at]!.count ?? 0);
      if (count < sampleCount) {
        unchecked.push(
          `unique ${key.join(',')}: the database counted ${count}, the sample ${sampleCount}; its comparison differs`,
        );
        continue;
      }
      if (at !== -1) findings.splice(at, 1);
      if (count > 0)
        findings.push(duplicateKeyFinding(obj.name, key, count, total ?? 0));
    } catch (error) {
      unchecked.push(`unique ${key.join(',')}: ${queryFailure(error)}`);
    }
  }
  // Per-record promises over every row: SQL where SQL can state them, the
  // sample for the rest, and `incomplete` when the sample did not read every row.
  const sampleOnly: string[] = [];
  for (const prop of obj.properties ?? []) {
    const column = columnOf(table, prop.physicalName ?? prop.name);
    if (!column) continue; // missing-column already says it
    const col = quoteIdent(options.dialect, column.name);
    const typeProven = proofs.get(prop.name) ?? false;
    const plan = coverage(options, prop, column, col, typeProven);
    for (const check of plan.checks) {
      try {
        const count = Number(
          await scalar(
            options,
            `SELECT ${countOf(options)}(*) AS v FROM ${tableRef(options, table.name)} WHERE ${check.where}`,
          ),
        );
        if (!Number.isFinite(count)) throw new Error('count is not a number');
        const seen = findings.filter(
          (f) => f.path === prop.name && f.code === check.code,
        );
        const sampleCount = seen.reduce((n, f) => n + (f.count ?? 0), 0);
        if (count < sampleCount) {
          // The database saw fewer than the sample did, so its comparison is
          // not the runtime's (a collation, padding). What was observed stands.
          unchecked.push(
            `${prop.name} ${check.code}: the database counted ${count}, the sample ${sampleCount}; its comparison differs`,
          );
          continue;
        }
        // Equivalent and complete: the full count replaces the sample's lower bound.
        for (const f of seen) findings.splice(findings.indexOf(f), 1);
        if (count > 0)
          findings.push({
            object: obj.name,
            path: prop.name,
            code: check.code,
            severity: 'error',
            message: check.message,
            expected: check.expected,
            count,
            rate: total ? count / total : undefined,
          });
      } catch (error) {
        unchecked.push(`${prop.name} ${check.code}: ${queryFailure(error)}`);
      }
    }
    if (!wholeTable && plan.residual) sampleOnly.push(prop.name);
  }
  if (sampleOnly.length)
    unchecked.push(
      `values: the sample read ${sampleRowsRead} of ${total ?? 'an unknown number of'} rows; checked only there: ${sampleOnly.join(', ')} (sampleSize: Infinity reads every row)`,
    );

  // The sample stands in for a rule with no SQL form here (a regex pattern)
  // only when it read the whole table: a clean partial sample proves nothing.
  const measured = await runQuality(contract, obj, table, options, operandFor);
  const quality = measured.map((q) => {
    if (q.status !== 'not-run' || !q.skipped?.startsWith('no SQL form'))
      return q;
    const fromSample = sampled?.quality.find(
      (s) => s.rule === q.rule && s.status !== 'not-run',
    );
    if (wholeTable && fromSample) return { ...fromSample, sampled: false };
    // A sample can only undercount, so one violation already fails a zero-tolerance rule.
    if (fromSample?.status === 'failed' && isZeroTolerance(q.rule))
      return fromSample;
    const why = sampled
      ? `the sample read ${sampleRowsRead} of ${total ?? 'an unknown number of'} rows`
      : 'no sample was read';
    return { ...q, skipped: `${q.skipped}; ${why}` };
  });
  const sla = await measureTableSla(contract, obj, table, options, {
    rows: sampleRecords,
    whole: wholeTable,
  });
  return report(
    contract,
    obj.name,
    total ?? sampleRowsRead,
    findings,
    quality,
    sla,
    unchecked,
  );
}

/**
 * Rows repeating an earlier row's value tuple over these (quoted) columns;
 * a row with a NULL in any of them is not compared, as SQL UNIQUE reads it.
 */
function duplicateSql(
  options: DatabaseOptions,
  table: string,
  cols: string[],
): string {
  return `SELECT COALESCE(SUM(n - 1), 0) AS v FROM (SELECT ${countOf(options)}(*) AS n FROM ${tableRef(options, table)} WHERE ${cols.map((c) => `${c} IS NOT NULL`).join(' AND ')} GROUP BY ${cols.join(', ')} HAVING ${countOf(options)}(*) > 1) d`;
}

interface TableCheck {
  code:
    'required-missing' | 'invalid-value' | 'below-minimum' | 'above-maximum';
  where: string;
  message: string;
  expected?: string;
}

/** Shapes a JSON or VARIANT column holds without telling object from array from scalar. */
const SHAPE_TYPES = new Set(['object', 'array', 'map', 'vector']);

/** SQLite storage classes that prove a declared type; others cannot be proven by storage. */
const SQLITE_STORAGE: Partial<Record<string, string[]>> = {
  integer: ['integer'],
  number: ['integer', 'real'],
  string: ['text'],
};

/**
 * Whether the database holds this column as the declared type. Most engines
 * enforce their column types, so a matching column proves it. SQLite does
 * not (an INTEGER column can hold 'bad'), so there the storage class of every
 * non-null value is counted. Shape types are never proven by a column.
 */
async function storageMatches(
  options: DatabaseOptions,
  table: string,
  prop: SchemaProperty,
  column: ColumnInfo,
  col: string,
): Promise<boolean> {
  const declared = prop.logicalType;
  if (declared === undefined) return true;
  if (SHAPE_TYPES.has(declared)) return false;
  const columnType = logicalTypeOf(column.dataType);
  if (options.dialect === 'sqlite') {
    const classes = SQLITE_STORAGE[declared];
    if (!classes) return false;
    const n = Number(
      await scalar(
        options,
        `SELECT ${countOf(options)}(*) AS v FROM ${tableRef(options, table)} WHERE ${col} IS NOT NULL AND typeof(${col}) NOT IN (${classes.map((c) => `'${c}'`).join(', ')})`,
      ),
    );
    return n === 0;
  }
  return (
    declared === columnType ||
    (declared === 'number' && columnType === 'integer') ||
    ((declared === 'date' || declared === 'timestamp') &&
      (columnType === 'date' || columnType === 'timestamp'))
  );
}

/**
 * A text comparison that reads like the runtime's (exact, case- and
 * space-sensitive), or undefined where this dialect cannot promise one:
 * SQL Server pads trailing spaces in every comparison, Postgres CHAR(n)
 * ignores them, and `ansi` engines' collations are unknown.
 */
/** Postgres types whose `::text` is the stored string as the driver returns it (citext keeps its case; only its operators fold). */
const POSTGRES_PLAIN_TEXT = new Set(['text', 'varchar', 'citext', 'name']);

function exactText(
  options: DatabaseOptions,
  column: ColumnInfo,
  col: string,
): string | undefined {
  const base = parsePhysicalType(column.dataType).base;
  if (options.dialect === 'sqlite') return `${col} COLLATE BINARY`;
  if (options.dialect === 'mysql') return `BINARY ${col}`;
  // Cast to plain text first: COLLATE on citext leaves citext's case-folding
  // operators in charge. CHAR(n) (padding) and enum types stay with the sample.
  if (options.dialect === 'postgres' && POSTGRES_PLAIN_TEXT.has(base))
    return `${col}::text COLLATE "C"`;
  return undefined;
}

type OperandFor = (property: string, values?: unknown[]) => string | undefined;

/**
 * The SQL expression that compares a column the way the runtime compares
 * values, or undefined where this database cannot: against `values` (all
 * strings need an exact text comparison, all numbers a column proven
 * numeric), or with no values for grouping and DISTINCT. Every SQL `=`,
 * `IN`, `DISTINCT` and `GROUP BY` on values goes through here.
 */
function exactOperand(
  options: DatabaseOptions,
  column: ColumnInfo,
  col: string,
  typeProven: boolean,
  values?: unknown[],
): string | undefined {
  const columnType = logicalTypeOf(column.dataType);
  const text =
    columnType === 'string' ? exactText(options, column, col) : undefined;
  const typed =
    typeProven && ['integer', 'number', 'boolean'].includes(columnType);
  if (values === undefined) return text ?? (typed ? col : undefined);
  if (values.length === 0) return undefined;
  if (values.every((v) => typeof v === 'string')) return text;
  if (values.every((v) => typeof v === 'number' && Number.isFinite(v)))
    return typeProven && (columnType === 'integer' || columnType === 'number')
      ? col
      : undefined;
  return undefined;
}

const ADVISORY_OPTIONS = new Set([
  'timezone',
  'defaultTimezone',
  'distanceMetric',
  'embeddingModel',
  'embeddingModelVersion',
]);

/**
 * One decision per property: the full-table SQL whose meaning equals the
 * runtime's, and whether any per-record promise is left for the sample
 * (`residual`). A promise goes to SQL only when the comparison is provably
 * the same; otherwise it is residual, never silently passed.
 */
function coverage(
  options: DatabaseOptions,
  prop: SchemaProperty,
  column: ColumnInfo,
  col: string,
  typeProven: boolean,
): { checks: TableCheck[]; residual: boolean } {
  const q = (v: unknown) => quoteLiteral(options.dialect, v);
  const strict = strictConstraints(prop);
  const checks: TableCheck[] = [];
  let residual = !typeProven;
  const columnType = logicalTypeOf(column.dataType);
  const numericColumn =
    typeProven && (columnType === 'integer' || columnType === 'number');
  const operand = (values: unknown[]) =>
    exactOperand(options, column, col, typeProven, values);

  if (strict.notNull) {
    const placeholders = strict.missing.filter(
      (v) => v !== null && v !== undefined,
    );
    const on = placeholders.length ? operand(placeholders) : col;
    if (on === undefined) residual = true;
    checks.push({
      code: 'required-missing',
      where: `${col} IS NULL${placeholders.length && on ? ` OR ${on} IN (${placeholders.map((v) => q(v)).join(', ')})` : ''}`,
      message: 'required field is missing',
    });
  }
  const lists = strict.allowed.filter((l) => l.length > 0);
  if (lists.length) {
    const on = operand(lists.flat());
    if (on === undefined) residual = true;
    else
      checks.push({
        code: 'invalid-value',
        where: `${col} IS NOT NULL AND (${lists.map((l) => `${on} NOT IN (${l.map((v) => q(v)).join(', ')})`).join(' OR ')})`,
        message: 'value is not one of the allowed values',
      });
  }
  const o = prop.logicalTypeOptions ?? {};
  const bounds = new Set([
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
  ]);
  const numericDeclared =
    prop.logicalType === 'integer' || prop.logicalType === 'number';
  if (numericColumn && numericDeclared) {
    const lo: string[] = [];
    const hi: string[] = [];
    if (typeof o.minimum === 'number')
      lo.push(
        `${col} ${o.exclusiveMinimum === true ? '<=' : '<'} ${q(o.minimum)}`,
      );
    if (typeof o.exclusiveMinimum === 'number')
      lo.push(`${col} <= ${q(o.exclusiveMinimum)}`);
    if (typeof o.maximum === 'number')
      hi.push(
        `${col} ${o.exclusiveMaximum === true ? '>=' : '>'} ${q(o.maximum)}`,
      );
    if (typeof o.exclusiveMaximum === 'number')
      hi.push(`${col} >= ${q(o.exclusiveMaximum)}`);
    if (lo.length)
      checks.push({
        code: 'below-minimum',
        where: lo.join(' OR '),
        message: 'below the minimum',
      });
    if (hi.length)
      checks.push({
        code: 'above-maximum',
        where: hi.join(' OR '),
        message: 'above the maximum',
      });
  }
  for (const key of Object.keys(o)) {
    if (ADVISORY_OPTIONS.has(key)) continue;
    if (key === 'format' && prop.logicalType === 'string') continue; // annotation, never checked
    if (bounds.has(key) && numericColumn && numericDeclared) continue;
    residual = true;
  }
  if (strict.patterns.length || prop.properties || prop.items || prop.map)
    residual = true;
  return { checks, residual };
}

/** Map physical column names onto the contract's property names. */
function renameColumns(
  obj: SchemaObject,
  table: TableInfo,
  row: Record<string, unknown>,
): Record<string, unknown> {
  // Built fresh from the contract, so a physical name equal to its own (or to
  // another property's) name cannot erase a value. Columns the contract does
  // not name are left out: catalog drift reports them.
  const out: Record<string, unknown> = {};
  for (const p of obj.properties ?? []) {
    const c = columnOf(table, p.physicalName ?? p.name);
    if (c && c.name in row) out[p.name] = row[c.name];
  }
  return out;
}

/** The catalog's column for a contract name: exact, else case-insensitive (Snowflake upper-cases, Postgres lower-cases). */
function columnOf(table: TableInfo, name: string): ColumnInfo | undefined {
  return (
    table.columns.find((c) => c.name === name) ??
    table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase())
  );
}

/** The quoted identifier SQL should use for a property: the catalog's own spelling. */
function columnSql(
  options: DatabaseOptions,
  table: TableInfo,
  prop: { name: string; physicalName?: string } | undefined,
  fallback: string,
): string {
  const name = prop?.physicalName ?? prop?.name ?? fallback;
  return quoteIdent(options.dialect, columnOf(table, name)?.name ?? name);
}

function catalogDrift(obj: SchemaObject, table: TableInfo): Finding[] {
  const out: Finding[] = [];
  // A declared kind is a promise: a table that became a view (or the reverse) is drift.
  const kind = obj.physicalType?.toLowerCase();
  if (kind !== undefined && kind !== table.kind)
    out.push({
      object: obj.name,
      path: '$',
      code: 'physical-type-drift',
      severity: 'error',
      message: `${table.name} is a ${table.kind}; the contract says ${obj.physicalType}`,
      expected: obj.physicalType,
    });
  const props = obj.properties ?? [];
  const col = (name: string) => columnOf(table, name);
  for (const p of props) {
    const c = col(p.physicalName ?? p.name);
    if (!c) {
      out.push({
        object: obj.name,
        path: p.name,
        code: 'missing-column',
        severity: 'error',
        message: 'the contract promises this column; the table has none',
      });
      continue;
    }
    const logical = logicalTypeOf(c.dataType);
    if (p.logicalType && !compatible(p.logicalType, logical))
      out.push({
        object: obj.name,
        path: p.name,
        code: 'physical-type-drift',
        severity: 'error',
        message: `column is ${c.dataType} (${logical}); the contract says ${p.logicalType}`,
        expected: p.logicalType,
        actual: c.dataType,
      });
    else if (p.physicalType && !samePhysicalType(p.physicalType, c.dataType))
      out.push({
        object: obj.name,
        path: p.name,
        code: 'physical-type-drift',
        severity: 'warning',
        message: `column is ${c.dataType}; the contract says ${p.physicalType}`,
        expected: p.physicalType,
        actual: c.dataType,
      });
    if ((p.required || p.primaryKey) && c.nullable)
      out.push({
        object: obj.name,
        path: p.name,
        code: 'nullable-drift',
        severity: 'info',
        message:
          'required by the contract, but the database accepts NULL: only the data keeps the promise',
      });
  }
  const declared = new Set(
    props.map((p) => (p.physicalName ?? p.name).toLowerCase()),
  );
  for (const c of table.columns)
    if (!declared.has(c.name.toLowerCase()))
      out.push({
        object: obj.name,
        path: c.name,
        code: 'unknown-column',
        severity: 'warning',
        message: `column (${c.dataType}) is not in the contract: nobody has said what it means`,
        actual: c.dataType,
      });
  return out;
}

const compatible = (declared: LogicalType, column: LogicalType) =>
  declared === column ||
  (declared === 'number' && column === 'integer') ||
  // Legacy schemas keep dates, numbers and JSON in text columns; the sample checks the values.
  column === 'string' ||
  (declared === 'timestamp' && column === 'date') ||
  (declared === 'date' && column === 'timestamp') ||
  (declared === 'boolean' && column === 'integer');

async function scalar(options: DatabaseOptions, sql: string): Promise<unknown> {
  const rows = await runQuery(options, sql);
  const first = rows[0];
  return first ? Object.values(first)[0] : undefined;
}

async function rowCount(
  options: DatabaseOptions,
  table: string,
): Promise<number> {
  return Number(
    await scalar(
      options,
      `SELECT ${countOf(options)}(*) AS v FROM ${tableRef(options, table)}`,
    ),
  );
}

/** SQL Server's COUNT is an int and overflows past 2^31 - 1 rows; COUNT_BIG is bigint, as COUNT is elsewhere. */
function countOf(options: DatabaseOptions): string {
  return options.dialect === 'mssql' ? 'COUNT_BIG' : 'COUNT';
}

function tableRef(
  options: Pick<DatabaseOptions, 'dialect' | 'schema'>,
  table: string,
): string {
  const t = quoteIdent(options.dialect, table);
  return options.schema && options.dialect !== 'sqlite'
    ? `${quoteIdent(options.dialect, options.schema)}.${t}`
    : t;
}

function librarySql(
  options: DatabaseOptions,
  rule: QualityRule,
  metric: string,
  from: string,
  column?: string,
  operand?: (values?: unknown[]) => string | undefined,
): string | undefined {
  const q = (v: unknown) => quoteLiteral(options.dialect, v);
  if (metric === 'rowCount')
    return `SELECT ${countOf(options)}(*) AS v FROM ${from}`;
  if (!column || !operand) return undefined;
  // Values from the rule; NULL in a list is the IS NULL test, not a value.
  const list = (key: string) => {
    const values = rule.arguments?.[key];
    return Array.isArray(values)
      ? values.filter((v) => v !== null && v !== undefined)
      : [];
  };
  switch (metric) {
    case 'nullValues': {
      return `SELECT ${countOf(options)}(*) AS v FROM ${from} WHERE ${column} IS NULL`;
    }
    case 'missingValues': {
      const missing = list('missingValues');
      if (missing.length === 0)
        return `SELECT ${countOf(options)}(*) AS v FROM ${from} WHERE ${column} IS NULL`;
      const on = operand(missing);
      return (
        on &&
        `SELECT ${countOf(options)}(*) AS v FROM ${from} WHERE ${column} IS NULL OR ${on} IN (${missing.map((v) => q(v)).join(', ')})`
      );
    }
    case 'invalidValues': {
      const valid = list('validValues');
      const on = valid.length ? operand(valid) : undefined;
      return (
        on &&
        `SELECT ${countOf(options)}(*) AS v FROM ${from} WHERE ${column} IS NOT NULL AND ${on} NOT IN (${valid.map((v) => q(v)).join(', ')})`
      );
    }
    case 'duplicateValues': {
      const on = operand();
      return (
        on &&
        `SELECT ${countOf(options)}(${on}) - ${countOf(options)}(DISTINCT ${on}) AS v FROM ${from}`
      );
    }
    default: {
      return undefined;
    }
  }
}

function compoundDuplicateSql(
  options: DatabaseOptions,
  table: string,
  names: string[],
  operandFor: OperandFor,
): string | undefined {
  const ops = names.map((k) => operandFor(k));
  return ops.every((o) => o !== undefined)
    ? duplicateSql(options, table, ops as string[])
    : undefined;
}

async function runQuality(
  contract: DataContract,
  obj: SchemaObject,
  tableInfo: TableInfo,
  options: DatabaseOptions,
  operandFor: OperandFor,
): Promise<QualityResult[]> {
  const table = tableInfo.name;
  const from = tableRef(options, table);
  const out: QualityResult[] = [];
  let total: number | undefined;
  const run = async (rule: QualityRule, property?: string) => {
    const metric = ruleMetric(rule) ?? rule.type ?? 'unknown';
    const base = { object: obj.name, property, rule, metric };
    const prop = property
      ? findObject(contract, obj.name).properties?.find(
          (p) => p.name === property,
        )
      : undefined;
    const column = prop
      ? columnSql(options, tableInfo, prop, prop.name)
      : undefined;
    let sql: string | undefined;
    if (rule.type === 'sql') {
      // One pass, with a callback: a replacement string would read `$&` in a
      // quoted name as a pattern, and a second pass would substitute into the first's output.
      let unresolved = false;
      sql = (rule.query ?? '').replaceAll(
        /\$?\{(object|property)\}/g,
        (_, which: string) => {
          if (which === 'object') return from;
          if (column === undefined) unresolved = true;
          return column ?? '';
        },
      );
      if (unresolved)
        return void out.push({
          ...base,
          status: 'not-run',
          skipped: 'sql rule uses {property} outside a property',
        });
    } else if (rule.type === 'text' || rule.type === 'custom') {
      return void out.push({
        ...base,
        status: 'not-executable',
        skipped: `${rule.type} rule is not executable`,
      });
    } else {
      // SQL here has no portable regex, so a rule with a pattern has no SQL form at all.
      const supported =
        metric === 'invalidValues' ? ['validValues'] : undefined;
      const why =
        unmeasurable(rule, supported, property ? 'property' : 'object') ??
        unknownColumns(obj, rule);
      sql = why
        ? undefined
        : metric === 'duplicateValues' && !property
          ? compoundDuplicateSql(
              options,
              table,
              rule.arguments!.properties as string[],
              operandFor,
            )
          : librarySql(
              options,
              rule,
              metric,
              from,
              column,
              property ? (values) => operandFor(property, values) : undefined,
            );
      if (!sql)
        return void out.push({
          ...base,
          status: 'not-run',
          skipped: `no SQL form here: ${why ?? `metric ${metric} on this field`}`,
        });
    }
    try {
      const raw = await scalar(options, sql);
      // Number(null) is 0: a NULL result must not pass `mustBe: 0`.
      let value =
        raw === null ||
        raw === undefined ||
        (typeof raw === 'string' && raw.trim() === '')
          ? Number.NaN
          : Number(raw);
      if (
        rule.type !== 'sql' &&
        metric !== 'rowCount' &&
        rule.unit === 'percent'
      ) {
        total ??= await rowCount(options, table);
        value = total ? (value / total) * 100 : 0;
      }
      if (!Number.isFinite(value)) {
        // No rows, NULL or text: the rule was not measured, which is not the same as failing it.
        out.push({
          ...base,
          status: 'not-run',
          skipped: 'query returned no number',
        });
        return;
      }
      const passed = meetsThreshold(rule, value);
      out.push({
        ...base,
        status: passed ? 'passed' : 'failed',
        value,
        passed,
      });
    } catch (error) {
      out.push({
        ...base,
        status: 'not-run',
        skipped: queryFailure(error),
      });
    }
  };
  for (const rule of obj.quality ?? []) await run(rule);
  for (const p of obj.properties ?? [])
    for (const rule of p.quality ?? []) await run(rule, p.name);
  out.push(...nestedRulesNotRun(obj));
  return out;
}

/**
 * Whether the database orders this column by instant, so MIN/MAX are the
 * oldest and newest: a native date or timestamp type. SQLite has none (its
 * DATETIME columns hold text), and text or epoch numbers sort as themselves.
 */
function sortsAsInstants(
  options: DatabaseOptions,
  column: ColumnInfo,
): boolean {
  if (options.dialect === 'sqlite') return false;
  const t = logicalTypeOf(column.dataType);
  return t === 'timestamp' || t === 'date';
}

async function measureTableSla(
  contract: DataContract,
  obj: SchemaObject,
  tableInfo: TableInfo,
  options: DatabaseOptions,
  sample: { rows: Array<Record<string, unknown>>; whole: boolean },
): Promise<SlaResult[]> {
  const table = tableInfo.name;
  const now = (options.now ?? Date.now)();
  const skew = options.maxClockSkewMs;
  const out: SlaResult[] = [];
  for (const sla of slasFor(contract, obj.name)) {
    // Unmeasurable or not ours to measure: no query (its column may not exist).
    if (sla.error || sla.skipped) {
      out.push(measureSla(sla, undefined, undefined, now));
      continue;
    }
    const prop = obj.properties?.find((p) => p.name === sla.propertyName);
    const column = columnSql(options, tableInfo, prop, sla.propertyName);
    const info = columnOf(tableInfo, prop?.physicalName ?? sla.propertyName);
    if (!info) {
      out.push(
        measureSla(
          { ...sla, error: 'the table has no such column' },
          undefined,
          undefined,
          now,
        ),
      );
      continue;
    }
    if (!sortsAsInstants(options, info)) {
      // MIN/MAX over text or numbers is not temporal order ('…T10:00+05:00'
      // sorts after '…T09:00Z' yet is earlier): read the values instead.
      if (sample.whole) {
        const values = sample.rows
          .map((r) => r[sla.propertyName])
          .filter((v) => v !== null && v !== undefined);
        const times = values
          .map((v) => toEpochMs(v))
          .filter((t): t is number => t !== undefined);
        out.push(
          measureSla(
            sla,
            times.length ? times.reduce((a, b) => Math.max(a, b)) : undefined,
            times.length ? times.reduce((a, b) => Math.min(a, b)) : undefined,
            now,
            skew,
            times.length < values.length,
          ),
        );
      } else
        out.push(
          measureSla(
            {
              ...sla,
              error: `${info.dataType} column does not sort as instants, and the sample did not read every row (sampleSize: Infinity reads them)`,
            },
            undefined,
            undefined,
            now,
          ),
        );
      continue;
    }
    try {
      const rows = await runQuery(
        options,
        `SELECT MAX(${column}) AS newest, MIN(${column}) AS oldest FROM ${tableRef(options, table)}`,
      );
      const r = lower(rows[0] ?? {});
      out.push(
        measureSla(
          sla,
          toEpochMs(r.newest),
          toEpochMs(r.oldest),
          now,
          skew,
          // MAX or MIN found a value that does not read as a time.
          [r.newest, r.oldest].some(
            (v) => v !== null && v !== undefined && toEpochMs(v) === undefined,
          ),
        ),
      );
    } catch (error) {
      out.push({
        property: sla.property,
        element: sla.element ?? '',
        limitMs: sla.limitMs,
        status: 'unknown',
        passed: false,
        error: queryFailure(error),
      });
    }
  }
  return out;
}
