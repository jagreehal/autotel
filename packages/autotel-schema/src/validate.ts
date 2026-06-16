/**
 * Pure span-vs-contract validation. No SDK, no side effects — the same engine
 * the runtime processor ({@link ./processor}) and any test harness can call.
 */

import {
  allowsAdditionalAttributes,
  resolveAttributeSpec,
  type AttributeSpec,
  type AttributeType,
  type TelemetryContract,
} from './contract.js';

/** Severity of a contract violation. `error` = a breaking-shaped problem. */
export type ViolationSeverity = 'error' | 'warning';

export type ViolationCode =
  | 'unknown_span'
  | 'unknown_attribute'
  | 'type_mismatch'
  | 'missing_required'
  | 'deprecated_attribute'
  | 'enum_violation';

/** A single discrepancy between an emitted span and the contract. */
export interface SchemaViolation {
  code: ViolationCode;
  severity: ViolationSeverity;
  spanName: string;
  /** Attribute key involved, when the violation is attribute-scoped. */
  attribute?: string;
  message: string;
  /** Nearest declared key, for likely typos (`unknown_attribute` only). */
  suggestion?: string;
}

/** Minimal emitted-span shape — avoids a hard dependency on the OTel SDK. */
export interface SpanShape {
  name: string;
  attributes: Record<string, unknown>;
}

export interface ValidateOptions {
  /** Report `unknown_span` for span names not in the contract. Default `false`. */
  strictSpanNames?: boolean;
}

/** `'empty[]'` is a distinct marker: an empty array satisfies any array type. */
function actualType(value: unknown): AttributeType | 'empty[]' | 'unknown' {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    const first = value.find((v) => v !== null && v !== undefined);
    if (first === undefined) return 'empty[]';
    if (typeof first === 'string') return 'string[]';
    if (typeof first === 'number') return 'number[]';
    if (typeof first === 'boolean') return 'boolean[]';
  }
  return 'unknown';
}

function typeMatches(expected: AttributeType, value: unknown): boolean {
  const actual = actualType(value);
  if (actual === 'unknown') return false;
  if (actual === 'empty[]') return expected.endsWith('[]');
  return actual === expected;
}

/** Levenshtein distance — small, allocation-light, good enough for key typos. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = Array.from<number>({ length: n + 1 });
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Closest declared key to `key`, when one is within a small edit distance.
 * Turns "you emitted an attribute I don't know" into "did you mean `user.id`?".
 */
function nearestKey(key: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  const threshold = Math.max(1, Math.floor(key.length / 4) + 1);
  for (const candidate of candidates) {
    const d = editDistance(key, candidate);
    if (d < bestDistance && d <= threshold) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function declaredKeysFor(
  contract: TelemetryContract,
  spanName: string,
): string[] {
  return [
    ...Object.keys(contract.spans[spanName]?.attributes ?? {}),
    ...Object.keys(contract.commonAttributes ?? {}),
  ];
}

function checkValue(
  spanName: string,
  key: string,
  value: unknown,
  spec: AttributeSpec,
  out: SchemaViolation[],
): void {
  if (!typeMatches(spec.type, value)) {
    out.push({
      code: 'type_mismatch',
      severity: 'error',
      spanName,
      attribute: key,
      message: `attribute "${key}" should be ${spec.type} but got ${actualType(value)}`,
    });
    return; // a wrong type makes enum/deprecation checks noise
  }
  if (spec.enum && (typeof value === 'string' || typeof value === 'number') && !spec.enum.includes(value)) {
      out.push({
        code: 'enum_violation',
        severity: 'error',
        spanName,
        attribute: key,
        message: `attribute "${key}" value ${JSON.stringify(value)} is not one of ${JSON.stringify(spec.enum)}`,
      });
    }
  if (spec.stability === 'deprecated') {
    const hint = spec.replacedBy
      ? ` — use "${spec.replacedBy}" instead`
      : spec.deprecatedReason
        ? ` — ${spec.deprecatedReason}`
        : '';
    out.push({
      code: 'deprecated_attribute',
      severity: 'warning',
      spanName,
      attribute: key,
      message: `attribute "${key}" is deprecated${hint}`,
      suggestion: spec.replacedBy,
    });
  }
}

/**
 * Validate one emitted span against the contract, returning every discrepancy.
 * Order is deterministic: required-but-missing first, then per-attribute checks
 * in attribute insertion order.
 */
export function validateSpan(
  span: SpanShape,
  contract: TelemetryContract,
  options: ValidateOptions = {},
): SchemaViolation[] {
  const out: SchemaViolation[] = [];
  const spanSpec = contract.spans[span.name];

  if (!spanSpec) {
    if (options.strictSpanNames) {
      out.push({
        code: 'unknown_span',
        severity: 'warning',
        spanName: span.name,
        message: `span "${span.name}" is not declared in the contract`,
      });
    }
    return out; // unknown span → no attribute contract to check against
  }

  // Required attributes that never showed up.
  const required = [
    ...Object.entries(spanSpec.attributes ?? {}),
    ...Object.entries(contract.commonAttributes ?? {}),
  ].filter(([, spec]) => spec.required);
  for (const [key] of required) {
    if (!(key in span.attributes)) {
      out.push({
        code: 'missing_required',
        severity: 'error',
        spanName: span.name,
        attribute: key,
        message: `required attribute "${key}" is missing`,
      });
    }
  }

  const allowExtra = allowsAdditionalAttributes(contract, span.name);
  const declared = allowExtra ? [] : declaredKeysFor(contract, span.name);

  for (const [key, value] of Object.entries(span.attributes)) {
    if (value === null || value === undefined) continue;
    const spec = resolveAttributeSpec(contract, span.name, key);
    if (!spec) {
      if (!allowExtra) {
        out.push({
          code: 'unknown_attribute',
          severity: 'warning',
          spanName: span.name,
          attribute: key,
          message: `attribute "${key}" is not declared on span "${span.name}"`,
          suggestion: nearestKey(key, declared),
        });
      }
      continue;
    }
    checkValue(span.name, key, value, spec, out);
  }

  return out;
}

/** `true` when any violation is `error` severity. */
export function hasErrors(violations: SchemaViolation[]): boolean {
  return violations.some((v) => v.severity === 'error');
}

/** One-line human/agent-readable rendering of a violation. */
export function formatViolation(v: SchemaViolation): string {
  const where = v.attribute ? `${v.spanName}.${v.attribute}` : v.spanName;
  const suffix = v.suggestion ? ` (did you mean "${v.suggestion}"?)` : '';
  return `[${v.severity}] ${v.code} @ ${where}: ${v.message}${suffix}`;
}
