/**
 * Telemetry Policies (experimental)
 *
 * Implements the applier side of OTEP 4738 (`oteps/4738-telemetry-policy.md`):
 * small, independent, fail-open rules that decide what telemetry is kept and
 * how it is transformed. Policies are portable — the same JSON runs here, in a
 * Collector, or in any other conforming implementation.
 *
 * This is an *applier*, not an engine: policies compile down to the hooks
 * autotel already has (`spanFilter`, log record processors). No new pipeline.
 *
 * Supported stages:
 * - `trace.keep.percentage` — deterministic per-trace probabilistic sampling
 * - `log.keep` — `"all"` / `"none"` / a percentage
 * - `log.transform` — `remove` → `redact` → `rename` → `add` (spec order)
 *
 * Unsupported (policy is skipped, telemetry is not — per spec fail-open):
 * - `metric` targets
 * - `trace.keep.mode` / `sampling_precision` / `hash_seed` / `fail_closed`
 *   (OTEP 235 consistent-probability sampling; autotel's samplers are not
 *   consistent-probability yet)
 * - `event_attribute` / `link_trace_id` matchers
 *
 * @example
 * ```typescript
 * init({ service: 'api', policies: './policies' })
 * ```
 *
 * ```json
 * {
 *   "id": "drop-debug-logs",
 *   "log": { "match": [{ "log_field": "severity_text", "regex": "^(DEBUG|TRACE)$" }], "keep": "none" }
 * }
 * ```
 */

// namespace import for browser-bundler compat — see node-require.ts
import * as nodeFs from 'node:fs';
import path from 'node:path';
import type { AttributeValue, Context } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { AnyValue } from '@opentelemetry/api-logs';
import type { UnknownRecord } from './values';
import { asNumber, asRecord, nonEmptyString } from './values';

/** A path into an attribute. `"ccn"` and `["ccn"]` are equivalent. */
export type AttributePath = string | string[];

/**
 * A single ANDed matcher. Exactly one field selector and exactly one match
 * operator must be set. Regexes are RE2 in the spec but JS `RegExp` here —
 * see {@link MAX_MATCH_LENGTH}.
 */
export interface PolicyMatcher {
  // Field selector (exactly one)
  log_field?: string;
  trace_field?: string;
  span_attribute?: AttributePath;
  log_attribute?: AttributePath;
  resource_attribute?: AttributePath;
  scope_attribute?: AttributePath;
  span_kind?: string;
  span_status?: string;

  // Match operator (exactly one)
  exact?: string;
  regex?: string;
  exists?: boolean;
  starts_with?: string;
  ends_with?: string;
  contains?: string;

  negate?: boolean;
  case_insensitive?: boolean;
}

/** A field targeted by a transform operation. */
export interface PolicyField {
  log_field?: string;
  log_attribute?: AttributePath;
  resource_attribute?: AttributePath;
  scope_attribute?: AttributePath;
}

export interface PolicyLogTransform {
  remove?: PolicyField[];
  redact?: Array<PolicyField & { replacement?: string }>;
  rename?: Array<PolicyField & { to: string; upsert?: boolean }>;
  add?: Array<PolicyField & { value: string; upsert?: boolean }>;
}

export interface PolicyLogTarget {
  match: PolicyMatcher[];
  /** `"all"` (default), `"none"`, or a percentage (`"5.0"` or `5`). */
  keep?: string | number;
  transform?: PolicyLogTransform;
}

export interface PolicyTraceTarget {
  match: PolicyMatcher[];
  keep?: {
    /** 0-100. Omitted means keep all matching spans. */
    percentage?: number;
    mode?: string;
    sampling_precision?: number;
    hash_seed?: number;
    fail_closed?: boolean;
  };
}

/** A telemetry policy. Exactly one target must be set. */
export interface Policy {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  labels?: Record<string, string>;
  trace?: PolicyTraceTarget;
  log?: PolicyLogTarget;
  /** Recognised so it can be reported unsupported rather than silently ignored. */
  metric?: unknown;
}

