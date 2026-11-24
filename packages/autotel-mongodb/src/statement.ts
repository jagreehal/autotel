/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof -- boundary: whatever the driver or application passed */
/**
 * Turn a MongoDB filter, projection or pipeline into `db.query.text` with every
 * value replaced by `?`.
 *
 * What is left is the query's shape: field names, operators and structure.
 * That is what a reader groups by, and it carries no user data, so there is
 * nothing for a redactor to miss. `find({ email: 'a@b.c' })` and
 * `find({ email: 'x@y.z' })` serialize to the same text and hash together.
 *
 * Every field is data, whatever it is called.
 */
export function serializeMongoStatement(value: unknown): string {
  return JSON.stringify(withoutValues(value)) ?? '"?"';
}

/**
 * Logical operators, whose branches are interchangeable: one entry per distinct
 * shape is kept. Every other array of documents is an ordered program, a
 * pipeline above all, and keeps every entry in order: one `$match` and two are
 * different queries.
 */
const LOGICAL_KEYS = new Set(['$or', '$and', '$nor']);

export function withoutValues(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    // A list of values (`$in: [1, 2, 3]`, tags, ids) is one value whatever
    // its length.
    const elements = elementsOf(value);
    if (
      elements.every(
        (element) => !isPlainObject(element) && !Array.isArray(element),
      )
    ) {
      return elements.length === 0 ? [] : ['?'];
    }
    const stripped = elements.map((element) => withoutValues(element));
    if (key === undefined || !LOGICAL_KEYS.has(key)) return stripped;
    const seen = new Map<string, unknown>();
    for (const element of stripped) seen.set(JSON.stringify(element), element);
    return [...seen.values()];
  }

  if (!isPlainObject(value)) {
    // Scalars, and the classes values arrive as: ObjectId, Date, Long,
    // Decimal128, Binary, RegExp, Buffer.
    return '?';
  }

  const keys = Object.keys(value);
  if (
    keys.length === 1 &&
    keys[0]!.startsWith('$') &&
    EXTENDED_JSON.has(keys[0]!)
  ) {
    return '?';
  }

  return mapFields(value, (field, name) => withoutValues(field, name));
}

/**
 * An array's elements, read by index as BSON does, without running its methods.
 * An element behind a getter reads as undefined.
 */
export function elementsOf(array: readonly unknown[]): unknown[] {
  return Array.from(
    { length: array.length },
    (_, index): unknown => Object.getOwnPropertyDescriptor(array, index)?.value,
  );
}

/** Absent fields are dropped, as JSON.stringify would. */
export function mapFields(
  value: Record<string, unknown>,
  map: (field: unknown, key: string) => unknown,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .map(([key, field]) => [key, map(field, key)]),
  );
}

/**
 * An object whose fields can be read without running application code. One with
 * a getter counts as a value.
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Object.values(fields).some((field) => field.get !== undefined)) {
    return false;
  }
  // BSON sends what toBSON() returns, so the object itself is a value.
  return !('toBSON' in value && typeof value.toBSON === 'function');
}

/** Extended JSON wrappers, which are one value however they are spelled. */
const EXTENDED_JSON = new Set([
  '$oid',
  '$date',
  '$numberLong',
  '$numberInt',
  '$numberDouble',
  '$numberDecimal',
  '$timestamp',
  '$binary',
  '$regularExpression',
  '$symbol',
  '$code',
  '$minKey',
  '$maxKey',
  '$undefined',
]);
