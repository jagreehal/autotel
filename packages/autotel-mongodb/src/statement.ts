/**
 * Turn a MongoDB command, filter, update or pipeline into `db.query.text` with
 * every value replaced by `?`.
 *
 * What is left is the query's shape: field names, operators and structure.
 * That is what a reader groups by, and it carries no user data, so there is
 * nothing for a redactor to miss. `find({ email: 'a@b.c' })` and
 * `find({ email: 'x@y.z' })` serialize to the same text and hash together.
 */
export function serializeMongoStatement(value: unknown): string {
  return JSON.stringify(withoutValues(value)) ?? '"?"';
}

/**
 * {@link serializeMongoStatement} for a whole driver command, as
 * `@opentelemetry/instrumentation-mongodb` hands its `dbStatementSerializer`:
 * the collection the command names is kept (`{"find":"users",…}`) and the
 * per-session fields are dropped.
 *
 * A separate function rather than a guess, because a command and a bare
 * filter with a `find` field look the same, and in the filter it is data.
 */
export function serializeMongoCommand(command: unknown): string {
  return JSON.stringify(withoutValues(command, true)) ?? '"?"';
}

/**
 * Keys a driver adds to every command that change per call or per session and
 * say nothing about the query. Leaving them in would give each call its own
 * text.
 */
const SESSION_KEYS = new Set([
  'lsid',
  '$clusterTime',
  '$db',
  'txnNumber',
  'autocommit',
  'startTransaction',
]);

/**
 * Arrays whose entries are interchangeable: a batch of documents or writes, and
 * the branches of a logical operator. Each keeps one entry per distinct
 * shape, so a batch of 3 and one of 3000 are the same statement. Every other
 * array of documents is an ordered program, an aggregation pipeline above
 * all, and keeps every entry in order: one `$match` and two are different
 * queries.
 */
const BATCH_KEYS = new Set([
  'documents',
  'operations',
  'updates',
  'deletes',
  '$or',
  '$and',
  '$nor',
]);

function withoutValues(
  value: unknown,
  isCommand = false,
  key?: string,
): unknown {
  if (Array.isArray(value)) {
    // A list of values (`$in: [1, 2, 3]`, tags, ids) is one value whatever
    // its length.
    if (
      value.every(
        (element) => !isPlainObject(element) && !Array.isArray(element),
      )
    ) {
      return value.length === 0 ? [] : ['?'];
    }
    const stripped = value.map((element) => withoutValues(element));
    if (key === undefined || !BATCH_KEYS.has(key)) return stripped;
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

  const out: Record<string, unknown> = {};
  for (const [index, key] of keys.entries()) {
    if (isCommand && SESSION_KEYS.has(key)) continue;
    const field = value[key];
    // Absent, as JSON.stringify would have it: a payload without an update
    // is not the same statement as one whose update is a value.
    if (field === undefined) continue;
    // A command document names its collection in its first field
    // (`{ find: 'users', filter: … }`). That is not user data, and without it
    // a find on users and a find on orders would read as the same statement.
    const keepCollection =
      isCommand &&
      index === 0 &&
      COMMANDS.has(key) &&
      typeof field === 'string';
    out[key] = keepCollection ? field : withoutValues(field, false, key);
  }
  return out;
}

/** Commands whose first field is the collection they act on. */
const COMMANDS = new Set([
  'find',
  'aggregate',
  'count',
  'distinct',
  'insert',
  'update',
  'delete',
  'findAndModify',
  'createIndexes',
  'listIndexes',
  'drop',
  'mapReduce',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
