/**
 * Breaking-change detection between two versions of a contract, read from
 * the consumer's side: the contract is the provider's promise, so weakening
 * a promise (a removed column, a type change, required → optional, a wider
 * valid-value set, a looser SLA) is breaking, and strengthening one is a
 * minor change. Note this is the opposite reading to autotel-schema, where
 * the reader of the contract is the producer.
 */
import { canonical, sameStructure } from './equality.js';
import {
  THRESHOLD_KEYS,
  durationMs,
  parseSemver,
  ruleMetric,
  type DataContract,
  type LogicalTypeOptions,
  type QualityRule,
  type SchemaProperty,
} from './contract.js';

export type ChangeLevel = 'breaking' | 'additive' | 'patch';

export interface ContractChange {
  level: ChangeLevel;
  path: string;
  message: string;
  /**
   * A person should read it: a change to free-text terms (purpose, usage,
   * limitations), status, price or a deprecation. Prose can narrow what a
   * consumer may do with the data without any structural change.
   */
  review?: true;
}

export type Bump = 'major' | 'minor' | 'patch' | 'none';

export interface ContractDiff {
  changes: ContractChange[];
  /** The least version bump these changes need. */
  required: Bump;
  /** The bump between the two `version` fields. */
  declared: Bump;
  /** False when the version moved less than the changes need. */
  ok: boolean;
  /** Some change is flagged `review`. */
  needsReview: boolean;
  /** Set when either `version` is not SemVer: the gate cannot judge the bump, so `ok` is false. */
  versionError?: string;
}

const RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 };
/**
 * How a change to each key is read, per level. `handled` keys have their own
 * comparison above; `review` is a patch a person must read. A key not in the
 * table is `review`: a field this tool does not know is never waved through.
 */
type KeyRule = ChangeLevel | 'review' | 'handled';
const PROSE: Record<string, KeyRule> = {
  description: 'patch',
  businessName: 'patch',
  examples: 'patch',
  tags: 'patch',
  synonyms: 'patch',
  customProperties: 'patch',
  // Links to definitions elsewhere carry meaning (an ontology concept, a policy).
  authoritativeDefinitions: 'review',
};
const OBJECT_KEYS: Record<string, KeyRule> = {
  ...PROSE,
  authoritativeDefinitions: 'handled',
  name: 'handled',
  physicalName: 'handled',
  quality: 'handled',
  properties: 'handled',
  // A table that becomes a topic or a view is read differently by every consumer.
  physicalType: 'breaking',
  logicalType: 'breaking',
  id: 'review',
  dataGranularityDescription: 'review',
  relationships: 'review',
  context: 'review',
  deprecated: 'review',
};
const PROPERTY_KEYS: Record<string, KeyRule> = {
  ...PROSE,
  authoritativeDefinitions: 'handled',
  ...Object.fromEntries(
    [
      'name',
      'logicalType',
      'physicalType',
      'physicalName',
      'required',
      'primaryKey',
      'unique',
      'classification',
      'logicalTypeOptions',
      'quality',
      'properties',
      'items',
      'enum',
      'deprecated',
      'map',
    ].map((k) => [k, 'handled' as const]),
  ),
  primaryKeyPosition: 'breaking',
  encryptedName: 'breaking',
  partitioned: 'review',
  partitionKeyPosition: 'review',
  criticalDataElement: 'review',
  semanticType: 'review',
  transformLogic: 'review',
  transformSourceObjects: 'review',
  transformDescription: 'patch',
  relationships: 'review',
  id: 'review',
};
const TOP_KEYS: Record<string, KeyRule> = {
  ...Object.fromEntries(
    [
      'schema',
      'slaProperties',
      'slaDefaultElement',
      'version',
      'servers',
      'roles',
      'status',
      'description',
      'authoritativeDefinitions',
      'price',
    ].map((k) => [k, 'handled' as const]),
  ),
  id: 'breaking',
  kind: 'breaking',
  // The AI context is instructions and constraints agents act on.
  context: 'review',
  apiVersion: 'patch',
  name: 'patch',
  team: 'patch',
  support: 'patch',
  tags: 'patch',
  customProperties: 'patch',
  domain: 'patch',
  dataProduct: 'patch',
  tenant: 'patch',
  contractCreatedTs: 'patch',
};
const DESCRIPTION_KEYS: Record<string, KeyRule> = {
  purpose: 'review',
  usage: 'review',
  limitations: 'review',
  customProperties: 'patch',
};

