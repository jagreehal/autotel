/**
 * ODCS ⇄ JSON Schema (draft 2020-12), for tools whose interchange is JSON
 * Schema: an event catalog, a schema registry, Zod/Pydantic/AJV. What JSON
 * Schema cannot say (classification, physical type, primary key) travels as
 * `x-odcs-*` keywords, which validators ignore and `fromJsonSchema` reads back.
 */
import { allowedIntersection, strictConstraints } from './constraints.js';
import { INTEGER_TEXT, NUMBER_TEXT } from './validate.js';
import {
  findObject,
  type DataContract,
  type QualityRule,
  type LogicalType,
  type SchemaObject,
  type PropertyShape,
  type SchemaProperty,
} from './contract.js';

export type JsonSchema = Record<string, unknown>;

const FORMAT: Partial<Record<LogicalType, string>> = {
  date: 'date',
  timestamp: 'date-time',
  time: 'time',
};
/** The logicalTypeOptions JSON Schema can state for each type, under the same name. */
const KEYWORDS: Partial<Record<LogicalType, readonly string[]>> = {
  string: ['minLength', 'maxLength', 'pattern', 'format'],
  number: [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
  ],
  integer: [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
  ],
  array: ['minItems', 'maxItems', 'uniqueItems'],
  vector: ['uniqueItems'],
  object: ['minProperties', 'maxProperties'],
  map: ['minProperties', 'maxProperties'],
};

/**
 * A map key as JSON Schema sees it: always a string. Each type becomes the
 * text forms `keyValue` reads as that type, so the export and the runtime
 * accept the same keys. Bounds on numeric keys have no string form; they
 * stay in `x-odcs-mapKey` and are checked at runtime.
 */
function keySchema(key: PropertyShape): JsonSchema {
  const t = key.logicalType;
  const s: JsonSchema = { type: 'string' };
  const o = key.logicalTypeOptions ?? {};
  const nonNegative =
    (typeof o.minimum === 'number' && o.minimum >= 0) ||
    (typeof o.exclusiveMinimum === 'number' && o.exclusiveMinimum >= -1);
  if (t === 'integer')
    s.pattern = nonNegative ? String.raw`^\d+$` : INTEGER_TEXT.source;
  else if (t === 'number') s.pattern = NUMBER_TEXT.source;
  else if (t === 'boolean') s.enum = ['true', 'false'];
  else if (t && FORMAT[t]) s.format = FORMAT[t];
  else if (t === undefined || t === 'string')
    Object.assign(s, typeKeywords('string', key.logicalTypeOptions ?? {}));
  const strict = strictConstraints(key);
  const allowed = allowedIntersection(strict);
  if (allowed) s.enum = allowed.map(String);
  if (strict.patterns.length)
    s.allOf = strict.patterns.map((pattern) => ({ pattern }));
  // A key is text: numeric bounds and format ranges have no string form.
  if (
    t === 'integer' ||
    t === 'number' ||
    t === 'date' ||
    t === 'timestamp' ||
    t === 'time'
  )
    unenforced(
      s,
      Object.keys(o).filter((k) => !['format'].includes(k) || t === 'integer'),
    );
  return s;
}

/**
 * Name, on the schema node, every option the runtime checks that this JSON
 * Schema does not state, so a consumer sees the gap instead of assuming the
 * schema says everything the contract does.
 */
function unenforced(s: JsonSchema, keys: string[]): void {
  const list = [
    ...new Set([
      ...((s['x-odcs-unenforced'] as string[] | undefined) ?? []),
      ...keys,
    ]),
  ];
  if (list.length) s['x-odcs-unenforced'] = list.toSorted();
}

/** JSON-safe integer `format` ranges; i64 and wider exceed what a JSON number holds exactly. */
const SAFE_INTEGER_FORMATS: Record<string, [number, number]> = {
  i8: [-128, 127],
  i16: [-32_768, 32_767],
  i32: [-2_147_483_648, 2_147_483_647],
  u8: [0, 255],
  u16: [0, 65_535],
  u32: [0, 4_294_967_295],
};

