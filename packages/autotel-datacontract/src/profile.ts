import {
  findObject,
  meetsThreshold,
  ruleMetric,
  unmeasurable,
  type DataContract,
  type LogicalType,
  type PropertyShape,
  type QualityRule,
  type SchemaObject,
  type SchemaProperty,
} from './contract.js';
import { countDuplicates, uniqueKeys } from './constraints.js';
import { canonical, canonicalNumeric, dateText } from './equality.js';
import { measureSla, slasFor, toEpochMs, usableTimestamp } from './sla.js';
import {
  equalityMode,
  sameValue,
  typeOf,
  validateRecord,
  type EqualityMode,
  type ValidateOptions,
} from './validate.js';

export interface FieldProfile {
  name: string;
  /** Rows where the key exists (even as null). */
  present: number;
  nulls: number;
  /** Count of non-null values by observed type: integer, number, string, boolean, timestamp, object, array. */
  types: Record<string, number>;
  /** Distinct non-null values, at most `distinctCap`. */
  distinct: unknown[];
  /** True when more distinct values were seen than were kept. */
  distinctOverflow: boolean;
  /** Non-null values that repeat an earlier value. Only exact while `distinctOverflow` is false. */
  duplicates: number;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

export interface DataProfile {
  rows: number;
  fields: FieldProfile[];
}

export interface ProfileOptions {
  /** Distinct values kept per field. Default 20. */
  distinctCap?: number;
}

/**
 * What the data says about itself: presence, nulls, types, ranges and the
 * low-cardinality value sets, per top-level field.
 * Top-level fields only; nested objects profile as `object`. Flatten
 * to dot paths if nested payloads need per-field stats.
 */
export function profileRecords(
  rows: Iterable<Record<string, unknown>>,
  options: ProfileOptions = {},
): DataProfile {
  const cap = options.distinctCap ?? 20;
  const fields = new Map<string, FieldProfile & { seen: Set<string> }>();
  let count = 0;
  for (const row of rows) {
    count++;
    for (const [key, value] of Object.entries(row)) {
      let f = fields.get(key);
      if (!f) {
        f = {
          name: key,
          present: 0,
          nulls: 0,
          types: {},
          distinct: [],
          distinctOverflow: false,
          duplicates: 0,
          seen: new Set(),
        };
        fields.set(key, f);
      }
      f.present++;
      if (value === null || value === undefined) {
        f.nulls++;
        continue;
      }
      const t = typeOf(value);
      f.types[t] = (f.types[t] ?? 0) + 1;
      if (typeof value !== 'object' || value instanceof Date) {
        const k = value instanceof Date ? dateText(value) : String(value);
        if (f.seen.has(k)) f.duplicates++;
        else if (f.seen.size < cap) {
          f.seen.add(k);
          f.distinct.push(value instanceof Date ? k : value);
        } else f.distinctOverflow = true;
      }
      const n =
        typeof value === 'number' || typeof value === 'bigint'
          ? Number(value)
          : Number.NaN;
      // NaN would poison min/max; Infinity is a bound a number can state.
      if (!Number.isNaN(n)) {
        f.min = f.min === undefined ? n : Math.min(f.min, n);
        f.max = f.max === undefined ? n : Math.max(f.max, n);
      }
      if (typeof value === 'string') {
        f.minLength =
          f.minLength === undefined
            ? value.length
            : Math.min(f.minLength, value.length);
        f.maxLength =
          f.maxLength === undefined
            ? value.length
            : Math.max(f.maxLength, value.length);
      }
    }
  }
  return {
    rows: count,
    fields: [...fields.values()].map(({ seen: _seen, ...f }) => f),
  };
}

export interface InferOptions {
  /** Fewest rows before a low-cardinality string is proposed as a valid-value set. Default 50. */
  enumMinRows?: number;
  /** Most distinct values proposed as a valid-value set. Default 10. */
  enumMaxValues?: number;
  /**
   * Put observed values in the draft: up to three `examples` per field, and
   * an `enum` for low-cardinality strings. Default false: a draft gets
   * committed, and observed values are real data (a 10-value column can be
   * ten customers' names).
   */
  observedValues?: boolean;
}

/** Draft a schema object from a profile: the data-first starting point to enrich by hand. */
export function inferObject(
  name: string,
  profile: DataProfile,
  options: InferOptions = {},
): SchemaObject {
  const enumMinRows = options.enumMinRows ?? 50;
  const enumMax = options.enumMaxValues ?? 10;
  return {
    name,
    physicalType: 'table',
    properties: profile.fields.map((f) => {
      const types = Object.keys(f.types);
      const logicalType = dominantType(types);
      const prop: SchemaProperty = { name: f.name };
      if (logicalType) prop.logicalType = logicalType;
      if (types.length > 1)
        prop.description = `Inferred: mixed types observed (${types.toSorted().join(', ')})`;
      if (profile.rows > 0 && f.present === profile.rows && f.nulls === 0)
        prop.required = true;
      if (options.observedValues && f.distinct.length > 0)
        prop.examples = f.distinct.slice(0, 3);
      if (
        options.observedValues &&
        logicalType === 'string' &&
        !f.distinctOverflow &&
        profile.rows >= enumMinRows &&
        f.distinct.length <= enumMax
      ) {
        prop.enum = f.distinct
          .map(String)
          .toSorted()
          .map((value) => ({ value }));
        prop.description ??= 'Inferred: enum from observed values';
      }
      return prop;
    }),
  };
}

function dominantType(types: string[]): LogicalType | undefined {
  if (types.length === 0) return undefined;
  if (types.every((t) => t === 'integer')) return 'integer';
  if (types.every((t) => t === 'integer' || t === 'number')) return 'number';
  if (
    types.length === 1 &&
    ['string', 'boolean', 'timestamp', 'object', 'array'].includes(types[0]!)
  )
    return types[0] as LogicalType;
  return 'string';
}

export type FindingCode =
  | ReturnType<typeof validateRecord>[number]['code']
  | 'never-present'
  | 'undocumented'
  | 'unknown-column'
  | 'missing-column'
  | 'physical-type-drift'
  | 'nullable-drift'
  | 'freshness-breached'
  | 'retention-breached'
  | 'quality-failed'
  | 'duplicate-key';

/** One kind of variance on one field, with how often it was seen. */
export interface Finding {
  object: string;
  path: string;
  code: FindingCode;
  /** `error` breaks a promise, `warning` is a variance the contract does not cover, `info` is a gap in the contract itself. */
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Rows showing it; absent for findings about the schema rather than rows. */
  count?: number;
  /** count / rows checked. */
  rate?: number;
  expected?: string;
  /** Observed types with their counts, `string: 12, integer: 3`. */
  actual?: string;
}

export interface QualityResult {
  object: string;
  property?: string;
  rule: QualityRule;
  metric: string;
  /**
   * `not-run`: an executable rule that could not run here (sql without a
   * connection, a failed query, an unsupported metric), which leaves the
   * report incomplete. `not-executable`: a text or custom rule no tool runs.
   */
  status: 'passed' | 'failed' | 'not-run' | 'not-executable';
  /** Measured value; undefined when the rule was not run. */
  value?: number;
  passed?: boolean;
  /** Why the rule did not run. */
  skipped?: string;
  /** Why it failed, when it failed without a measured value (a verified statement that no longer runs). */
  error?: string;
  /** Computed over a sample, not the whole dataset. */
  sampled?: boolean;
}

export interface CheckReport {
  contract: { id: string; version: string };
  object: string;
  rows: number;
  findings: Finding[];
  quality: QualityResult[];
  /** Service levels measured, kept or not: the contract's track record. */
  sla: SlaResult[];
  /** Parts that could not be checked (a failed sample or row count), as stable reasons. Non-empty means incomplete. */
  unchecked: string[];
  /**
   * `failed`: a promise is broken (error finding, failed rule, breached SLA).
   * `incomplete`: nothing failed, but a rule or SLA that should have been
   * checked was not, so the result proves nothing. CI should fail on both.
   */
  status: 'passed' | 'failed' | 'incomplete';
  /** `status === 'passed'`. */
  passed: boolean;
}

export interface SlaResult {
  property: 'freshness' | 'retention' | string;
  element: string;
  /** The promise, in milliseconds (NaN when it cannot be read). */
  limitMs: number;
  /** Age of the newest (freshness) or oldest (retention) value. */
  observedMs?: number;
  /**
   * `kept` / `breached`; `unknown` when it could not be measured (no element,
   * an unreadable unit or timestamp, a failed query), which leaves the report
   * incomplete; `not-executable` for an SLA kind this tool does not measure
   * (latency, availability), shown but not counted.
   */
  status: 'kept' | 'breached' | 'unknown' | 'not-executable';
  /** `status === 'kept'`. */
  passed: boolean;
  /** Why it is unknown or not executable. */
  error?: string;
}
export interface CheckOptions extends ValidateOptions {
  /** Mark library results as computed over a sample. */
  sampled?: boolean;
  /** Clock for SLA ages, epoch ms. Default Date.now. */
  now?: () => number;
  /** Clock-skew allowance for future timestamps. Default 5 min. */
  maxClockSkewMs?: number;
}

/**
 * Check a batch of records against a schema object: every promise broken,
 * every variance the contract does not cover (unknown fields, fields never
 * present), every gap in the contract (undocumented fields), and the library
 * quality rules computed over the batch.
 */
export function checkRecords(
  contract: DataContract,
  objectName: string,
  rows: Array<Record<string, unknown>>,
  options: CheckOptions = {},
): CheckReport {
  const obj = findObject(contract, objectName);
  const { findings, rejected } = aggregateViolations(
    contract,
    obj,
    rows,
    options,
  );
  const profile = profileRecords(rows, { distinctCap: 0 });
  findings.push(
    ...contractGaps(obj, rows.length > 0 ? profile : undefined),
    ...duplicateKeyFindings(obj, rows, options.lenient === true),
  );
  const quality = evaluateLibraryRules(
    obj,
    rows,
    options.sampled === true,
    options.lenient === true,
  );
  const now = (options.now ?? Date.now)();
  const sla = slasFor(contract, obj.name).map((s) => {
    let newest: number | undefined;
    let oldest: number | undefined;
    let present = false;
    let unreadable = false;
    const retention = s.property === 'retention';
    for (const [i, row] of rows.entries()) {
      // As at runtime: a rejected row is no evidence of freshness. Retention
      // is about what is kept, and a rejected row is kept all the same.
      if (rejected.has(i) && !retention) continue;
      const raw = row[s.propertyName];
      if (raw === null || raw === undefined) continue;
      present = true;
      const read = toEpochMs(raw);
      if (read === undefined) unreadable = true;
      // A future value is no evidence of freshness; for retention it is simply not old.
      const t = retention
        ? read
        : usableTimestamp(read, now, options.maxClockSkewMs);
      if (t === undefined) continue;
      if (newest === undefined || t > newest) newest = t;
      if (oldest === undefined || t < oldest) oldest = t;
    }
    // Values there but none usable (unparseable, or all in the future) is not "no data".
    return measureSla(
      s,
      newest,
      oldest,
      now,
      options.maxClockSkewMs,
      unreadable || (present && newest === undefined),
    );
  });
  return report(contract, obj.name, rows.length, findings, quality, sla);
}

export function report(
  contract: DataContract,
  object: string,
  rows: number,
  findings: Finding[],
  quality: QualityResult[],
  sla: SlaResult[] = [],
  unchecked: string[] = [],
): CheckReport {
  const status =
    findings.some((f) => f.severity === 'error') ||
    quality.some((q) => q.status === 'failed') ||
    sla.some((s) => s.status === 'breached')
      ? 'failed'
      : unchecked.length > 0 ||
          quality.some((q) => q.status === 'not-run') ||
          sla.some((s) => s.status === 'unknown')
        ? 'incomplete'
        : 'passed';
  return {
    contract: { id: contract.id, version: contract.version },
    object,
    rows,
    findings,
    quality,
    sla,
    unchecked,
    status,
    passed: status === 'passed',
  };
}

function aggregateViolations(
  contract: DataContract,
  obj: SchemaObject,
  rows: Array<Record<string, unknown>>,
  options: ValidateOptions,
): { findings: Finding[]; rejected: Set<number> } {
  const byKey = new Map<string, Finding & { types: Map<string, number> }>();
  const rejected = new Set<number>();
  for (const [i, row] of rows.entries()) {
    for (const v of validateRecord(contract, obj, row, options)) {
      if (v.severity === 'error') rejected.add(i);
      // Contract paths, not payload paths: a report gets shared, and the sender chooses its keys.
      const key = `${v.schemaPath}\0${v.code}`;
      let f = byKey.get(key);
      if (!f) {
        f = {
          object: obj.name,
          path: v.schemaPath,
          code: v.code,
          severity: v.severity,
          message: v.message,
          expected: v.expected,
          count: 0,
          types: new Map(),
        };
        byKey.set(key, f);
      }
      f.count!++;
      if (v.actual) f.types.set(v.actual, (f.types.get(v.actual) ?? 0) + 1);
    }
  }
  const findings = [...byKey.values()].map(({ types, ...f }) => ({
    ...f,
    rate: f.count! / rows.length,
    actual:
      types.size > 0
        ? [...types].map(([t, n]) => `${t}: ${n}`).join(', ')
        : undefined,
  }));
  return { findings, rejected };
}

/** A primary key or unique column repeated across the batch: a promise no single record can break. */
export function duplicateKeyFindings(
  obj: SchemaObject,
  rows: Array<Record<string, unknown>>,
  lenient = false,
): Finding[] {
  return uniqueKeys(obj).flatMap((key) => {
    const count = countDuplicates(rows, key, modesOf(obj, lenient));
    return count === 0
      ? []
      : [duplicateKeyFinding(obj.name, key, count, rows.length)];
  });
}

export function duplicateKeyFinding(
  object: string,
  key: string[],
  count: number,
  rows: number,
): Finding {
  return {
    object,
    path: key.join(','),
    code: 'duplicate-key',
    severity: 'error',
    message: `${count} row(s) repeat a ${key.length > 1 ? 'composite key' : 'key'} that must be unique`,
    count,
    rate: rows ? count / rows : undefined,
  };
}

/** Declared fields the data never carries, and declared fields nobody described. */
export function contractGaps(
  obj: SchemaObject,
  profile?: DataProfile,
): Finding[] {
  const out: Finding[] = [];
  for (const prop of obj.properties ?? []) {
    if (
      profile &&
      !profile.fields.some((f) => f.name === prop.name && f.present > f.nulls)
    )
      out.push({
        object: obj.name,
        path: prop.name,
        code: 'never-present',
        severity: prop.required || prop.primaryKey ? 'error' : 'warning',
        message: 'declared but never carries a value in the data checked',
      });
    if (
      !prop.description &&
      !prop.businessName &&
      !prop.authoritativeDefinitions?.length
    )
      out.push({
        object: obj.name,
        path: prop.name,
        code: 'undocumented',
        severity: 'info',
        message:
          'no description, businessName or authoritative definition: its meaning is a guess',
      });
  }
  return out;
}

function evaluateLibraryRules(
  obj: SchemaObject,
  rows: Array<Record<string, unknown>>,
  sampled: boolean,
  lenient: boolean,
): QualityResult[] {
  const out: QualityResult[] = [];
  const modeFor = modesOf(obj, lenient);
  const measure = (rule: QualityRule, property: string | undefined) => {
    const metric = ruleMetric(rule) ?? rule.type ?? 'unknown';
    const base = { object: obj.name, property, rule, metric };
    if (rule.type === 'sql')
      return void out.push({
        ...base,
        status: 'not-run',
        skipped: 'sql rule needs a database connection (auditDatabase)',
      });
    if (rule.type === 'text' || rule.type === 'custom')
      return void out.push({
        ...base,
        status: 'not-executable',
        skipped: `${rule.type} rule is not executable`,
      });
    const why =
      unmeasurable(rule, undefined, property ? 'property' : 'object') ??
      unknownColumns(obj, rule);
    if (why) return void out.push({ ...base, status: 'not-run', skipped: why });
    const count = libraryCount(metric, rule, property, rows, modeFor);
    if (count === undefined)
      return void out.push({
        ...base,
        status: 'not-run',
        skipped: `metric ${metric} is not supported`,
      });
    const value =
      metric !== 'rowCount' && rule.unit === 'percent'
        ? rows.length
          ? (count / rows.length) * 100
          : 0
        : count;
    const passed = meetsThreshold(rule, value);
    out.push({
      ...base,
      status: passed ? 'passed' : 'failed',
      value,
      passed,
      sampled,
    });
  };
  for (const rule of obj.quality ?? []) measure(rule, undefined);
  for (const prop of obj.properties ?? [])
    for (const rule of prop.quality ?? []) measure(rule, prop.name);
  out.push(...nestedRulesNotRun(obj));
  return out;
}

/**
 * Rules declared below the top level (inside an object, array items, map
 * values) are not measured over a batch or table. Naming them keeps the
 * report incomplete instead of silently passing them.
 */
export function nestedRulesNotRun(obj: SchemaObject): QualityResult[] {
  const out: QualityResult[] = [];
  const walk = (p: PropertyShape, path: string, nested: boolean) => {
    if (nested)
      for (const rule of p.quality ?? [])
        out.push({
          object: obj.name,
          property: path,
          rule,
          metric: ruleMetric(rule) ?? rule.type ?? 'unknown',
          status: 'not-run',
          skipped: 'rules on nested fields are not measured over a batch',
        });
    for (const c of p.properties ?? []) walk(c, `${path}.${c.name}`, true);
    if (p.items) walk(p.items, `${path}[]`, true);
    if (p.map) walk(p.map.value, `${path}{}`, true);
  };
  for (const p of obj.properties ?? []) walk(p, p.name, false);
  return out;
}

/** A compound rule naming a column the schema object does not have cannot be measured. */
export function unknownColumns(
  obj: SchemaObject,
  rule: QualityRule,
): string | undefined {
  const names = rule.arguments?.properties;
  if (!Array.isArray(names)) return undefined;
  const missing = names.filter(
    (n) => !obj.properties?.some((p) => p.name === n),
  );
  return missing.length
    ? `arguments.properties names no property: ${missing.join(', ')}`
    : undefined;
}

/** Each property's equality mode, as the record validator reads it. */
function modesOf(
  obj: SchemaObject,
  lenient: boolean,
): (property: string) => EqualityMode {
  return (name) => {
    const prop = obj.properties?.find((p) => p.name === name);
    return prop
      ? equalityMode(prop, { lenient })
      : lenient
        ? 'lenient'
        : 'strict';
  };
}

function libraryCount(
  metric: string,
  rule: QualityRule,
  property: string | undefined,
  rows: Array<Record<string, unknown>>,
  modeFor: (property: string) => EqualityMode,
): number | undefined {
  if (metric === 'rowCount') return rows.length;
  // Schema-level duplicateValues: the named columns, together, as a tuple.
  if (metric === 'duplicateValues' && !property)
    return countDuplicates(
      rows,
      rule.arguments!.properties as string[],
      modeFor,
    );
  if (!property) return undefined;
  // The record validator's equality, not String(): '1.00' is 1 only for a numeric property read leniently.
  const mode = modeFor(property);
  const values = rows.map((r) => r[property]);
  const isNull = (v: unknown) => v === null || v === undefined;
  switch (metric) {
    case 'nullValues': {
      return values.filter((v) => isNull(v)).length;
    }
    case 'missingValues': {
      const missing =
        (rule.arguments?.missingValues as unknown[] | undefined) ?? [];
      return values.filter(
        (v) => isNull(v) || missing.some((m) => sameValue(m, v, mode)),
      ).length;
    }
    case 'invalidValues': {
      const valid = rule.arguments?.validValues as unknown[] | undefined;
      const pattern =
        typeof rule.arguments?.pattern === 'string'
          ? new RegExp(rule.arguments.pattern, 'u')
          : undefined;
      return values.filter(
        (v) =>
          !isNull(v) &&
          ((valid !== undefined && !valid.some((x) => sameValue(x, v, mode))) ||
            (pattern !== undefined && !pattern.test(String(v)))),
      ).length;
    }
    case 'duplicateValues': {
      // The same equality as composite keys and uniqueItems: 1 and '1' are different values.
      const key = mode === 'lenient-numeric' ? canonicalNumeric : canonical;
      const present = values.filter((v) => !isNull(v)).map((v) => key(v));
      return present.length - new Set(present).size;
    }
    default: {
      return undefined;
    }
  }
}