function diffKeys(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  table: Record<string, KeyRule>,
  path: string,
  add: Add,
): void {
  const o = before ?? {};
  const n = after ?? {};
  for (const key of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (sameStructure(o[key], n[key])) continue;
    const rule = table[key] ?? 'review';
    if (rule === 'handled') continue;
    const at = path ? `${path}.${key}` : key;
    if (rule === 'review') add('patch', at, `${key} changed`, true);
    else add(rule, at, `${key} ${json(o[key])} → ${json(n[key])}`);
  }
}
const LOWER_BOUNDS = new Set([
  'minimum',
  'exclusiveMinimum',
  'minLength',
  'minItems',
]);
const UPPER_BOUNDS = new Set([
  'maximum',
  'exclusiveMaximum',
  'maxLength',
  'maxItems',
]);

const json = (v: unknown) => JSON.stringify(v ?? null);

type Add = (
  level: ChangeLevel,
  path: string,
  message: string,
  review?: true,
) => void;

/**
 * Keyed entries (servers by `server`, roles by `role`): a removed one is
 * breaking (a consumer loses where or how it reads), an added one additive,
 * and a change to anything but its prose breaking.
 */
function diffKeyed(
  before: Array<Record<string, unknown>> | undefined,
  after: Array<Record<string, unknown>> | undefined,
  key: string,
  label: string,
  add: Add,
): void {
  const byKey = (list: Array<Record<string, unknown>> | undefined) =>
    new Map((list ?? []).map((e, i) => [String(e[key] ?? `#${i}`), e]));
  const prose = (e: Record<string, unknown>) => {
    const { description: _d, customProperties: _c, ...rest } = e;
    return canonical(rest);
  };
  const o = byKey(before);
  const n = byKey(after);
  for (const [k, e] of o) {
    const next = n.get(k);
    const path = `${label}.${k}`;
    if (!next)
      add(
        'breaking',
        path,
        `${label === 'servers' ? 'server' : 'role'} removed`,
      );
    else if (prose(e) !== prose(next))
      add(
        'breaking',
        path,
        `${label === 'servers' ? 'connection' : 'access'} changed`,
      );
    else if (!sameStructure(e, next)) add('patch', path, 'description changed');
  }
  for (const k of n.keys())
    if (!o.has(k))
      add(
        'additive',
        `${label}.${k}`,
        `${label === 'servers' ? 'server' : 'role'} added`,
      );
}