/**
 * Values longer than this are not regex-matched (the matcher yields no match).
 *
 * The spec mandates RE2 for cross-implementation consistency; Node's `RegExp`
 * backtracks, so an untrusted log body plus a pathological pattern is a DoS.
 * Capping input bounds the damage without pulling in an RE2 binding.
 *
 * ponytail: length cap instead of a real RE2 engine — swap in a linear-time
 * matcher if policies ever run against fully untrusted patterns.
 */
export const MAX_MATCH_LENGTH = 4096;

let activePolicies: Policy[] = [];
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[autotel] ${message}`);
}

// --- validation -------------------------------------------------------------

const MATCH_OPERATORS = [
  'exact',
  'regex',
  'exists',
  'starts_with',
  'ends_with',
  'contains',
] as const;

const FIELD_SELECTORS = [
  'log_field',
  'trace_field',
  'span_attribute',
  'log_attribute',
  'resource_attribute',
  'scope_attribute',
  'span_kind',
  'span_status',
] as const;

/** How many of these keys the value actually sets. */
function countSet<TSource extends object>(
  source: TSource,
  keys: readonly string[],
): number {
  const present = new Set(
    Object.entries(source)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key),
  );
  return keys.filter((key) => present.has(key)).length;
}

/**
 * Returns a reason string if the policy cannot be applied, or undefined if it can.
 *
 * Per spec an implementation MAY support a subset of stages but MUST skip the
 * policy — never the telemetry — when it meets one it does not understand.
 */
export function unsupportedReason(policy: Policy): string | undefined {
  if (!policy || nonEmptyString(policy.id) === undefined) {
    return 'policy requires an id';
  }
  if (policy.metric !== undefined) return 'metric targets are not supported';

  const targets = countSet(policy, ['trace', 'log']);
  if (targets !== 1) return 'exactly one target (trace or log) must be set';

  const target = policy.trace ?? policy.log;
  if (!Array.isArray(target?.match) || target.match.length === 0) {
    return 'at least one matcher is required';
  }
  for (const matcher of target.match) {
    if (countSet(matcher, FIELD_SELECTORS) !== 1) {
      return 'each matcher must set exactly one field selector';
    }
    if (countSet(matcher, MATCH_OPERATORS) !== 1) {
      return 'each matcher must set exactly one match operator';
    }
  }

  if (policy.trace?.keep) {
    const { percentage, mode, sampling_precision, hash_seed, fail_closed } =
      policy.trace.keep;
    if (
      mode !== undefined ||
      sampling_precision !== undefined ||
      hash_seed !== undefined ||
      fail_closed !== undefined
    ) {
      return 'trace keep supports "percentage" only (consistent-probability sampling modes are not implemented)';
    }
    if (
      percentage !== undefined &&
      (asNumber(percentage) === undefined || percentage < 0 || percentage > 100)
    ) {
      return 'trace keep percentage must be between 0 and 100';
    }
  }

  return undefined;
}

// --- policy state -----------------------------------------------------------

/**
 * Replace the active policy set.
 *
 * Disabled policies are dropped (spec: they MUST be treated as if they do not
 * exist) and unsupported ones are skipped with a warning.
 */
export function setPolicies(policies: Policy[]): void {
  const accepted: Policy[] = [];
  for (const policy of policies ?? []) {
    if (policy?.enabled === false) continue;
    const reason = unsupportedReason(policy);
    if (reason) {
      warnOnce(
        `skip:${policy?.id ?? 'unknown'}:${reason}`,
        `policy "${policy?.id ?? 'unknown'}" skipped: ${reason}`,
      );
      continue;
    }
    accepted.push(policy);
  }
  activePolicies = accepted;
}

/** The currently active (validated, enabled) policies. */
export function getPolicies(): readonly Policy[] {
  return activePolicies;
}

export function clearPolicies(): void {
  activePolicies = [];
  warned.clear();
}

// --- matching ---------------------------------------------------------------

const regexCache = new Map<string, RegExp | null>();

function compileRegex(
  pattern: string,
  caseInsensitive: boolean,
): RegExp | null {
  const key = `${caseInsensitive ? 'i' : ''} ${pattern}`;
  const cached = regexCache.get(key);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(pattern, caseInsensitive ? 'i' : '');
  } catch {
    warnOnce(`regex:${key}`, `policy regex failed to compile: ${pattern}`);
  }
  regexCache.set(key, compiled);
  return compiled;
}

function joinPath(attributePath: AttributePath): string {
  return Array.isArray(attributePath) ? attributePath.join('.') : attributePath;
}

/**
 * A value read off a telemetry record, before a matcher looks at it: an
 * attribute, a span field, or a log body - which may itself be structured.
 */
type RecordValue = AttributeValue | AnyValue | UnknownRecord | undefined;

function toText(value: RecordValue): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((item) => String(item)).join(',');
  // A nested object has no single text form to match against.
  return asRecord(value) ? undefined : String(value);
}

/**
 * Signal-agnostic view of one telemetry record, so matchers work the same for
 * spans and log records.
 */
interface RecordView {
  field(name: string): RecordValue;
  attribute(path: string): RecordValue;
  resource(path: string): RecordValue;
  scope(path: string): RecordValue;
}

function matchesOperator(matcher: PolicyMatcher, raw: RecordValue): boolean {
  if (matcher.exists !== undefined) {
    return (raw !== undefined && raw !== null) === matcher.exists;
  }

  const text = toText(raw);
  if (text === undefined) return false;

  const insensitive = matcher.case_insensitive === true;
  const subject = insensitive ? text.toLowerCase() : text;
  const fold = (value: string) => (insensitive ? value.toLowerCase() : value);

  if (matcher.exact !== undefined) return subject === fold(matcher.exact);
  if (matcher.starts_with !== undefined) {
    return subject.startsWith(fold(matcher.starts_with));
  }
  if (matcher.ends_with !== undefined) {
    return subject.endsWith(fold(matcher.ends_with));
  }
  if (matcher.contains !== undefined) {
    return subject.includes(fold(matcher.contains));
  }
  if (matcher.regex !== undefined) {
    if (text.length > MAX_MATCH_LENGTH) return false;
    const compiled = compileRegex(matcher.regex, insensitive);
    return compiled ? compiled.test(text) : false;
  }
  return false;
}

function resolveField(matcher: PolicyMatcher, view: RecordView): RecordValue {
  if (matcher.log_field !== undefined) return view.field(matcher.log_field);
  if (matcher.trace_field !== undefined) return view.field(matcher.trace_field);
  if (matcher.span_kind !== undefined) return view.field('kind');
  if (matcher.span_status !== undefined) return view.field('status_code');
  if (matcher.span_attribute !== undefined) {
    return view.attribute(joinPath(matcher.span_attribute));
  }
  if (matcher.log_attribute !== undefined) {
    return view.attribute(joinPath(matcher.log_attribute));
  }
  if (matcher.resource_attribute !== undefined) {
    return view.resource(joinPath(matcher.resource_attribute));
  }
  if (matcher.scope_attribute !== undefined) {
    return view.scope(joinPath(matcher.scope_attribute));
  }
  return undefined;
}

/** All matchers are ANDed (spec). */
function matchesAll(matchers: PolicyMatcher[], view: RecordView): boolean {
  return matchers.every((matcher) => {
    const result = matchesOperator(matcher, resolveField(matcher, view));
    return matcher.negate === true ? !result : result;
  });
}

// --- keep decisions ---------------------------------------------------------

/** FNV-1a → [0, 1). Deterministic so every span in a trace decides alike. */
function hashUnitInterval(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

function parseKeep(keep: string | number | undefined): number {
  if (keep === undefined || keep === 'all') return 100;
  if (keep === 'none') return 0;
  const percentage = asNumber(keep) ?? Number.parseFloat(String(keep));
  if (Number.isNaN(percentage)) return 100;
  return Math.min(100, Math.max(0, percentage));
}

/**
 * Every matching policy contributes a keep value and the most restrictive wins
 * (spec). Returns 100 when nothing matched.
 */
function mostRestrictiveKeep(percentages: number[]): number {
  return percentages.length === 0 ? 100 : Math.min(...percentages);
}

function sampled(percentage: number, seed: string | undefined): boolean {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;
  const position = seed ? hashUnitInterval(seed) : Math.random();
  return position < percentage / 100;
}

// --- traces -----------------------------------------------------------------

function spanView(span: ReadableSpan): RecordView {
  return {
    field(name) {
      switch (name) {
        case 'name': {
          return span.name;
        }
        case 'trace_id': {
          return span.spanContext().traceId;
        }
        case 'span_id': {
          return span.spanContext().spanId;
        }
        case 'kind': {
          return span.kind;
        }
        case 'status_code': {
          return span.status.code;
        }
        case 'status_message': {
          return span.status.message;
        }
        default: {
          return undefined;
        }
      }
    },
    attribute: (key) => span.attributes[key],
    resource: (key) => span.resource.attributes[key],
    scope: (key) =>
      key === 'name' ? span.instrumentationScope.name : undefined,
  };
}

/**
 * A `SpanFilterPredicate` backed by the active policies. Returns true to keep.
 *
 * Fail-open: any error keeps the span.
 */
export function policySpanFilter(span: ReadableSpan): boolean {
  try {
    const view = spanView(span);
    const keeps: number[] = [];
    for (const policy of activePolicies) {
      if (!policy.trace) continue;
      if (!matchesAll(policy.trace.match, view)) continue;
      keeps.push(policy.trace.keep?.percentage ?? 100);
    }
    return sampled(mostRestrictiveKeep(keeps), span.spanContext().traceId);
  } catch (error) {
    warnOnce(
      'trace-eval',
      `policy evaluation failed for a span, keeping it: ${String(error)}`,
    );
    return true;
  }
}

// --- logs -------------------------------------------------------------------

function logView(record: SdkLogRecord): RecordView {
  return {
    field(name) {
      switch (name) {
        case 'body': {
          return record.body;
        }
        case 'severity_text': {
          return record.severityText;
        }
        case 'severity_number': {
          return record.severityNumber;
        }
        case 'event_name': {
          // SAFETY: `eventName` is on the log record in newer SDK versions
          // and absent in older ones; reading it this way answers undefined
          // rather than failing to compile against either.
          return (record as { eventName?: string }).eventName;
        }
        case 'trace_id': {
          return record.spanContext?.traceId;
        }
        case 'span_id': {
          return record.spanContext?.spanId;
        }
        default: {
          return undefined;
        }
      }
    },
    attribute: (key) => record.attributes?.[key],
    resource: (key) => record.resource?.attributes?.[key],
    scope: (key) =>
      key === 'name' ? record.instrumentationScope?.name : undefined,
  };
}

function applyField(
  record: SdkLogRecord,
  field: PolicyField,
  apply: (target: UnknownRecord, key: string) => void,
  applyBody: () => void,
): void {
  if (field.log_field === 'body') {
    applyBody();
    return;
  }
  if (field.log_attribute !== undefined) {
    // SAFETY: the policy rewrites one named attribute in place; OTel's
    // Attributes is a bag of the same keys, read here as one to write into.
    apply(record.attributes as UnknownRecord, joinPath(field.log_attribute));
  }
  // resource/scope attributes are shared across records — mutating them would
  // leak across log records, so they are left alone.
}

function applyTransform(
  record: SdkLogRecord,
  transform: PolicyLogTransform,
): void {
  // Fixed spec order: remove → redact → rename → add
  for (const field of transform.remove ?? []) {
    applyField(
      record,
      field,
      (attributes, key) => {
        delete attributes[key];
      },
      () => {
        record.body = undefined;
      },
    );
  }

  for (const field of transform.redact ?? []) {
    const replacement = field.replacement ?? '[REDACTED]';
    applyField(
      record,
      field,
      (attributes, key) => {
        if (key in attributes) attributes[key] = replacement;
      },
      () => {
        record.body = replacement;
      },
    );
  }

  for (const field of transform.rename ?? []) {
    applyField(
      record,
      field,
      (attributes, key) => {
        if (!(key in attributes)) return;
        if (key in attributes && field.to in attributes && !field.upsert) {
          return;
        }
        attributes[field.to] = attributes[key];
        delete attributes[key];
      },
      () => {
        // renaming the body has no meaning
      },
    );
  }

  for (const field of transform.add ?? []) {
    applyField(
      record,
      field,
      (attributes, key) => {
        if (key in attributes && field.upsert !== true) return;
        attributes[key] = field.value;
      },
      () => {
        if (record.body === undefined || field.upsert === true) {
          record.body = field.value;
        }
      },
    );
  }
}

/**
 * Applies `log` policies — keep first, then transform (spec stage order).
 *
 * Fail-open: any error emits the record unmodified.
 */
export class PolicyLogRecordProcessor implements LogRecordProcessor {
  constructor(private readonly wrapped: LogRecordProcessor) {}

  onEmit(logRecord: SdkLogRecord, context?: Context): void {
    try {
      const view = logView(logRecord);
      const keeps: number[] = [];
      const transforms: PolicyLogTransform[] = [];

      for (const policy of activePolicies) {
        if (!policy.log) continue;
        if (!matchesAll(policy.log.match, view)) continue;
        keeps.push(parseKeep(policy.log.keep));
        if (policy.log.transform) transforms.push(policy.log.transform);
      }

      if (
        !sampled(mostRestrictiveKeep(keeps), logRecord.spanContext?.traceId)
      ) {
        return;
      }
      for (const transform of transforms) applyTransform(logRecord, transform);
    } catch (error) {
      warnOnce(
        'log-eval',
        `policy evaluation failed for a log record, keeping it: ${String(error)}`,
      );
    }
    this.wrapped.onEmit(logRecord, context);
  }

  shutdown(): Promise<void> {
    return this.wrapped.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.wrapped.forceFlush();
  }
}

/** True when any active policy targets logs — used to skip wrapping otherwise. */
export function hasLogPolicies(): boolean {
  return activePolicies.some((policy) => policy.log !== undefined);
}

// --- file provider ----------------------------------------------------------

function readPolicyFile(filePath: string): Policy[] {
  const parsed: unknown = JSON.parse(nodeFs.readFileSync(filePath, 'utf8'));
  // SAFETY: a policy file states policies; unsupportedReason() below is what
  // actually checks each one, and a file holding something else is reported
  // as unsupported rather than trusted.
  return Array.isArray(parsed) ? (parsed as Policy[]) : [parsed as Policy];
}

/**
 * Load every policy from a `.json` file, or from every `.json` file in a
 * directory.
 *
 * Fail-open: an unreadable or malformed file yields no policies from that file
 * and warns; it never throws.
 */
export function loadPolicies(target: string): Policy[] {
  const resolved = path.resolve(target);
  let files: string[];
  try {
    files = nodeFs.statSync(resolved).isDirectory()
      ? nodeFs
          .readdirSync(resolved)
          .filter((entry) => entry.endsWith('.json'))
          .map((entry) => path.join(resolved, entry))
      : [resolved];
  } catch (error) {
    warnOnce(
      `read:${resolved}`,
      `could not read policies from ${resolved}: ${String(error)}`,
    );
    return [];
  }

  const policies: Policy[] = [];
  for (const file of files) {
    try {
      policies.push(...readPolicyFile(file));
    } catch (error) {
      warnOnce(
        `parse:${file}`,
        `could not parse policy file ${file}: ${String(error)}`,
      );
    }
  }
  return policies;
}

/**
 * The file policy provider: load `target` now and reload on change.
 *
 * Policies are expected to change outside the lifecycle of the process, so the
 * watcher is what makes them dynamic. The watcher is unref'd — it never holds
 * the process open.
 *
 * @returns a function that stops watching
 */
export function watchPolicyFile(target: string): () => void {
  const resolved = path.resolve(target);
  const reload = () => {
    setPolicies(loadPolicies(resolved));
  };
  reload();

  try {
    const watcher = nodeFs.watch(resolved, { persistent: false }, reload);
    watcher.on('error', () => {
      // fail-open: stop watching, keep the policies we already have
    });
    return () => {
      watcher.close();
    };
  } catch (error) {
    warnOnce(
      `watch:${resolved}`,
      `could not watch ${resolved} for policy changes: ${String(error)}`,
    );
    return () => {};
  }
}
