import { strictConstraints } from './constraints.js';
import { canonical, dateText } from './equality.js';
import { aligned, compareDecimal, decimalOf, type Decimal } from './decimal.js';
export { compareDecimal, decimalOf, type Decimal } from './decimal.js';
import {
  findObject,
  type DataContract,
  type LogicalType,
  type SchemaObject,
  type PropertyShape,
  type SchemaProperty,
} from './contract.js';

export type ViolationCode =
  | 'not-an-object'
  | 'required-missing'
  | 'type-mismatch'
  | 'below-minimum'
  | 'above-maximum'
  | 'too-short'
  | 'too-long'
  | 'pattern-mismatch'
  | 'invalid-value'
  | 'not-multiple'
  | 'wrong-dimensions'
  | 'out-of-range'
  | 'duplicate-item'
  | 'not-normalized'
  | 'unknown-field';

export interface Violation {
  /** Dot path of the field, `items[].sku` for array elements, `tags{}` for map values. */
  path: string;
  /**
   * The path in contract terms: equal to `path` for declared fields, with the
   * key replaced by `(undeclared)` for an unknown field. Bounded by the
   * contract, so it is the one safe to put on telemetry.
   */
  schemaPath: string;
  code: ViolationCode;
  /** `error` breaks a promise; `warning` is something the contract does not say (an unknown field). */
  severity: 'error' | 'warning';
  message: string;
  expected?: string;
  /** JS type of the value seen. Never the value itself: contracts carry PII. */
  actual?: string;
}

export interface ValidateOptions {
  /**
   * Accept what database drivers hand back for a declared type: numeric
   * strings for integer/number (pg int8, numeric), 0/1 for boolean (MySQL,
   * SQLite), Date or ISO text for dates. Default false: a JSON message with
   * `"42"` where an integer is promised is a real variance.
   */
  lenient?: boolean;
  /** Report fields the contract does not declare. Default true. */
  unknownFields?: boolean;
}

/** Validate one record against a schema object of the contract. */
export function validateRecord(
  contract: DataContract,
  object: string | SchemaObject,
  record: unknown,
  options: ValidateOptions = {},
): Violation[] {
  const obj =
    typeof object === 'string' ? findObject(contract, object) : object;
  const out: Violation[] = [];
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    out.push({
      path: '$',
      schemaPath: '$',
      code: 'not-an-object',
      severity: 'error',
      message: `${obj.name} record must be an object`,
      actual: typeOf(record),
    });
    return out;
  }
  checkFields(
    obj.properties ?? [],
    record as Record<string, unknown>,
    '',
    out,
    options,
  );
  return out;
}

function checkFields(
  props: SchemaProperty[],
  record: Record<string, unknown>,
  prefix: string,
  out: Violation[],
  options: ValidateOptions,
): void {
  for (const prop of props) {
    checkValue(prop, record[prop.name], `${prefix}${prop.name}`, out, options);
  }
  if (options.unknownFields !== false) {
    const known = new Set(props.map((p) => p.name));
    for (const key of Object.keys(record)) {
      if (!known.has(key))
        out.push({
          path: `${prefix}${key}`,
          schemaPath: `${prefix}(undeclared)`,
          code: 'unknown-field',
          severity: 'warning',
          message: 'field is not in the contract',
          actual: typeOf(record[key]),
        });
    }
  }
}