export function diffContracts(
  before: DataContract,
  after: DataContract,
): ContractDiff {
  const changes: ContractChange[] = [];
  const add: Add = (level, path, message, review) =>
    changes.push(
      review ? { level, path, message, review } : { level, path, message },
    );

  const oldObjects = new Map((before.schema ?? []).map((o) => [o.name, o]));
  const newObjects = new Map((after.schema ?? []).map((o) => [o.name, o]));
  for (const [name, o] of oldObjects) {
    const n = newObjects.get(name);
    if (!n) {
      add('breaking', name, 'schema object removed');
      continue;
    }
    if ((o.physicalName ?? name) !== (n.physicalName ?? name))
      add(
        'breaking',
        name,
        `physical name ${o.physicalName ?? name} → ${n.physicalName ?? name}`,
      );
    diffRules(o.quality, n.quality, name, add);
    diffDefinitions(o, n, name, add);
    diffProperties(o.properties ?? [], n.properties ?? [], name, add);
    diffKeys(o, n, OBJECT_KEYS, name, add);
  }
  for (const name of newObjects.keys())
    if (!oldObjects.has(name)) add('additive', name, 'schema object added');

  diffSla(before, after, add);

  diffKeyed(before.servers, after.servers, 'server', 'servers', add);
  diffKeyed(before.roles, after.roles, 'role', 'roles', add);
  if (before.status !== after.status)
    add('patch', 'status', `${before.status} → ${after.status}`, true);
  diffKeys(
    before.description,
    after.description,
    DESCRIPTION_KEYS,
    'description',
    add,
  );
  for (const key of ['authoritativeDefinitions', 'price'] as const)
    if (!sameStructure(before[key], after[key]))
      add('patch', key, `${key} changed`, true);
  diffKeys(before, after, TOP_KEYS, '', add);

  const required: Bump = changes.some((c) => c.level === 'breaking')
    ? 'major'
    : changes.some((c) => c.level === 'additive')
      ? 'minor'
      : changes.length
        ? 'patch'
        : 'none';
  const declared = bumpBetween(before.version, after.version);
  // Under SemVer 0.x a minor bump may break.
  const needed: Bump =
    required === 'major' && parseSemver(before.version)?.[0] === 0
      ? 'minor'
      : required;
  const bad = [before.version, after.version].filter(
    (v) => !parseSemver(String(v)),
  );
  // A version may only move forward (SemVer precedence, pre-release included):
  // 2.0.0 → 1.9.9 and 2.0.0 → 2.0.0-rc.1 both go back.
  const versionError = bad.length
    ? `not SemVer: ${bad.map((v) => JSON.stringify(v)).join(', ')}`
    : compareSemver(after.version, before.version) < 0
      ? `the version went down: ${before.version} → ${after.version}`
      : undefined;
  return {
    changes,
    required,
    declared,
    ok: versionError === undefined && RANK[declared] >= RANK[needed],
    needsReview: changes.some((c) => c.review),
    ...(versionError ? { versionError } : {}),
  };
}

/** For these a smaller number is the stronger promise; for availability, larger is. */
const SMALLER_IS_STRONGER = new Set([
  'freshness',
  'latency',
  'frequency',
  'timeToDetect',
  'timeToNotify',
  'timeToRepair',
]);
const LARGER_IS_STRONGER = new Set(['availability']);

function diffSla(before: DataContract, after: DataContract, add: Add): void {
  const byKey = (c: DataContract) =>
    new Map(
      (c.slaProperties ?? []).map((s) => [
        `${s.property}:${s.element ?? c.slaDefaultElement ?? ''}`,
        s,
      ]),
    );
  const o = byKey(before);
  const n = byKey(after);
  for (const [key, s] of o) {
    const next = n.get(key);
    const path = `sla.${key}`;
    if (!next) {
      add('breaking', path, 'service level removed');
      continue;
    }
    if (!sameStructure([s.value, s.unit], [next.value, next.unit])) {
      // Compare like with like: 24 hours and 1 day are the same promise.
      const a =
        s.unit === undefined ? Number(s.value) : durationMs(s.value, s.unit);
      const b =
        next.unit === undefined
          ? Number(next.value)
          : durationMs(next.value, next.unit);
      const msg =
        `${s.value} ${s.unit ?? ''} → ${next.value} ${next.unit ?? ''}`.trim();
      const comparable =
        a !== undefined &&
        b !== undefined &&
        Number.isFinite(a) &&
        Number.isFinite(b);
      if (comparable && a === b) add('patch', path, msg);
      else if (comparable && SMALLER_IS_STRONGER.has(s.property))
        add(b < a ? 'additive' : 'breaking', path, msg);
      else if (comparable && LARGER_IS_STRONGER.has(s.property))
        add(b > a ? 'additive' : 'breaking', path, msg);
      // Retention cuts both ways (history kept vs data deleted); unknown properties have no known direction.
      else add('breaking', path, msg, true);
    }
    const { value: _v, unit: _u, ...restOld } = s;
    const { value: _nv, unit: _nu, ...restNew } = next;
    diffKeys(
      restOld,
      restNew,
      { property: 'handled', element: 'handled', description: 'patch' },
      path,
      add,
    );
  }
  for (const key of n.keys())
    if (!o.has(key)) add('additive', `sla.${key}`, 'service level added');
}

