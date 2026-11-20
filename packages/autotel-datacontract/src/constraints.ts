/**
 * What a single record must satisfy for one property: the one reading of a
 * property's strictness that every per-record consumer shares (the record
 * validator, the JSON Schema export). A library quality rule is a batch
 * measure; it is also a record constraint only when it tolerates no failing
 * value at all (`isZeroTolerance`). Rules with an allowance stay batch-only.
 */
import {
  isZeroTolerance,
  ruleMetric,
  type PropertyShape,
  type SchemaObject,
} from './contract.js';
import { canonical, canonicalNumeric } from './equality.js';

export interface StrictConstraints {
  /** null/absent breaks a promise: required, primary key, or a zero-tolerance nullValues/missingValues rule. */
  notNull: boolean;
  /** Each list must contain the value: native `enum`, zero-tolerance `invalidValues.validValues`. */
  allowed: unknown[][];
  /** Each must match: zero-tolerance `invalidValues.pattern` (logicalTypeOptions.pattern is checked with the type). */
  patterns: string[];
  /** Placeholder values that count as missing: zero-tolerance `missingValues.missingValues`. */
  missing: unknown[];
}

export function strictConstraints(prop: PropertyShape): StrictConstraints {
  const c: StrictConstraints = {
    notNull: Boolean(prop.required || prop.primaryKey),
    allowed: prop.enum?.length ? [prop.enum.map((e) => e.value)] : [],
    patterns: [],
    missing: [],
  };
  for (const rule of prop.quality ?? []) {
    if ((rule.type ?? 'library') !== 'library' || !isZeroTolerance(rule))
      continue;
    const metric = ruleMetric(rule);
    const args = rule.arguments ?? {};
    if (metric === 'nullValues') c.notNull = true;
    if (metric === 'missingValues') {
      c.notNull = true;
      if (Array.isArray(args.missingValues))
        c.missing.push(...args.missingValues);
    }
    if (metric === 'invalidValues') {
      if (Array.isArray(args.validValues)) c.allowed.push(args.validValues);
      if (typeof args.pattern === 'string') c.patterns.push(args.pattern);
    }
  }
  return c;
}

/** Values every allowed list accepts, or undefined when nothing restricts the value set. */
export function allowedIntersection(
  c: StrictConstraints,
): unknown[] | undefined {
  if (c.allowed.length === 0) return undefined;
  const [first, ...rest] = c.allowed;
  return first!.filter((v) =>
    rest.every((list) => list.some((x) => String(x) === String(v))),
  );
}

/**
 * Keys that must be unique across a dataset: the primary key as one tuple
 * (composite when several properties carry `primaryKey`, ordered by
 * `primaryKeyPosition`), and each `unique: true` property on its own.
 */
export function uniqueKeys(obj: SchemaObject): string[][] {
  const props = obj.properties ?? [];
  const pk = props
    .filter((p) => p.primaryKey)
    .toSorted(
      (a, b) =>
        (Number(a.primaryKeyPosition) || 0) -
        (Number(b.primaryKeyPosition) || 0),
    )
    .map((p) => p.name);
  const keys = pk.length ? [pk] : [];
  for (const p of props)
    if (p.unique && !(pk.length === 1 && pk[0] === p.name)) keys.push([p.name]);
  return keys;
}

/**
 * Rows that repeat an earlier row's key. A row with a null in the key is not
 * compared (SQL's reading of UNIQUE; a null primary key is already
 * `required-missing`).
 */
export function countDuplicates(
  rows: Array<Record<string, unknown>>,
  key: string[],
  modeFor: (
    property: string,
  ) => 'strict' | 'lenient' | 'lenient-numeric' = () => 'strict',
): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const values = key.map((k) => row[k]);
    if (values.some((v) => v === null || v === undefined)) continue;
    const id = key
      .map((k, i) =>
        (modeFor(k) === 'lenient-numeric' ? canonicalNumeric : canonical)(
          values[i],
        ),
      )
      .join('\u0000');
    if (seen.has(id)) duplicates++;
    else seen.add(id);
  }
  return duplicates;
}