function checkValue(
  prop: PropertyShape,
  value: unknown,
  path: string,
  out: Violation[],
  options: ValidateOptions,
): void {
  const err = (code: ViolationCode, message: string, expected?: string) =>
    out.push({
      path,
      schemaPath: path,
      code,
      severity: 'error',
      message,
      expected,
      actual: typeOf(value),
    });

  const strict = strictConstraints(prop);
  if (value === undefined || value === null) {
    if (strict.notNull) err('required-missing', 'required field is missing');
    return;
  }
  const mode = equalityMode(prop, options);
  if (strict.missing.some((m) => sameValue(m, value, mode))) {
    err('required-missing', 'value is a missing-value placeholder');
    return;
  }
  if (
    prop.logicalType &&
    !matchesType(prop.logicalType, value, options.lenient === true)
  ) {
    err('type-mismatch', `expected ${prop.logicalType}`, prop.logicalType);
    return;
  }
  checkOptions(prop, value, path, err, out, options);
  // Native enum and zero-tolerance library rules; allowances stay batch-only (constraints.ts).
  const notAllowed = strict.allowed.find(
    (list) => !list.some((v) => sameValue(v, value, mode)),
  );
  if (notAllowed)
    err(
      'invalid-value',
      'value is not one of the allowed values',
      notAllowed.map(String).join(' | '),
    );
  for (const pattern of strict.patterns)
    if (!patternOf(pattern).test(String(value)))
      err('pattern-mismatch', `does not match ${pattern}`, pattern);
  if (
    prop.logicalType === 'map' &&
    prop.map &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    // Keys arrive as strings: read each as its declared type (the same
    // reading toJsonSchema states in propertyNames), then check it strictly.
    const key = prop.map.key;
    const keyStrict = strictConstraints(key);
    // The key's own text is what enums and patterns read (as the exported
    // propertyNames does: '042' is not the enum value 42); its type and
    // bounds read the value the text stands for.
    const typed: PropertyShape = {
      ...key,
      enum: undefined,
      quality: undefined,
    };
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const at = `${path}{key}`;
      const keyErr = (
        code: ViolationCode,
        message: string,
        expected?: string,
      ) =>
        out.push({
          path: at,
          schemaPath: at,
          code,
          severity: 'error',
          message,
          expected,
          actual: 'string',
        });
      const notAllowed = keyStrict.allowed.find(
        (list) => !list.some((x) => String(x) === k),
      );
      if (notAllowed)
        keyErr(
          'invalid-value',
          'key is not one of the allowed values',
          notAllowed.map(String).join(' | '),
        );
      for (const pattern of keyStrict.patterns)
        if (!patternOf(pattern).test(k))
          keyErr('pattern-mismatch', `does not match ${pattern}`, pattern);
      checkValue(typed, keyValue(key.logicalType, k), at, out, {
        ...options,
        lenient: false,
      });
      checkValue(prop.map.value, v, `${path}{}`, out, options);
    }
  }
  if (prop.properties && typeof value === 'object' && !Array.isArray(value)) {
    checkFields(
      prop.properties,
      value as Record<string, unknown>,
      `${path}.`,
      out,
      options,
    );
  }
}

/** The text forms a map key may take for a numeric type; shared with the JSON Schema export. */
export const INTEGER_TEXT = /^-?\d+$/;
export const NUMBER_TEXT = /^-?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/;

/** A map key (always text) read as its declared type; text that is not that type stays text and fails the type check. */
export function keyValue(type: LogicalType | undefined, key: string): unknown {
  if (type === 'integer' && INTEGER_TEXT.test(key))
    return Number.isSafeInteger(Number(key)) ? Number(key) : BigInt(key);
  if (type === 'number' && NUMBER_TEXT.test(key)) return Number(key);
  if (type === 'boolean' && (key === 'true' || key === 'false'))
    return key === 'true';
  return key;
}

type Err = (code: ViolationCode, message: string, expected?: string) => void;

/**
 * Every ODCS 3.2 `logicalTypeOptions` key a single value can break, by type.
 * Advisory keys (string `format`, `timezone`, vector `distanceMetric`,
 * `embeddingModel`, number `format`) describe rather than constrain.
 */