function diffProperties(
  before: SchemaProperty[],
  after: SchemaProperty[],
  prefix: string,
  add: Add,
): void {
  const newByName = new Map(after.map((p) => [p.name, p]));
  for (const o of before) {
    const path = `${prefix}.${o.name}`;
    const n = newByName.get(o.name);
    if (!n) {
      add('breaking', path, 'property removed');
      continue;
    }
    if (o.logicalType !== n.logicalType)
      add(
        'breaking',
        path,
        `logicalType ${o.logicalType ?? '(none)'} → ${n.logicalType ?? '(none)'}`,
      );
    if (o.physicalType !== n.physicalType && o.physicalType !== undefined)
      add(
        'breaking',
        path,
        `physicalType ${o.physicalType} → ${n.physicalType ?? '(none)'}`,
      );
    if ((o.physicalName ?? o.name) !== (n.physicalName ?? n.name))
      add('breaking', path, 'physical name changed');
    const req = (p: SchemaProperty) => Boolean(p.required || p.primaryKey);
    if (req(o) && !req(n))
      add('breaking', path, 'no longer required: consumers may now get nulls');
    if (!req(o) && req(n)) add('additive', path, 'now required');
    if (o.primaryKey && !n.primaryKey)
      add('breaking', path, 'no longer the primary key');
    if (o.unique && !n.unique) add('breaking', path, 'no longer unique');
    if (o.classification !== n.classification)
      add(
        'additive',
        path,
        `classification ${o.classification ?? '(none)'} → ${n.classification ?? '(none)'}`,
      );
    diffOptions(
      o.logicalTypeOptions ?? {},
      n.logicalTypeOptions ?? {},
      path,
      add,
    );
    diffRules(o.quality, n.quality, path, add);
    diffDefinitions(o, n, path, add);
    if (o.properties || n.properties)
      diffProperties(o.properties ?? [], n.properties ?? [], path, add);
    diffEnum(o, n, path, add);
    if (!o.deprecated && n.deprecated) add('patch', path, 'deprecated', true);
    if (o.map || n.map)
      for (const part of ['key', 'value'] as const)
        diffProperties(
          [{ name: `{${part}}`, ...o.map?.[part] }],
          [{ name: `{${part}}`, ...n.map?.[part] }],
          path,
          add,
        );
    if (o.items || n.items)
      diffProperties(
        [{ name: '[]', ...o.items }],
        [{ name: '[]', ...n.items }],
        path,
        add,
      );
    diffKeys(o, n, PROPERTY_KEYS, path, add);
  }
  const oldNames = new Set(before.map((p) => p.name));
  for (const n of after)
    if (!oldNames.has(n.name))
      add('additive', `${prefix}.${n.name}`, 'property added');
}

/**
 * A `semantics` link says which concept an element is (an ontology IRI):
 * consumers join on it. Dropping or changing one says the element now means
 * something else, which is breaking; linking one where there was none adds
 * meaning. Other links (policies, docs) are for a person to read.
 */
function diffDefinitions(
  o: { authoritativeDefinitions?: unknown; [key: string]: unknown },
  n: { authoritativeDefinitions?: unknown; [key: string]: unknown },
  path: string,
  add: Add,
): void {
  if (sameStructure(o.authoritativeDefinitions, n.authoritativeDefinitions))
    return;
  const split = (defs: unknown) => {
    const list = Array.isArray(defs)
      ? (defs as Array<Record<string, unknown>>)
      : [];
    const isSemantic = (d: Record<string, unknown>) => d?.type === 'semantics';
    return {
      semantic: new Set(
        list.filter((d) => isSemantic(d)).map((d) => String(d.url)),
      ),
      other: list.filter((d) => !isSemantic(d)),
    };
  };
  const before = split(o.authoritativeDefinitions);
  const after = split(n.authoritativeDefinitions);
  const at = `${path}.authoritativeDefinitions`;
  const dropped = [...before.semantic].filter((u) => !after.semantic.has(u));
  const linked = [...after.semantic].filter((u) => !before.semantic.has(u));
  if (dropped.length)
    add(
      'breaking',
      at,
      linked.length
        ? `concept ${dropped.join(', ')} → ${linked.join(', ')}`
        : `concept link removed: ${dropped.join(', ')}`,
    );
  else if (linked.length)
    add('additive', at, `concept linked: ${linked.join(', ')}`);
  if (!sameStructure(before.other, after.other))
    add('patch', at, 'authoritativeDefinitions changed', true);
}

