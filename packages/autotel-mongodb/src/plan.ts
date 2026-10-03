import type { IndexFields, QueryPlan } from 'autotel-db';

type Doc = Record<string, unknown>;

/**
 * Read the output of `explain('executionStats')` (or `'queryPlanner'`) as a
 * {@link QueryPlan}: find, count, update, delete and findAndModify explains,
 * aggregate explains whose first stage is a `$cursor`, the slot-based engine's
 * `queryPlan` wrapper, and a sharded cluster's per-shard plans.
 *
 * Returns `undefined` for anything without a winning plan, so a caller can
 * hand it whatever came back and attach nothing when it was not an explain.
 */
export function planFromExplain(explain: unknown): QueryPlan | undefined {
  if (!isDoc(explain)) return undefined;

  // An aggregate whose pipeline was not pushed down whole reports the query
  // part under its first stage, and the rest as stages after it.
  const stages = Array.isArray(explain.stages) ? explain.stages : undefined;
  const cursor = isDoc(stages?.[0]) ? asDoc(stages[0].$cursor) : undefined;
  const source = cursor ?? explain;

  const planner = asDoc(source.queryPlanner);
  const winning = asDoc(planner?.winningPlan);
  if (!winning) return undefined;

  const nodes: string[] = [];
  const indexes: string[] = [];
  const sorts: Doc[] = [];
  walk(asDoc(winning.queryPlan) ?? winning, (stage) => {
    if (typeof stage.stage === 'string') nodes.push(stage.stage);
    // An `_id` lookup (IDHACK, and 8.0's EXPRESS_IDHACK) reads the `_id`
    // index without naming it in the plan, so it is named here.
    const indexName =
      typeof stage.indexName === 'string'
        ? stage.indexName
        : ID_LOOKUP_STAGES.has(String(stage.stage))
          ? '_id_'
          : undefined;
    if (indexName !== undefined && !indexes.includes(indexName)) {
      indexes.push(indexName);
    }
    const sortPattern = asDoc(stage.sortPattern);
    if (stage.stage === 'SORT' && sortPattern) sorts.push(sortPattern);
  });

  for (const stage of stages?.slice(cursor ? 1 : 0) ?? []) {
    const [name] = isDoc(stage) ? Object.keys(stage) : [];
    if (name !== undefined) nodes.push(name);
  }

  const plan: QueryPlan = {
    nodes,
    fullScan: nodes.includes('COLLSCAN'),
    // A SORT stage in the plan, or a `$sort` the pipeline could not push into
    // the query, reads every match before returning the first.
    blockingSort: sorts.length > 0 || nodes.includes('$sort'),
    indexes,
  };

  const stats = asDoc(source.executionStats);
  if (stats) {
    plan.keysExamined = toNumber(stats.totalKeysExamined);
    plan.rowsExamined = toNumber(stats.totalDocsExamined);
    plan.rowsReturned = toNumber(stats.nReturned);
    plan.executionMs = toNumber(stats.executionTimeMillis);
  }

  // An in-memory SORT and a COLLSCAN are both what a missing index looks like.
  if (plan.fullScan || sorts.length > 0) {
    const namespace =
      typeof planner?.namespace === 'string' ? planner.namespace : '';
    const advice = indexAdvice(namespace, planner?.parsedQuery, sorts[0]);
    if (advice !== undefined) {
      plan.indexSuggestion = advice.command;
      plan.indexFields = advice.fields;
    }
  }

  return plan;
}

/**
 * The compound index MongoDB's Equality, Sort, Range rule asks for: fields
 * matched exactly first, then the sort, then fields matched by range. Returns
 * a `createIndex` call ready to paste into mongosh, or `undefined` when the
 * filter gives it nothing to index (an `$or`, an empty filter with no sort).
 */
export function suggestIndex(
  namespace: string,
  parsedQuery: unknown,
  sortPattern?: Doc,
): string | undefined {
  return indexAdvice(namespace, parsedQuery, sortPattern)?.command;
}