function checkOptions(
  prop: PropertyShape,
  value: unknown,
  path: string,
  err: Err,
  out: Violation[],
  options: ValidateOptions,
): void {
  const o = prop.logicalTypeOptions ?? {};
  const t = prop.logicalType;
  if (t === 'number' || t === 'integer') {
    // Exact: a bigint or integer text keeps every digit (Number() would round 2^53 + 1).
    const exact =
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      (typeof value === 'string' && options.lenient)
        ? decimalOf(value)
        : undefined;
    if (exact) {
      checkBounds(
        exact,
        o.minimum,
        o.maximum,
        o.exclusiveMinimum,
        o.exclusiveMaximum,
        err,
      );
      if (
        typeof o.multipleOf === 'number' &&
        o.multipleOf > 0 &&
        !isMultiple(value as number | bigint | string, o.multipleOf)
      )
        err(
          'not-multiple',
          `not a multiple of ${o.multipleOf}`,
          String(o.multipleOf),
        );
    }
    const range =
      t === 'integer' && typeof o.format === 'string'
        ? integerRange(o.format)
        : undefined;
    const big = range ? toBigInt(value) : undefined;
    if (range && big !== undefined && (big < range[0] || big > range[1]))
      err('out-of-range', `outside the ${o.format} range`, String(o.format));
  }
  if (t === 'date' || t === 'timestamp' || t === 'time') {
    // Temporal bounds compare exact instants (every fractional digit), not text.
    const read = (v: unknown) => exactInstant(v, t === 'time');
    const at = read(value);
    if (at)
      checkBounds(
        at,
        o.minimum,
        o.maximum,
        o.exclusiveMinimum,
        o.exclusiveMaximum,
        err,
        read,
      );
  }
  if (typeof value === 'string') {
    if (o.minLength !== undefined && value.length < o.minLength)
      err('too-short', `shorter than ${o.minLength}`);
    if (o.maxLength !== undefined && value.length > o.maxLength)
      err('too-long', `longer than ${o.maxLength}`);
    if (o.pattern !== undefined && !patternOf(o.pattern).test(value))
      err('pattern-mismatch', `does not match ${o.pattern}`, o.pattern);
  }
  if (Array.isArray(value)) {
    if (o.minItems !== undefined && value.length < o.minItems)
      err('too-short', `fewer than ${o.minItems} items`);
    if (o.maxItems !== undefined && value.length > o.maxItems)
      err('too-long', `more than ${o.maxItems} items`);
    if (
      o.uniqueItems === true &&
      new Set(value.map((v) => canonical(v))).size !== value.length
    )
      err('duplicate-item', 'items must be unique');
    if (t === 'vector') {
      if (o.dimensions !== undefined && value.length !== o.dimensions)
        err(
          'wrong-dimensions',
          `expected ${o.dimensions} dimensions`,
          String(o.dimensions),
        );
      const range =
        typeof o.elementType === 'string'
          ? VECTOR_ELEMENT_RANGE[o.elementType]
          : undefined;
      if (
        range &&
        value.some(
          (x) =>
            typeof x !== 'number' ||
            !Number.isInteger(x) ||
            x < range[0] ||
            x > range[1],
        )
      )
        err(
          'out-of-range',
          `elements outside ${o.elementType}`,
          String(o.elementType),
        );
      if (o.normalized === true && value.length) {
        const norm = Math.sqrt(
          value.reduce(
            (sum: number, x) => sum + (typeof x === 'number' ? x * x : 0),
            0,
          ),
        );
        if (Math.abs(norm - 1) > 1e-3)
          err('not-normalized', 'vector is not unit length', '1');
      }
    }
    if (prop.items)
      for (const item of value)
        checkValue(prop.items, item, `${path}[]`, out, options);
  }
  if (
    (t === 'object' || t === 'map') &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const keys = Object.keys(value);
    if (typeof o.minProperties === 'number' && keys.length < o.minProperties)
      err('too-short', `fewer than ${o.minProperties} properties`);
    if (typeof o.maxProperties === 'number' && keys.length > o.maxProperties)
      err('too-long', `more than ${o.maxProperties} properties`);
    // ODCS object `required` names keys, which belong to the contract, so the path stays contract-bounded.
    if (Array.isArray(o.required))
      for (const k of o.required as string[]) {
        const v = (value as Record<string, unknown>)[k];
        if (v === undefined || v === null)
          out.push({
            path: `${path}.${k}`,
            schemaPath: `${path}.${k}`,
            code: 'required-missing',
            severity: 'error',
            message: 'required key is missing',
            actual: typeOf(v),
          });
      }
  }
}

/** Draft-4 (boolean) and draft-6+ (number) exclusive bounds, as ODCS allows both. */
function checkBounds(
  n: Decimal,
  min: unknown,
  max: unknown,
  exMin: unknown,
  exMax: unknown,
  err: Err,
  /** How a bound reads as a decimal: numbers by default, instants for temporal types. */
  read: (bound: unknown) => Decimal | undefined = (b) =>
    typeof b === 'number' ? decimalOf(b) : undefined,
): void {
  const cmp = (bound: unknown) => {
    const d = typeof bound === 'boolean' ? undefined : read(bound);
    return d && compareDecimal(n, d); // sign of n - bound
  };
  const lo = cmp(min);
  const hi = cmp(max);
  const exLo = cmp(exMin);
  const exHi = cmp(exMax);
  const below =
    (lo !== undefined && (exMin === true ? lo <= 0 : lo < 0)) ||
    (exLo !== undefined && exLo <= 0);
  const above =
    (hi !== undefined && (exMax === true ? hi >= 0 : hi > 0)) ||
    (exHi !== undefined && exHi >= 0);
  if (below)
    err(
      'below-minimum',
      'below the minimum',
      String(lo === undefined ? exMin : min),
    );
  if (above)
    err(
      'above-maximum',
      'above the maximum',
      String(hi === undefined ? exMax : max),
    );
}

/**
 * n is a multiple of m read as the decimals they are written as: 0.3 is a
 * multiple of 0.1, 1000000000000000.5 is not a multiple of 1. Exact at any
 * magnitude: both become integers over a common power of ten, in BigInt.
 */