function diffEnum(
  o: SchemaProperty,
  n: SchemaProperty,
  path: string,
  add: Add,
): void {
  const values = (p: SchemaProperty) => p.enum?.map((e) => canonical(e.value));
  const ov = values(o);
  const nv = values(n);
  if (sameStructure(ov, nv)) return;
  if (!ov) return add('additive', `${path}.enum`, 'enum added');
  if (!nv)
    return add(
      'breaking',
      `${path}.enum`,
      'enum removed: any value may now arrive',
    );
  const widened = nv.filter((v) => !ov.includes(v));
  if (widened.length)
    add('breaking', `${path}.enum`, `new enum values: ${widened.join(', ')}`);
  else if (nv.length < ov.length)
    add('additive', `${path}.enum`, 'fewer enum values');
}

function diffOptions(
  before: LogicalTypeOptions,
  after: LogicalTypeOptions,
  path: string,
  add: Add,
): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const o = before[key];
    const n = after[key];
    if (sameStructure(o, n)) continue;
    const at = `${path}.${key}`;
    if (o === undefined) add('additive', at, `constraint added: ${json(n)}`);
    else if (n === undefined) add('breaking', at, 'constraint removed');
    else if (
      typeof o === 'number' &&
      typeof n === 'number' &&
      LOWER_BOUNDS.has(key)
    )
      add(n > o ? 'additive' : 'breaking', at, `${o} → ${n}`);
    else if (
      typeof o === 'number' &&
      typeof n === 'number' &&
      UPPER_BOUNDS.has(key)
    )
      add(n < o ? 'additive' : 'breaking', at, `${o} → ${n}`);
    else add('breaking', at, `${json(o)} → ${json(n)}`);
  }
}

/** Rule identity: `id`, then `name`, then what it measures; numbered when two collide, so none is lost. */
function keyedRules(
  rules: QualityRule[] | undefined,
): Map<string, QualityRule> {
  const out = new Map<string, QualityRule>();
  for (const r of rules ?? []) {
    const base = String(
      r.id ??
        r.name ??
        `${r.type ?? 'library'}:${ruleMetric(r) ?? r.query ?? r.description ?? ''}`,
    );
    let key = base;
    for (let i = 2; out.has(key); i++) key = `${base}#${i}`;
    out.set(key, r);
  }
  return out;
}

type Direction = 'same' | 'stricter' | 'looser' | 'unknown';

/** The values a threshold accepts, as one interval; undefined for mustNotBe / mustNotBeBetween. */
function accepted(
  r: QualityRule,
): { lo: number; loIn: boolean; hi: number; hiIn: boolean } | undefined {
  if (r.mustNotBe !== undefined || r.mustNotBeBetween !== undefined)
    return undefined;
  let lo = -Infinity,
    loIn = false,
    hi = Infinity,
    hiIn = false;
  const raise = (v: number, inclusive: boolean) => {
    if (v > lo || (v === lo && !inclusive)) [lo, loIn] = [v, inclusive];
  };
  const lower = (v: number, inclusive: boolean) => {
    if (v < hi || (v === hi && !inclusive)) [hi, hiIn] = [v, inclusive];
  };
  if (typeof r.mustBe === 'number') {
    raise(r.mustBe, true);
    lower(r.mustBe, true);
  }
  if (r.mustBeGreaterThan !== undefined) raise(r.mustBeGreaterThan, false);
  if (r.mustBeGreaterOrEqualTo !== undefined)
    raise(r.mustBeGreaterOrEqualTo, true);
  if (r.mustBeLessThan !== undefined) lower(r.mustBeLessThan, false);
  if (r.mustBeLessOrEqualTo !== undefined) lower(r.mustBeLessOrEqualTo, true);
  if (r.mustBeBetween) {
    raise(r.mustBeBetween[0], true);
    lower(r.mustBeBetween[1], true);
  }
  return { lo, loIn, hi, hiIn };
}

