/**
 * Open Data Contract Standard (ODCS) v3.x model: the parts this package reads.
 * Unknown keys are kept on the object (an ODCS file round-trips), the types
 * just do not name them.
 */
import { parse as parseYaml } from 'yaml';

export const LOGICAL_TYPES = [
  'string',
  'date',
  'timestamp',
  'time',
  'number',
  'integer',
  'object',
  'array',
  'boolean',
  'map',
  'vector',
] as const;
export type LogicalType = (typeof LOGICAL_TYPES)[number];

export const THRESHOLD_KEYS = [
  'mustBe',
  'mustNotBe',
  'mustBeGreaterThan',
  'mustBeGreaterOrEqualTo',
  'mustBeLessThan',
  'mustBeLessOrEqualTo',
  'mustBeBetween',
  'mustNotBeBetween',
] as const;

export interface QualityRule {
  type?: 'library' | 'sql' | 'text' | 'custom' | string;
  name?: string;
  description?: string;
  dimension?: string;
  severity?: string;
  /** Library metric (ODCS 3.1+): nullValues, missingValues, invalidValues, duplicateValues, rowCount. */
  metric?: string;
  /** ODCS 3.0 spelling of `metric` (nullCheck, duplicateCount, validValues, rowCount). */
  rule?: string;
  arguments?: Record<string, unknown>;
  unit?: 'rows' | 'percent' | string;
  query?: string;
  mustBe?: number;
  mustNotBe?: number;
  mustBeGreaterThan?: number;
  mustBeGreaterOrEqualTo?: number;
  mustBeLessThan?: number;
  mustBeLessOrEqualTo?: number;
  mustBeBetween?: [number, number];
  mustNotBeBetween?: [number, number];
  [key: string]: unknown;
}

export interface LogicalTypeOptions {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
  multipleOf?: number;
  /** Fixed length of a `vector` (ODCS 3.2). */
  dimensions?: number;
  [key: string]: unknown;
}

/** One allowed value of a property's enumeration (ODCS 3.2, RFC 0033). */
export interface EnumValue {
  value: string | number | boolean;
  label?: string;
  description?: string;
  [key: string]: unknown;
}

export interface AuthoritativeDefinition {
  url: string;
  type: string;
  description?: string;
}

/** A field's shape without its name: what an array's `items` carries. */
export interface PropertyShape {
  logicalType?: LogicalType;
  physicalType?: string;
  physicalName?: string;
  businessName?: string;
  description?: string;
  required?: boolean;
  primaryKey?: boolean;
  /** Position in a composite primary key, from 1. */
  primaryKeyPosition?: number;
  unique?: boolean;
  classification?: string;
  tags?: string[];
  examples?: unknown[];
  logicalTypeOptions?: LogicalTypeOptions;
  quality?: QualityRule[];
  /** Nested fields of an `object` property. */
  properties?: SchemaProperty[];
  /** Allowed values (ODCS 3.2). */
  enum?: EnumValue[];
  /** Key and value shape of a `map` property (ODCS 3.2). */
  map?: { key: PropertyShape; value: PropertyShape };
  /** ODCS 3.2: the field is being phased out. */
  deprecated?: boolean;
  /** Element shape of an `array` property. */
  items?: PropertyShape & { name?: string };
  authoritativeDefinitions?: AuthoritativeDefinition[];
  [key: string]: unknown;
}

export interface SchemaProperty extends PropertyShape {
  name: string;
}

export interface SchemaObject {
  name: string;
  physicalName?: string;
  physicalType?: string;
  businessName?: string;
  description?: string;
  tags?: string[];
  quality?: QualityRule[];
  properties?: SchemaProperty[];
  [key: string]: unknown;
}

export interface SlaProperty {
  property: string;
  value: number | string;
  unit?: string;
  /** `object.property` the SLA is measured on. */
  element?: string;
  description?: string;
  [key: string]: unknown;
}

export interface DataContract {
  apiVersion: string;
  kind: 'DataContract';
  id: string;
  name?: string;
  version: string;
  status: string;
  domain?: string;
  dataProduct?: string;
  tenant?: string;
  description?: {
    purpose?: string;
    usage?: string;
    limitations?: string;
    [key: string]: unknown;
  };
  schema?: SchemaObject[];
  slaProperties?: SlaProperty[];
  servers?: Array<Record<string, unknown>>;
  team?: Record<string, unknown> | Array<Record<string, unknown>>;
  support?: Array<Record<string, unknown>>;
  roles?: Array<Record<string, unknown>>;
  context?: Record<string, unknown>;
  tags?: string[];
  customProperties?: Array<{ property: string; value: unknown }>;
  /** Element an SLA without its own `element` is measured on (`object.property`). */
  slaDefaultElement?: string;
  [key: string]: unknown;
}