export function isMultiple(
  n: number | bigint | string,
  m: number | bigint | string,
): boolean {
  const a = decimalOf(n);
  const b = decimalOf(m);
  if (!a || !b || b.digits === 0n) return false;
  const [x, y] = aligned(a, b);
  return x % y === 0n;
}

/** ODCS integer `format` (Rust integer types) as an inclusive range. */
function integerRange(format: string): [bigint, bigint] | undefined {
  const m = /^([iu])(8|16|32|64|128)$/.exec(format);
  if (!m) return undefined;
  const bits = BigInt(m[2]!);
  return m[1] === 'i'
    ? [-(2n ** (bits - 1n)), 2n ** (bits - 1n) - 1n]
    : [0n, 2n ** bits - 1n];
}

function toBigInt(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value))
    return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
}

const VECTOR_ELEMENT_RANGE: Record<string, [number, number]> = {
  int8: [-128, 127],
  uint8: [0, 255],
  binary: [0, 1],
};

/** The one epoch convention: below 1e12 a number is seconds (until 2286), else ms. */
export const isEpochSeconds = (n: number | bigint): boolean => n < 1e12;

/**
 * Epoch ms for an RFC 3339 date or date-time (T or space, zone optional), or
 * undefined. A value with no zone is read as UTC: Date.parse would read it in
 * this machine's zone, and an SLA age must not depend on where it is computed.
 */
export function instantOf(text: string): number | undefined {
  if (isDate(text)) return Date.parse(`${text}T00:00:00Z`);
  if (!isDateTime(text, false)) return undefined;
  const [d, t] = text.split(/t|\s/i) as [string, string];
  // JavaScript only parses zones as Z or ±hh:mm; RFC 3339 also allows ±hhmm and ±hh.
  const zoned = /z$/i.test(t)
    ? t
    : /[+-]\d{2}:?\d{2}$/.test(t) && /[+-]/.test(t.slice(8))
      ? t.replace(/([+-]\d{2}):?(\d{2})$/, '$1:$2')
      : /[+-]\d{2}$/.test(t)
        ? `${t}:00`
        : `${t}Z`;
  const ms = Date.parse(`${d}T${zoned}`);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * An instant as exact epoch seconds, every fractional digit kept (a double
 * of ms would make 09:00:00.0001 and 09:00:00.0009 equal). A time is read on
 * 1970-01-01 with its zone applied (10:00:00+02:00 is before 09:00:00Z); a
 * zone-less value reads as UTC. A leap second sorts at the end of its minute.
 */
export function exactInstant(
  value: unknown,
  time = false,
): Decimal | undefined {
  // A lenient read accepts epoch numbers; they mean what an SLA reads them as.
  if (typeof value === 'number' || typeof value === 'bigint') {
    const d = time ? undefined : decimalOf(value);
    return d && (isEpochSeconds(value) ? d : { ...d, scale: d.scale + 3 });
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return time || Number.isNaN(ms)
      ? undefined
      : { digits: BigInt(ms), scale: 3 };
  }
  if (typeof value !== 'string' || (time && !isTime(value, false)))
    return undefined;
  let fraction = '';
  const whole = value.replace(
    /(\d{2}:\d{2}):(\d{2})(?:\.(\d+))?/,
    (_, hm: string, sec: string, f = '') => {
      // 23:59:60.f sorts after every :59 fraction and keeps its own order: 59.(30 nines)f.
      fraction = sec === '60' ? `${'9'.repeat(30)}${f}` : f;
      return `${hm}:${sec === '60' ? '59' : sec}`;
    },
  );
  const ms = instantOf(time ? `1970-01-01T${whole}` : whole);
  if (ms === undefined) return undefined;
  // ms is whole seconds here; the fraction adds to them whatever their sign.
  return {
    digits:
      BigInt(ms / 1000) * 10n ** BigInt(fraction.length) +
      BigInt(fraction || '0'),
    scale: fraction.length,
  };
}

const patterns = new Map<string, RegExp>();
function patternOf(source: string): RegExp {
  let re = patterns.get(source);
  if (!re) patterns.set(source, (re = new RegExp(source, 'u')));
  return re;
}

// Database drivers hand enum columns back as strings and numbers as either.
/**
 * Strict equality, as JSON Schema `enum` reads it (a number and a bigint of
 * the same value are equal). Lenient adds what drivers do to typed values:
 * text for numbers and enum columns, Dates.
 */
/**
 * How values are compared for a property. `strict` is JSON Schema's
 * equality. `lenient` adds what drivers do to typed values (text, Dates).
 * `lenient-numeric`, for a numeric property, also reads numeric text as the
 * number it states ('1.00' is 1), as SQL compares a DECIMAL column.
 */
export type EqualityMode = 'strict' | 'lenient' | 'lenient-numeric';

export function equalityMode(
  prop: PropertyShape,
  options: { lenient?: boolean },
): EqualityMode {
  if (!options.lenient) return 'strict';
  return prop.logicalType === 'integer' || prop.logicalType === 'number'
    ? 'lenient-numeric'
    : 'lenient';
}

export function sameValue(
  a: unknown,
  b: unknown,
  mode: EqualityMode = 'strict',
): boolean {
  if (a === b) return true;
  const numeric = (x: unknown) =>
    typeof x === 'number' || typeof x === 'bigint';
  const numericLike = (x: unknown) =>
    numeric(x) || (mode === 'lenient-numeric' && typeof x === 'string');
  if (
    (numeric(a) && numeric(b)) ||
    (mode === 'lenient-numeric' && numericLike(a) && numericLike(b))
  ) {
    const x = decimalOf(a);
    const y = decimalOf(b);
    if (x !== undefined && y !== undefined) return compareDecimal(x, y) === 0;
  }
  if (mode === 'strict') return false;
  const text = (x: unknown) => (x instanceof Date ? dateText(x) : String(x));
  return text(a) === text(b);
}

/**
 * RFC 3339, as JSON Schema `format` reads it: a real calendar date; a time
 * with seconds and, strictly, a zone; a date-time joined by T or a space.
 * Lenient (database reads) drops the zone requirement: DATETIME and TIME
 * columns come back without one.
 */
export function isDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]!;
}