function thresholdDirection(o: QualityRule, n: QualityRule): Direction {
  const a = accepted(o);
  const b = accepted(n);
  if (!a || !b)
    return sameStructure(thresholdOf(o), thresholdOf(n)) ? 'same' : 'unknown';
  const within = (x: typeof a, y: typeof a) =>
    (x.lo > y.lo || (x.lo === y.lo && (!x.loIn || y.loIn))) &&
    (x.hi < y.hi || (x.hi === y.hi && (!x.hiIn || y.hiIn)));
  if (within(a, b) && within(b, a)) return 'same';
  if (within(b, a)) return 'stricter';
  if (within(a, b)) return 'looser';
  return 'unknown';
}

const thresholdOf = (r: QualityRule) =>
  Object.fromEntries(THRESHOLD_KEYS.map((k) => [k, r[k]]));

/** Subset reading of a value list: fewer accepted values is stricter. */
function setDirection(
  o: unknown[] | undefined,
  n: unknown[] | undefined,
  fewerIsStricter: boolean,
): Direction {
  if (o === undefined && n === undefined) return 'same';
  if (o === undefined) return fewerIsStricter ? 'stricter' : 'looser'; // a restriction added
  if (n === undefined) return fewerIsStricter ? 'looser' : 'stricter';
  const has = (list: unknown[], v: unknown) =>
    list.some((x) => sameStructure(x, v));
  const nInO = n.every((v) => has(o, v));
  const oInN = o.every((v) => has(n, v));
  if (nInO && oInN) return 'same';
  if (nInO) return fewerIsStricter ? 'stricter' : 'looser';
  if (oInN) return fewerIsStricter ? 'looser' : 'stricter';
  // Some gained, some lost: the change that loosens is there either way.
  return 'looser';
}

const RULE_PROSE = new Set([
  'description',
  'name',
  'dimension',
  'severity',
  'tags',
  'businessImpact',
  'schedule',
  'scheduler',
  'method',
  'customProperties',
]);

/**
 * How a rule changed for the consumer, part by part. The argument directions
 * assume the threshold caps a count of bad values (the library metrics); for
 * any other threshold shape an argument change cannot be read, so it is
 * unknown, which is breaking.
 */
function compareRule(
  o: QualityRule,
  n: QualityRule,
): { level: ChangeLevel; review?: true; message: string } | undefined {
  const norm = (r: QualityRule) => {
    const { rule: _r, ...rest } = r;
    // No type is a library rule (ODCS default): writing it out changes nothing.
    return {
      ...rest,
      type: r.type ?? 'library',
      metric: ruleMetric(r),
    } as Record<string, unknown>;
  };
  const a = norm(o);
  const b = norm(n);
  if (sameStructure(a, b)) return undefined;
  const dirs: Array<[string, Direction]> = [];
  for (const k of ['type', 'metric', 'unit', 'query'])
    if (!sameStructure(a[k], b[k])) dirs.push([k, 'unknown']);
  dirs.push(['threshold', thresholdDirection(o, n)]);
  // A count is never below zero, so a lower bound at or under 0 (mustBe: 0) still only caps it.
  const capsBadCount = (r: QualityRule) => {
    const t = accepted(r);
    return t !== undefined && t.lo <= 0;
  };
  const oa = (o.arguments ?? {}) as Record<string, unknown>;
  const na = (n.arguments ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(oa), ...Object.keys(na)])) {
    if (sameStructure(oa[k], na[k])) continue;
    const list = (v: unknown) =>
      Array.isArray(v) ? v : v === undefined ? undefined : [v];
    const d: Direction =
      !capsBadCount(o) || !capsBadCount(n)
        ? 'unknown'
        : k === 'validValues'
          ? setDirection(list(oa[k]), list(na[k]), true)
          : k === 'missingValues'
            ? setDirection(list(oa[k]), list(na[k]), false) // counting more values as missing is stricter
            : k === 'pattern'
              ? oa[k] === undefined
                ? 'stricter'
                : na[k] === undefined
                  ? 'looser'
                  : 'unknown'
              : 'unknown'; // `properties` (a different key) or anything else
    dirs.push([`arguments.${k}`, d]);
  }
  const otherKeys = new Set(
    [...Object.keys(a), ...Object.keys(b)].filter(
      (k) =>
        ![
          'type',
          'metric',
          'unit',
          'query',
          'arguments',
          ...THRESHOLD_KEYS,
        ].includes(k),
    ),
  );
  let prose = false;
  let review = false;
  for (const k of otherKeys) {
    if (sameStructure(a[k], b[k])) continue;
    if (RULE_PROSE.has(k)) prose = true;
    else review = true;
  }
  const changed = dirs.filter(([, d]) => d !== 'same');
  const looser = changed.filter(([, d]) => d === 'looser' || d === 'unknown');
  if (looser.length)
    return {
      level: 'breaking',
      message: `weaker or unreadable: ${looser.map(([k, d]) => `${k} (${d})`).join(', ')}`,
    };
  if (changed.length)
    return {
      level: 'additive',
      message: `stricter: ${changed.map(([k]) => k).join(', ')}`,
    };
  if (review)
    return { level: 'patch', review: true, message: 'rule metadata changed' };
  return prose ? { level: 'patch', message: 'description changed' } : undefined;
}