/**
 * {@link suggestIndex}, with the keys sorted by the job each does, so a reader
 * can say why the index has the shape it has.
 */
export function indexAdvice(
  namespace: string,
  parsedQuery: unknown,
  sortPattern?: Doc,
): { command: string; fields: IndexFields } | undefined {
  const equality: string[] = [];
  const range: string[] = [];
  const sorted = sortPattern !== undefined;

  for (const [field, condition] of fieldConditions(parsedQuery)) {
    const operator = isDoc(condition) ? Object.keys(condition)[0] : '$eq';
    // `$in` is equality until there is a sort to satisfy: the index then
    // returns each value's run in order, not one ordered run.
    const isEquality = operator === '$eq' || (operator === '$in' && !sorted);
    const bucket = isEquality ? equality : range;
    if (!equality.includes(field) && !range.includes(field)) bucket.push(field);
  }

  const keys: Array<[string, number]> = [];
  const fields: IndexFields = { equality: [], sort: [], range: [] };
  // A field keeps the first job it gets: equality before sort before range.
  const add = (field: string, direction: number, job: keyof IndexFields) => {
    if (keys.some(([existing]) => existing === field)) return;
    keys.push([field, direction]);
    fields[job].push(job === 'sort' ? `${field}:${direction}` : field);
  };
  for (const field of equality) add(field, 1, 'equality');
  for (const [field, direction] of Object.entries(sortPattern ?? {})) {
    add(field, direction === -1 ? -1 : 1, 'sort');
  }
  for (const field of range) add(field, 1, 'range');

  if (keys.length === 0) return undefined;

  const dot = namespace.indexOf('.');
  const collection = dot === -1 ? namespace : namespace.slice(dot + 1);
  const target = IDENTIFIER.test(collection)
    ? `db.${collection}`
    : `db.getCollection(${JSON.stringify(collection)})`;
  const spec = keys
    .map(
      ([field, direction]) =>
        `${IDENTIFIER.test(field) ? field : JSON.stringify(field)}: ${direction}`,
    )
    .join(', ');
  return { command: `${target}.createIndex({ ${spec} })`, fields };
}

const ID_LOOKUP_STAGES = new Set(['IDHACK', 'EXPRESS_IDHACK']);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/**
 * Top-level field conditions of a parsed query: `{ a: { $eq: 1 } }` and each
 * branch of a top-level `$and`. An `$or`, `$nor` or `$expr` is skipped, since no
 * single compound index serves one.
 */
function fieldConditions(parsedQuery: unknown): Array<[string, unknown]> {
  if (!isDoc(parsedQuery)) return [];
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(parsedQuery)) {
    if (key === '$and' && Array.isArray(value)) {
      for (const branch of value) out.push(...fieldConditions(branch));
    } else if (!key.startsWith('$')) {
      out.push([key, value]);
    }
  }
  return out;
}

function walk(stage: Doc, visit: (stage: Doc) => void): void {
  visit(stage);
  const input = asDoc(stage.inputStage);
  if (input) walk(input, visit);
  for (const child of Array.isArray(stage.inputStages)
    ? stage.inputStages
    : []) {
    if (isDoc(child)) walk(child, visit);
  }
  // A sharded cluster: one winning plan per shard, under the merge stage.
  for (const shard of Array.isArray(stage.shards) ? stage.shards : []) {
    const plan = isDoc(shard) ? asDoc(shard.winningPlan) : undefined;
    if (plan) walk(asDoc(plan.queryPlan) ?? plan, visit);
  }
}

function isDoc(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asDoc(value: unknown): Doc | undefined {
  return isDoc(value) ? value : undefined;
}

/** A number, or the BSON Long / Int32 / Double a driver can return instead. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (isDoc(value) && typeof value.toNumber === 'function') {
    const number: unknown = value.toNumber();
    return typeof number === 'number' ? number : undefined;
  }
  return undefined;
}