export interface LintIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

/** logicalTypeOptions ODCS 3.2 defines per logicalType (from its JSON Schema). */
const OPTIONS_BY_TYPE: Record<string, readonly string[]> = {
  string: ['format', 'maxLength', 'minLength', 'pattern'],
  date: [
    'exclusiveMaximum',
    'exclusiveMinimum',
    'format',
    'maximum',
    'minimum',
  ],
  timestamp: [
    'defaultTimezone',
    'exclusiveMaximum',
    'exclusiveMinimum',
    'format',
    'maximum',
    'minimum',
    'timezone',
  ],
  time: [
    'defaultTimezone',
    'exclusiveMaximum',
    'exclusiveMinimum',
    'format',
    'maximum',
    'minimum',
    'timezone',
  ],
  integer: [
    'exclusiveMaximum',
    'exclusiveMinimum',
    'format',
    'maximum',
    'minimum',
    'multipleOf',
  ],
  number: [
    'exclusiveMaximum',
    'exclusiveMinimum',
    'format',
    'maximum',
    'minimum',
    'multipleOf',
  ],
  object: ['maxProperties', 'minProperties', 'required'],
  array: ['maxItems', 'minItems', 'uniqueItems'],
  vector: [
    'dimensions',
    'distanceMetric',
    'elementType',
    'embeddingModel',
    'embeddingModelVersion',
    'normalized',
  ],
};

export class DataContractError extends Error {
  constructor(
    message: string,
    readonly issues: LintIssue[],
  ) {
    super(message);
    this.name = 'DataContractError';
  }
}

/**
 * Parse an ODCS document (YAML or JSON text, or an already-parsed object) and
 * reject it when lint finds an error. Warnings are returned, not thrown.
 */