function diffRules(
  before: QualityRule[] | undefined,
  after: QualityRule[] | undefined,
  path: string,
  add: Add,
): void {
  const o = keyedRules(before);
  const n = keyedRules(after);
  for (const [key, rule] of o) {
    const next = n.get(key);
    const at = `${path}.quality[${key}]`;
    if (next) {
      const c = compareRule(rule, next);
      if (c) add(c.level, at, c.message, c.review);
    } else add('breaking', at, 'quality rule removed');
  }
  for (const key of n.keys())
    if (!o.has(key))
      add('additive', `${path}.quality[${key}]`, 'quality rule added');
}

/** SemVer 2.0 precedence (§11): core numbers, then a pre-release sorts before its release; build metadata is ignored. */
export function compareSemver(a: string, b: string): number {
  const split = (v: string) => {
    const [core = '', pre] = v
      .replace(/^v/i, '')
      .split('+')[0]!
      .split(/-(.*)/s);
    return {
      core: core.split('.').map(Number),
      pre: pre === undefined ? undefined : pre.split('.'),
    };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++)
    if (x.core[i] !== y.core[i]) return x.core[i]! < y.core[i]! ? -1 : 1;
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1; // numeric identifiers sort first
    return p < q ? -1 : 1;
  }
  return 0;
}

export function bumpBetween(before: string, after: string): Bump {
  const a = parseSemver(before);
  const b = parseSemver(after);
  if (!a || !b) return 'none';
  if (b[0] !== a[0]) return b[0] > a[0] ? 'major' : 'none';
  if (b[1] !== a[1]) return b[1] > a[1] ? 'minor' : 'none';
  return b[2] > a[2] ? 'patch' : 'none';
}

export function formatDiff(diff: ContractDiff): string {
  if (diff.changes.length === 0)
    return diff.versionError
      ? `No changes, but ${diff.versionError}.`
      : 'No changes.';
  const icon = { breaking: '✖', additive: '+', patch: '·' };
  const lines = diff.changes.map(
    (c) => `${icon[c.level]} ${c.level.padEnd(8)} ${c.path}: ${c.message}`,
  );
  const review = diff.changes.filter((c) => c.review);
  if (review.length)
    lines.push(
      '',
      `Review by a person: ${review.map((c) => c.path).join(', ')}`,
    );
  lines.push(
    '',
    diff.versionError
      ? `Cannot judge the version bump: ${diff.versionError}.`
      : `Needs a ${diff.required} bump; the version moved ${diff.declared}.${diff.ok ? '' : ' Not enough.'}`,
  );
  return lines.join('\n');
}

export interface Satisfaction {
  /** Every expectation is met by a promise at least as strong. */
  ok: boolean;
  /** Expectations the provider does not promise, or promises more weakly. */
  unmet: ContractChange[];
  /** Differences a person should read (policy links, AI context). */
  review: ContractChange[];
}

type Entry = Record<string, unknown>;