export function isTime(text: string, zoneRequired: boolean): boolean {
  const m =
    /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(z|([+-])(\d{2})(?::?(\d{2}))?)?$/i.exec(
      text,
    );
  if (!m) return false;
  const [h, min, sec] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!m[5] && zoneRequired) return false;
  const zh = Number(m[7] ?? 0);
  const zm = Number(m[8] ?? 0);
  if (zh > 23 || zm > 59 || h > 23 || min > 59 || sec > 60) return false;
  if (sec < 60) return true;
  // A leap second is 23:59:60 in UTC only.
  const sign = m[6] === '-' ? 1 : -1;
  const utc = (((h * 60 + min + sign * (zh * 60 + zm)) % 1440) + 1440) % 1440;
  return utc === 23 * 60 + 59;
}

export function isDateTime(text: string, zoneRequired: boolean): boolean {
  const parts = text.split(/t|\s/i);
  return (
    parts.length === 2 && isDate(parts[0]!) && isTime(parts[1]!, zoneRequired)
  );
}

export function matchesType(
  type: LogicalType,
  value: unknown,
  lenient: boolean,
): boolean {
  switch (type) {
    case 'string': {
      return typeof value === 'string';
    }
    case 'integer': {
      return (
        (typeof value === 'number' && Number.isInteger(value)) ||
        typeof value === 'bigint' ||
        (lenient && typeof value === 'string' && /^-?\d+$/.test(value))
      );
    }
    case 'number': {
      return (
        (typeof value === 'number' && Number.isFinite(value)) ||
        typeof value === 'bigint' ||
        // Decimal text only (as drivers return NUMERIC), not what Number() also takes (hex, spaces).
        (lenient && typeof value === 'string' && NUMBER_TEXT.test(value))
      );
    }
    case 'boolean': {
      return (
        typeof value === 'boolean' || (lenient && (value === 0 || value === 1))
      );
    }
    case 'date': {
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      if (typeof value === 'string')
        return isDate(value) || (lenient && isDateTime(value, false));
      return lenient && typeof value === 'number';
    }
    case 'timestamp': {
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      if (typeof value === 'string')
        return isDateTime(value, !lenient) || (lenient && isDate(value));
      return lenient && typeof value === 'number';
    }
    case 'time': {
      return typeof value === 'string' && isTime(value, !lenient);
    }
    case 'object':
    case 'map': {
      return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      );
    }
    case 'vector': {
      return (
        Array.isArray(value) &&
        value.every((x) => typeof x === 'number' && Number.isFinite(x))
      );
    }
    case 'array': {
      return Array.isArray(value);
    }
    default: {
      return true;
    }
  }
}

/** The observed type of a value, in contract vocabulary. */
export function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'timestamp';
  if (typeof value === 'number')
    return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'bigint') return 'integer';
  return typeof value;
}