export function parseContract(input: string | unknown): {
  contract: DataContract;
  warnings: LintIssue[];
} {
  const value = typeof input === 'string' ? parseYaml(input) : input;
  const issues = lintContract(value);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    throw new DataContractError(
      `Invalid data contract:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
      issues,
    );
  }
  return {
    contract: value as DataContract,
    warnings: issues.filter((i) => i.severity === 'warning'),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Structural checks a tool needs before acting on a contract, a subset
 * of the ODCS JSON Schema.
 */
export function lintContract(
  value: unknown,
  /** The file it was read from: checked against the `<id>_v<major>.odcs.yaml` convention when it follows it. */
  fileName?: string,
): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, code: string, message: string) =>
    issues.push({ severity: 'error', code, path, message });
  const warn = (path: string, code: string, message: string) =>
    issues.push({ severity: 'warning', code, path, message });

  if (!isRecord(value)) {
    err('$', 'not-an-object', 'contract must be a mapping');
    return issues;
  }
  const named = /^(.+)_v(\d+)\.odcs\.ya?ml$/.exec(
    fileName?.split(/[\\/]/).pop() ?? '',
  );
  if (named) {
    if (typeof value.id === 'string' && named[1] !== value.id)
      warn(
        'id',
        'file-name-id',
        `file is named for ${named[1]}, the contract's id is ${value.id}`,
      );
    const major =
      typeof value.version === 'string'
        ? parseSemver(value.version)?.[0]
        : undefined;
    if (major !== undefined && Number(named[2]) !== major)
      warn(
        'version',
        'file-name-version',
        `file is named for major version ${named[2]}, the contract is ${String(value.version)}`,
      );
  }
  const statements = isRecord(value.context)
    ? value.context.verifiedStatements
    : undefined;
  if (statements !== undefined && !Array.isArray(statements))
    err(
      'context.verifiedStatements',
      'bad-shape',
      'verifiedStatements must be a list',
    );
  for (const [i, st] of (Array.isArray(statements) ? statements : []).entries())
    if (
      !isRecord(st) ||
      typeof st.question !== 'string' ||
      typeof st.answer !== 'string'
    )
      warn(
        `context.verifiedStatements[${i}]`,
        'unmeasurable-statement',
        'a verified statement needs a question and an answer query; this one cannot be checked',
      );
  for (const key of ['apiVersion', 'id', 'version', 'status'] as const) {
    if (typeof value[key] !== 'string' || value[key] === '')
      err(key, 'missing-field', `${key} is required`);
  }
  if (value.kind !== 'DataContract')
    err('kind', 'wrong-kind', 'kind must be "DataContract"');
  if (
    typeof value.apiVersion === 'string' &&
    !value.apiVersion.startsWith('v3.')
  )
    warn(
      'apiVersion',
      'unsupported-version',
      `read as ODCS v3, got ${value.apiVersion}`,
    );
  if (typeof value.version === 'string' && !parseSemver(value.version))
    warn('version', 'not-semver', 'version should be MAJOR.MINOR.PATCH');

  const objects = new Set<string>();
  if (value.schema !== undefined && !Array.isArray(value.schema)) {
    err('schema', 'not-a-list', 'schema must be a list of objects');
  } else {
    for (const [i, obj] of ((value.schema as unknown[]) ?? []).entries()) {
      const at = `schema[${i}]`;
      if (!isRecord(obj) || typeof obj.name !== 'string') {
        err(at, 'missing-field', 'schema object needs a name');
        continue;
      }
      if (objects.has(obj.name))
        err(
          at,
          'duplicate-name',
          `schema object ${obj.name} is declared twice`,
        );
      objects.add(obj.name);
      lintQuality(obj.quality, `${obj.name}.quality`, err, warn, 'object');
      lintProperties(obj.properties, obj.name, err, warn);
    }
  }

  // Fields ODCS requires on entries this package keys on (servers and roles in a diff).
  for (const [list, keys] of [
    ['servers', ['server', 'type']],
    ['roles', ['role']],
  ] as const) {
    const entries = value[list];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      err(list, 'not-a-list', `${list} must be a list`);
      continue;
    }
    for (const [i, e] of entries.entries())
      for (const k of keys)
        if (!isRecord(e) || typeof e[k] !== 'string' || e[k] === '')
          err(`${list}[${i}].${k}`, 'missing-field', `${k} is required`);
  }

  for (const [i, sla] of ((value.slaProperties as unknown[]) ?? []).entries()) {
    if (!isRecord(sla) || typeof sla.property !== 'string') {
      err(`slaProperties[${i}]`, 'missing-field', 'SLA needs a property');
      continue;
    }
    const measured =
      sla.property === 'freshness' || sla.property === 'retention';
    // ODCS: an SLA without an element is measured on slaDefaultElement.
    const element =
      typeof sla.element === 'string' ? sla.element : value.slaDefaultElement;
    if (
      measured &&
      typeof element === 'string' &&
      (sla.unit === undefined ||
        durationMs(sla.value as number | string, String(sla.unit)) ===
          undefined)
    )
      warn(
        `slaProperties[${i}]`,
        'unsupported-sla-unit',
        `cannot read ${JSON.stringify(sla.value)} ${String(sla.unit ?? '(no unit)')} as a duration`,
      );
    if (measured && typeof element !== 'string')
      warn(
        `slaProperties[${i}]`,
        'sla-no-element',
        `${sla.property} without an element or slaDefaultElement cannot be measured`,
      );
    if (typeof element === 'string') {
      const [objName, propName] = element.split('.');
      const obj = ((value.schema as SchemaObject[]) ?? []).find(
        (o) => o.name === objName,
      );
      if (
        !obj ||
        !propName ||
        !obj.properties?.some((p) => p.name === propName)
      )
        warn(
          `slaProperties[${i}].element`,
          'unknown-element',
          `${element} names no property`,
        );
    }
  }
  return issues;
}