const NOT_OFFERED: Record<string, string> = {
  'schema object removed': 'the provider offers no such object',
  'property removed': 'the provider offers no such property',
  'service level removed': 'the provider promises no such service level',
  'server removed': 'the provider has no such server',
  'role removed': 'the provider has no such role',
};

/** An expectation entry with what it leaves unsaid taken from the provider: only what it states is compared. */
function fillEntry(expected: Entry, offered: Entry): Entry {
  const out: Entry = { ...offered, ...expected };
  if (Array.isArray(expected.properties) && Array.isArray(offered.properties))
    out.properties = fillList(expected.properties, offered.properties, 'name');
  for (const key of ['items'] as const)
    if (isEntry(expected[key]) && isEntry(offered[key]))
      out[key] = fillEntry(expected[key], offered[key]);
  if (isEntry(expected.map) && isEntry(offered.map)) {
    const map: Entry = { ...offered.map, ...expected.map };
    for (const part of ['key', 'value'])
      if (isEntry(expected.map[part]) && isEntry(offered.map[part]))
        map[part] = fillEntry(expected.map[part], offered.map[part]);
    out.map = map;
  }
  return out;
}

const isEntry = (v: unknown): v is Entry =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function fillList(
  expected: Entry[],
  offered: Entry[] | undefined,
  key: string | ((e: Entry) => string),
): Entry[] {
  const id = typeof key === 'string' ? (e: Entry) => String(e[key]) : key;
  const byId = new Map((offered ?? []).map((e) => [id(e), e]));
  return expected.map((e) => {
    const match = byId.get(id(e));
    return match ? fillEntry(e, match) : e;
  });
}

/**
 * Consumer-driven contracts: does the provider's contract promise at least
 * what a consumer expects? The expectation is an ODCS contract the consumer
 * writes, stating only what it relies on (the objects and columns it reads,
 * types, required, valid values, SLAs, servers). What it leaves unsaid is not
 * expected. Read with the diff's own rules: an expectation the provider
 * weakens or lacks is unmet; a stronger promise, or one nobody expects, is fine.
 */
export function satisfies(
  provider: DataContract,
  expectation: DataContract,
): Satisfaction {
  const slaKey = (c: DataContract) => (s: Entry) =>
    `${String(s.property)}:${String(s.element ?? c.slaDefaultElement ?? '')}`;
  // An expected SLA names its element, so the provider's default cannot move it.
  const expectedSlas = (expectation.slaProperties ?? []).map((s) => {
    const element = s.element ?? expectation.slaDefaultElement;
    return element === undefined ? s : { ...s, element };
  });
  const filled: DataContract = {
    ...provider,
    schema: fillList(
      (expectation.schema ?? []) as Entry[],
      provider.schema as Entry[] | undefined,
      'name',
    ) as DataContract['schema'],
    slaProperties: fillList(
      expectedSlas as Entry[],
      provider.slaProperties as Entry[] | undefined,
      (s) => slaKey(provider)(s),
    ) as DataContract['slaProperties'],
    servers: expectation.servers
      ? fillList(expectation.servers, provider.servers, 'server')
      : provider.servers,
    roles: expectation.roles
      ? fillList(expectation.roles, provider.roles, 'role')
      : provider.roles,
  };
  const { changes } = diffContracts(filled, provider);
  const unmet = changes
    .filter((c) => c.level === 'breaking')
    .map((c) => ({ ...c, message: NOT_OFFERED[c.message] ?? c.message }));
  return {
    ok: unmet.length === 0,
    unmet,
    review: changes.filter((c) => c.review && c.level !== 'breaking'),
  };
}

export function formatSatisfaction(s: Satisfaction): string {
  const lines = s.unmet.map((c) => `✖ ${c.path}: ${c.message}`);
  if (s.review.length)
    lines.push(
      '',
      `Review by a person: ${s.review.map((c) => c.path).join(', ')}`,
    );
  lines.push(
    '',
    s.ok
      ? 'The provider promises everything expected.'
      : `${s.unmet.length} expectation${s.unmet.length === 1 ? '' : 's'} not met.`,
  );
  return lines.join('\n').trimStart();
}