/** The keywords for a type, with draft-4 boolean exclusive bounds rewritten as 2020-12 numbers. */
function typeKeywords(
  t: LogicalType | undefined,
  o: Record<string, unknown>,
): JsonSchema {
  const out: JsonSchema = {};
  for (const key of (t && KEYWORDS[t]) ?? [])
    if (o[key] !== undefined) out[key] = o[key];
  for (const [flag, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (out[flag] === true && typeof out[bound] === 'number') {
      out[flag] = out[bound];
      delete out[bound];
    } else if (typeof out[flag] === 'boolean') delete out[flag];
  }
  return out;
}

export function toJsonSchema(
  contract: DataContract,
  object: string | SchemaObject,
): JsonSchema {
  const obj =
    typeof object === 'string' ? findObject(contract, object) : object;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${contract.id}/${obj.name}/${contract.version}`,
    title: obj.businessName ?? obj.name,
    ...(obj.description ? { description: obj.description } : {}),
    ...objectSchema(obj.properties ?? []),
    'x-odcs-contract': {
      id: contract.id,
      version: contract.version,
      status: contract.status,
    },
  };
}

function objectSchema(props: SchemaProperty[]): JsonSchema {
  // JSON Schema `required` is what a record must carry: the strict reading
  // (required, primary key, zero-tolerance null rules). `x-odcs-required`
  // keeps which of them the contract marked `required`, for the way back.
  const required = props
    .filter((p) => strictConstraints(p).notNull)
    .map((p) => p.name);
  const declared = props
    .filter((p) => p.required || p.primaryKey)
    .map((p) => p.name);
  return {
    type: 'object',
    properties: Object.fromEntries(
      props.map((p) => [p.name, propertySchema(p)]),
    ),
    ...(required.length ? { required } : {}),
    'x-odcs-required': declared,
  };
}

function propertySchema(p: PropertyShape): JsonSchema {
  const s: JsonSchema = {};
  const t = p.logicalType;
  if (t === 'object') Object.assign(s, objectSchema(p.properties ?? []));
  else if (t === 'map') {
    s.type = 'object';
    s['x-odcs-logicalType'] = 'map';
    if (p.map) {
      s.additionalProperties = propertySchema(p.map.value);
      s.propertyNames = keySchema(p.map.key);
      s['x-odcs-mapKey'] = p.map.key;
    }
  } else if (t === 'vector') {
    s.type = 'array';
    s['x-odcs-logicalType'] = 'vector';
    const element = p.logicalTypeOptions?.elementType;
    s.items =
      element === 'binary'
        ? { enum: [0, 1] }
        : element === 'int8'
          ? { type: 'integer', minimum: -128, maximum: 127 }
          : element === 'uint8'
            ? { type: 'integer', minimum: 0, maximum: 255 }
            : { type: 'number' };
    if (p.logicalTypeOptions?.normalized === true)
      unenforced(s, ['normalized']);
    const d = p.logicalTypeOptions?.dimensions;
    if (d !== undefined) Object.assign(s, { minItems: d, maxItems: d });
  } else if (t === 'array') {
    s.type = 'array';
    if (p.items) s.items = propertySchema(p.items);
  } else if (t) {
    s.type = t === 'date' || t === 'timestamp' || t === 'time' ? 'string' : t;
    if (FORMAT[t]) s.format = FORMAT[t];
  }
  const o = p.logicalTypeOptions ?? {};
  Object.assign(s, typeKeywords(t, o));
  if (t === 'integer' && typeof o.format === 'string') {
    const range = SAFE_INTEGER_FORMATS[o.format];
    if (range) {
      // Intersect with any declared bound: the tighter one holds.
      if (typeof s.minimum !== 'number' || s.minimum < range[0])
        s.minimum = range[0];
      if (typeof s.maximum !== 'number' || s.maximum > range[1])
        s.maximum = range[1];
    } else unenforced(s, ['format']);
  }
  if (t === 'date' || t === 'timestamp' || t === 'time')
    unenforced(
      s,
      ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].filter(
        (k) => o[k] !== undefined,
      ),
    );
  if (Array.isArray(o.required) && (t === 'object' || t === 'map'))
    s.required = [
      ...new Set([
        ...((s.required as string[] | undefined) ?? []),
        ...(o.required as string[]),
      ]),
    ];
  // Everything, including what JSON Schema cannot state (date bounds, integer format, vector element type).
  if (Object.keys(o).length) s['x-odcs-logicalTypeOptions'] = o;
  // Only what one record must satisfy becomes a JSON Schema keyword; a rule
  // with an allowance is a batch measure and travels as metadata.
  const strict = strictConstraints(p);
  const allowed = allowedIntersection(strict);
  if (allowed) s.enum = strict.notNull ? allowed : [...allowed, null];
  // Under allOf, so the way back does not mistake a rule's pattern for a type option.
  if (strict.patterns.length)
    s.allOf = strict.patterns.map((pattern) => ({ pattern }));
  if (strict.missing.length) s.not = { enum: strict.missing };
  // ODCS lets an optional field be null; a bare `type` would reject it.
  if (!strict.notNull && typeof s.type === 'string') s.type = [s.type, 'null'];
  if (p.enum?.length) s['x-odcs-enum'] = p.enum;
  if (p.quality?.length) s['x-odcs-quality'] = p.quality;
  if (p.businessName) s.title = p.businessName;
  if (p.description) s.description = p.description;
  if (p.examples?.length) s.examples = p.examples;
  if (p.classification) s['x-odcs-classification'] = p.classification;
  if (p.physicalType) s['x-odcs-physicalType'] = p.physicalType;
  if (p.primaryKey) s['x-odcs-primaryKey'] = true;
  if (p.tags?.length) s['x-odcs-tags'] = p.tags;
  return s;
}

/**
 * Draft a schema object from a JSON Schema: the data-first path for an
 * event or table that already has one.
 * `$ref`, `allOf`/`oneOf`/`anyOf` are not resolved; dereference
 * the schema first if it uses them.
 */
export function fromJsonSchema(schema: JsonSchema, name: string): SchemaObject {
  return {
    name,
    ...(typeof schema.title === 'string' && schema.title !== name
      ? { businessName: schema.title }
      : {}),
    ...(typeof schema.description === 'string'
      ? { description: schema.description }
      : {}),
    properties: propertiesFrom(schema),
  };
}

function propertiesFrom(schema: JsonSchema): SchemaProperty[] {
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  // Our own export says which were `required`; a foreign schema's `required` is the best reading.
  const marked = schema['x-odcs-required'];
  const required = new Set(
    (Array.isArray(marked)
      ? marked
      : Array.isArray(schema.required)
        ? schema.required
        : []) as string[],
  );
  return Object.entries(props).map(([name, s]) => ({
    ...propertyFrom(s),
    name,
    ...(required.has(name) ? { required: true } : {}),
  }));
}

function propertyFrom(s: JsonSchema): PropertyShape {
  const types = (Array.isArray(s.type) ? s.type : [s.type]).filter(
    (t) => t !== 'null' && t !== undefined,
  ) as string[];
  const p: PropertyShape = {};
  const t = types.length === 1 ? types[0] : undefined;
  if (t === 'string')
    p.logicalType =
      s.format === 'date'
        ? 'date'
        : s.format === 'date-time'
          ? 'timestamp'
          : s.format === 'time'
            ? 'time'
            : 'string';
  else if (
    t === 'number' ||
    t === 'integer' ||
    t === 'boolean' ||
    t === 'object' ||
    t === 'array'
  )
    p.logicalType = t;
  else if (s.properties) p.logicalType = 'object';
  if (s['x-odcs-logicalType'] === 'map') {
    p.logicalType = 'map';
    p.map = {
      // Our export keeps the ODCS key verbatim; propertyNames only says which strings qualify.
      key:
        s['x-odcs-mapKey'] && typeof s['x-odcs-mapKey'] === 'object'
          ? (s['x-odcs-mapKey'] as PropertyShape)
          : propertyFrom(
              (s.propertyNames as JsonSchema | undefined) ?? { type: 'string' },
            ),
      value: propertyFrom(
        (s.additionalProperties as JsonSchema | undefined) ?? {},
      ),
    };
  }
  const keywords = (p.logicalType && KEYWORDS[p.logicalType]) ?? [];
  const options = Object.fromEntries(
    keywords.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]),
  );
  if (Object.keys(options).length) p.logicalTypeOptions = options;
  if (s['x-odcs-logicalType'] === 'vector') {
    // minItems = maxItems is how toJsonSchema writes a vector's dimensions.
    p.logicalType = 'vector';
    delete p.logicalTypeOptions;
    if (typeof s.maxItems === 'number' && s.maxItems === s.minItems)
      p.logicalTypeOptions = { dimensions: s.maxItems };
  }
  // Our own export carries the options verbatim.
  if (
    s['x-odcs-logicalTypeOptions'] &&
    typeof s['x-odcs-logicalTypeOptions'] === 'object'
  ) {
    p.logicalTypeOptions = s[
      'x-odcs-logicalTypeOptions'
    ] as PropertyShape['logicalTypeOptions'];
  }
  if (Array.isArray(s['x-odcs-quality']))
    p.quality = s['x-odcs-quality'] as QualityRule[];
  if (Array.isArray(s['x-odcs-enum']))
    p.enum = s['x-odcs-enum'] as SchemaProperty['enum'];
  // An enum next to x-odcs-quality was derived from the rules, not declared.
  else if (Array.isArray(s.enum) && !Array.isArray(s['x-odcs-quality']))
    p.enum = s.enum
      .filter((v) => v !== null)
      .map((value) => ({ value: value as string | number | boolean }));
  if (typeof s.title === 'string') p.businessName = s.title;
  if (typeof s.description === 'string') p.description = s.description;
  if (Array.isArray(s.examples)) p.examples = s.examples;
  if (typeof s['x-odcs-classification'] === 'string')
    p.classification = s['x-odcs-classification'];
  if (typeof s['x-odcs-physicalType'] === 'string')
    p.physicalType = s['x-odcs-physicalType'];
  if (s['x-odcs-primaryKey'] === true) p.primaryKey = true;
  if (Array.isArray(s['x-odcs-tags'])) p.tags = s['x-odcs-tags'] as string[];
  if (p.logicalType === 'object' && s.properties)
    p.properties = propertiesFrom(s);
  if (p.logicalType === 'array' && s.items && typeof s.items === 'object')
    p.items = propertyFrom(s.items as JsonSchema);
  return p;
}