function lintProperties(
  props: unknown,
  at: string,
  err: (p: string, c: string, m: string) => void,
  warn: (p: string, c: string, m: string) => void,
): void {
  if (props === undefined) return;
  if (!Array.isArray(props)) {
    err(`${at}.properties`, 'not-a-list', 'properties must be a list');
    return;
  }
  const seen = new Set<string>();
  for (const prop of props) {
    if (!isRecord(prop) || typeof prop.name !== 'string') {
      err(at, 'missing-field', 'property needs a name');
      continue;
    }
    const path = `${at}.${prop.name}`;
    if (seen.has(prop.name))
      err(path, 'duplicate-name', 'property is declared twice');
    seen.add(prop.name);
    if (prop.logicalType === undefined)
      warn(
        path,
        'no-logical-type',
        'no logicalType: values are not type-checked',
      );
    else if (!(LOGICAL_TYPES as readonly unknown[]).includes(prop.logicalType))
      err(
        path,
        'unknown-logical-type',
        `logicalType ${String(prop.logicalType)} is not ODCS`,
      );
    if (
      typeof prop.logicalTypeOptions === 'object' &&
      typeof (prop.logicalTypeOptions as LogicalTypeOptions).pattern ===
        'string'
    ) {
      try {
        new RegExp(
          (prop.logicalTypeOptions as LogicalTypeOptions).pattern!,
          'u',
        );
      } catch {
        err(
          path,
          'bad-pattern',
          'logicalTypeOptions.pattern is not a valid regular expression',
        );
      }
    }
    if (
      prop.enum !== undefined &&
      (!Array.isArray(prop.enum) ||
        prop.enum.length === 0 ||
        prop.enum.some((e) => !isRecord(e) || !('value' in e)))
    )
      err(
        path,
        'bad-enum',
        'enum must be a non-empty list of { value } entries',
      );
    if (
      prop.logicalType === 'map' &&
      !(
        isRecord(prop.map) &&
        isRecord(prop.map.key) &&
        isRecord(prop.map.value)
      )
    )
      err(path, 'missing-map', 'a map property needs map.key and map.value');
    // ODCS 3.2 requires a vector's dimensions, as a positive integer.
    if (prop.logicalType === 'vector') {
      const d = isRecord(prop.logicalTypeOptions)
        ? prop.logicalTypeOptions.dimensions
        : undefined;
      if (!(typeof d === 'number' && Number.isInteger(d) && d >= 1))
        err(
          `${path}.logicalTypeOptions.dimensions`,
          'missing-dimensions',
          'a vector needs dimensions, a positive integer',
        );
    }
    const known = OPTIONS_BY_TYPE[String(prop.logicalType)];
    if (known && isRecord(prop.logicalTypeOptions))
      for (const key of Object.keys(prop.logicalTypeOptions))
        if (!known.includes(key))
          warn(
            `${path}.logicalTypeOptions.${key}`,
            'unknown-option',
            `ODCS defines no ${key} for ${String(prop.logicalType)}: it is not checked`,
          );
    lintQuality(prop.quality, `${path}.quality`, err, warn, 'property');
    lintProperties(prop.properties, path, err, warn);
  }
}

function lintQuality(
  rules: unknown,
  at: string,
  err: (p: string, c: string, m: string) => void,
  warn: (p: string, c: string, m: string) => void,
  level: 'object' | 'property',
): void {
  if (rules === undefined) return;
  if (!Array.isArray(rules))
    return err(at, 'not-a-list', 'quality must be a list');
  for (const [i, rule] of rules.entries()) {
    if (!isRecord(rule)) continue;
    const type = rule.type ?? 'library';
    if (type === 'text' || type === 'custom') continue;
    if (type === 'sql' && typeof rule.query !== 'string')
      err(`${at}[${i}]`, 'missing-query', 'sql rule needs a query');
    if (type === 'library') {
      // Valid ODCS this tool cannot measure still loads: verification reports it not-run.
      const why = unmeasurable(rule as QualityRule, undefined, level);
      if (why && why !== 'rule has no threshold')
        warn(`${at}[${i}]`, 'unmeasurable-rule', why);
    }
    if (!THRESHOLD_KEYS.some((k) => k in rule))
      err(`${at}[${i}]`, 'missing-threshold', 'rule needs a mustBe* threshold');
  }
}

export function findObject(contract: DataContract, name: string): SchemaObject {
  const obj = contract.schema?.find(
    (o) => o.name === name || o.physicalName === name,
  );
  if (!obj)
    throw new Error(
      `data contract ${contract.id} has no schema object ${name}`,
    );
  return obj;
}

export function parseSemver(
  version: string,
): [number, number, number] | undefined {
  // The whole string must be SemVer 2.0.0: `2.0.0junk` is not a major bump.
  const m =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i.exec(
      version,
    );
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** True when the value passes every threshold the rule carries. */
export function meetsThreshold(rule: QualityRule, value: number): boolean {
  if (rule.mustBe !== undefined && value !== rule.mustBe) return false;
  if (rule.mustNotBe !== undefined && value === rule.mustNotBe) return false;
  if (rule.mustBeGreaterThan !== undefined && !(value > rule.mustBeGreaterThan))
    return false;
  if (
    rule.mustBeGreaterOrEqualTo !== undefined &&
    !(value >= rule.mustBeGreaterOrEqualTo)
  )
    return false;
  if (rule.mustBeLessThan !== undefined && !(value < rule.mustBeLessThan))
    return false;
  if (
    rule.mustBeLessOrEqualTo !== undefined &&
    !(value <= rule.mustBeLessOrEqualTo)
  )
    return false;
  if (
    rule.mustBeBetween &&
    !(value >= rule.mustBeBetween[0] && value <= rule.mustBeBetween[1])
  )
    return false;
  if (
    rule.mustNotBeBetween &&
    value >= rule.mustNotBeBetween[0] &&
    value <= rule.mustNotBeBetween[1]
  )
    return false;
  return true;
}

/**
 * True when the rule's threshold allows no failing value at all (`mustBe: 0`,
 * `mustBeLessThan: 1`, `mustBeLessOrEqualTo: 0` in rows or percent). Only such
 * a rule can be checked one record at a time; any allowance is a property of
 * the batch, judged by the batch.
 */
export function isZeroTolerance(rule: QualityRule): boolean {
  const smallest = rule.unit === 'percent' ? Number.MIN_VALUE : 1;
  return meetsThreshold(rule, 0) && !meetsThreshold(rule, smallest);
}

/** The arguments each library metric takes. */
export const LIBRARY_METRIC_ARGUMENTS: Record<string, readonly string[]> = {
  rowCount: [],
  nullValues: [],
  missingValues: ['missingValues'],
  invalidValues: ['validValues', 'pattern'],
  // At schema level: `properties` names the columns that together must not repeat.
  duplicateValues: ['properties'],
};

/**
 * Why a measure cannot evaluate the whole rule, or undefined when it can.
 * A measure that meets an argument it does not evaluate must decline the
 * rule rather than evaluate part of it and report a pass.
 */
export function unmeasurable(
  rule: QualityRule,
  supported: readonly string[] = LIBRARY_METRIC_ARGUMENTS[
    ruleMetric(rule) ?? ''
  ] ?? [],
  level: 'object' | 'property' = 'property',
): string | undefined {
  const metric = ruleMetric(rule) ?? '';
  if (!(metric in LIBRARY_METRIC_ARGUMENTS))
    return `metric ${metric || '(none)'} is not supported`;
  // ODCS requires one; without it any measurement would pass.
  if (!THRESHOLD_KEYS.some((k) => rule[k] !== undefined))
    return 'rule has no threshold';
  const args = Object.keys(rule.arguments ?? {}).filter(
    (k) => rule.arguments![k] !== undefined,
  );
  const extra = args.filter((k) => !supported.includes(k));
  if (extra.length)
    return `metric ${metric} with ${extra.join(', ')} is not measured here`;
  if (
    metric === 'invalidValues' &&
    !args.some((k) => k === 'validValues' || k === 'pattern')
  )
    return 'invalidValues needs validValues or pattern';
  const columns = rule.arguments?.properties;
  if (metric === 'duplicateValues') {
    if (
      level === 'object' &&
      !(
        Array.isArray(columns) &&
        columns.length > 0 &&
        columns.every((c) => typeof c === 'string')
      )
    )
      return 'duplicateValues on a schema object needs arguments.properties';
    if (level === 'property' && columns !== undefined)
      return 'arguments.properties belongs on a schema-level duplicateValues';
  }
  if (
    level === 'object' &&
    (metric === 'nullValues' ||
      metric === 'missingValues' ||
      metric === 'invalidValues')
  )
    return `${metric} measures a property, not a schema object`;
  return undefined;
}

/** Library metric name, folding the ODCS 3.0 `rule` spellings into 3.1's `metric`. */
export function ruleMetric(rule: QualityRule): string | undefined {
  const name = rule.metric ?? rule.rule;
  return (
    {
      nullCheck: 'nullValues',
      duplicateCount: 'duplicateValues',
      validValues: 'invalidValues',
    }[name ?? ''] ?? name
  );
}

const UNIT_MS: Array<[RegExp, number]> = [
  [/^(ms|millis)/, 1],
  [/^mo/, 2_592_000_000],
  [/^(min|m$)/, 60_000],
  [/^s/, 1000],
  [/^h/, 3_600_000],
  [/^d/, 86_400_000],
  [/^w/, 604_800_000],
  [/^y/, 31_536_000_000],
];

/** SLA value + unit in milliseconds: `24 hours`, `5 year`, `d`, `min`. Months are 30 days. */
export function durationMs(
  value: number | string,
  unit = 'd',
): number | undefined {
  const n = Number(value);
  const u = unit.toLowerCase();
  const factor = UNIT_MS.find(([re]) => re.test(u))?.[1];
  return Number.isFinite(n) && factor !== undefined ? n * factor : undefined;
}
