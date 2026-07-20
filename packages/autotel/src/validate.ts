/**
 * Validation telemetry — connect runtime input validation (Zod or any
 * `safeParse` schema) to your traces and metrics at the boundaries where bad
 * data actually enters: HTTP bodies, events, messages.
 *
 * Today a `safeParse` failure either throws (no span, no metric, no alert) or
 * is silently swallowed in a handler. `defineValidator` makes the mismatch
 * **observable** — a `validation.*` span attribute set and a counter
 * incremented — with a per-validator `observe` vs `reject` mode:
 *
 * - `reject` (default): record telemetry, then throw a structured 400-shaped
 *   error so the boundary can fail cleanly.
 * - `observe`: record telemetry, return the raw input so the handler continues
 *   — useful for measuring real-world drift before you enforce it.
 *
 * **Not a security feature by default.** A malformed body is usually a bug or
 * version skew, not an attack. Validation telemetry is first-class on its own
 * metric; escalation to the security path is a deliberate opt-in via
 * {@link onValidationMismatch} (e.g. wired by `autotel-audit`), never automatic.
 *
 * **PII-safe by construction.** Only field *paths*, issue *codes*, and the
 * declared *type* are ever recorded — never the offending value, and never a
 * validator's error `message` (which routinely embeds the received value).
 */

import { trace } from '@opentelemetry/api';
import { createCounter } from './metric-helpers';
import {
  createStructuredError,
  type StructuredError,
} from './structured-error';
import { hashJson } from './stable-hash';
import type { SchemaLike } from './define-event';
import {
  VALIDATION_ATTR,
  VALIDATION_ISSUE_CAP,
  VALIDATION_METRICS,
} from './validation-attributes';

export type { SchemaLike } from './define-event';

export type ValidationMode = 'observe' | 'reject';
export type ValidationSeverity = 'info' | 'warning' | 'error';

/** A single failing field, stripped of any payload values. */
export interface ValidationIssue {
  /** Dotted field path, e.g. `items.0.price`. Never a value. */
  path: string;
  /** Issue code (e.g. Zod's `invalid_type`, `too_small`). Never a value. */
  code: string;
  /** Declared type/constraint summary, e.g. `string`. Never a received value. */
  expected?: string;
}

/** Everything the recorder needs — already PII-stripped by the caller. */
export interface ValidationMismatch {
  /** Contract id, e.g. `POST /orders` or `order.placed`. */
  name: string;
  boundary: string;
  mode: ValidationMode;
  issues: ValidationIssue[];
  hash?: string;
  severity?: ValidationSeverity;
}

let mismatchCounter: ReturnType<typeof createCounter> | undefined;
function counter(): ReturnType<typeof createCounter> {
  if (!mismatchCounter) {
    mismatchCounter = createCounter(VALIDATION_METRICS.mismatches, {
      description: 'Input payloads that did not match their declared shape',
    });
  }
  return mismatchCounter;
}

type MismatchListener = (mismatch: ValidationMismatch) => void;
const listeners = new Set<MismatchListener>();

/**
 * Register an explicit handler called on every recorded mismatch — the opt-in
 * seam for escalating to security events, a webhook, or a custom sink. There is
 * no automatic, package-presence-driven escalation: nothing fires here unless
 * you (or a package you wire up) register a handler.
 *
 * Multiple subscribers coexist: a package (e.g. `autotel-audit` bridging to
 * security events) and your own app code (a webhook, a logger) can both
 * register and all fire. Returns an unsubscribe fn that removes only this
 * handler; registering the same function twice is a no-op (Set semantics).
 */
export function onValidationMismatch(handler: MismatchListener): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

const truncate = (values: string[]): string =>
  values.slice(0, VALIDATION_ISSUE_CAP).join(',');

/**
 * Record a validation mismatch as telemetry: `validation.*` attributes on the
 * active span (if any) and an increment on `autotel.validation.mismatches`.
 * Fail-open — never throws, so instrumentation can't break the boundary.
 */
export function recordValidationMismatch(mismatch: ValidationMismatch): void {
  try {
    const paths = mismatch.issues.map((i) => i.path).filter(Boolean);
    const codes = [...new Set(mismatch.issues.map((i) => i.code))];

    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes({
        [VALIDATION_ATTR.name]: mismatch.name,
        [VALIDATION_ATTR.boundary]: mismatch.boundary,
        [VALIDATION_ATTR.mode]: mismatch.mode,
        [VALIDATION_ATTR.issueCount]: mismatch.issues.length,
        [VALIDATION_ATTR.issuePaths]: truncate(paths),
        [VALIDATION_ATTR.issueCodes]: truncate(codes),
        ...(mismatch.hash ? { [VALIDATION_ATTR.hash]: mismatch.hash } : {}),
        ...(mismatch.severity
          ? { [VALIDATION_ATTR.severity]: mismatch.severity }
          : {}),
      });
    }

    try {
      counter().add(1, {
        boundary: mismatch.boundary,
        validation: mismatch.name,
        mode: mismatch.mode,
      });
    } catch {
      // meter not initialised yet — skip the count, keep the span attrs
    }

    // Dispatch to every subscriber with per-listener fault isolation: one
    // throwing subscriber must not starve its peers or break the boundary.
    // Set iteration tolerates concurrent (un)subscription safely.
    for (const listener of listeners) {
      try {
        listener(mismatch);
      } catch {
        // a misbehaving subscriber must not break the boundary or its peers
      }
    }
  } catch {
    // fail-open: telemetry must never break the validated boundary
  }
}

/**
 * Normalise an arbitrary validation error into PII-safe issues. Reads only
 * `path`, `code`, and (when it is a declared type name) `expected` — and never
 * `message`, `received`, or any value-bearing field. Understands the Zod shape
 * (`error.issues`) and a generic `error.errors` fallback; returns `[]` for
 * anything unrecognised.
 */
export function formatValidationIssues(error: unknown): ValidationIssue[] {
  const raw = extractRawIssues(error);
  return raw.map((issue) => toSafeIssue(issue));
}

function extractRawIssues(error: unknown): Array<Record<string, unknown>> {
  if (error && typeof error === 'object') {
    const candidate =
      (error as { issues?: unknown }).issues ??
      (error as { errors?: unknown }).errors;
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (i): i is Record<string, unknown> =>
          i !== null && typeof i === 'object',
      );
    }
  }
  return [];
}

function toSafeIssue(issue: Record<string, unknown>): ValidationIssue {
  const rawPath = issue.path;
  const path = Array.isArray(rawPath)
    ? rawPath.map(String).join('.')
    : typeof rawPath === 'string'
      ? rawPath
      : '';
  const code = typeof issue.code === 'string' ? issue.code : 'invalid';
  // `expected` is a declared type name in Zod (e.g. 'string'); safe. We never
  // read `received`/`message`/`value`, which can carry the offending payload.
  const expected =
    typeof issue.expected === 'string' ? issue.expected : undefined;
  return expected ? { path, code, expected } : { path, code };
}

export interface DefineValidatorOptions<S> {
  /** Where validation runs. Defaults to `input`. */
  boundary?: string;
  /** `reject` (default): record then throw. `observe`: record then continue. */
  onMismatch?: ValidationMode;
  /** Project the schema to JSON Schema for a stable `validation.hash`. */
  toJsonSchema?: (schema: S) => unknown;
  severity?: ValidationSeverity;
  /** Build the error thrown in `reject` mode (defaults to a 400 structured error). */
  onReject?: (issues: ValidationIssue[], name: string) => Error;
}

export type ValidatorResult<T> =
  { success: true; data: T } | { success: false; issues: ValidationIssue[] };

export interface Validator<T> {
  readonly name: string;
  readonly mode: ValidationMode;
  /** Validate and record on failure; never throws. */
  safeParse(input: unknown): ValidatorResult<T>;
  /**
   * Validate, record on failure, then apply the mode: `reject` throws,
   * `observe` returns the raw input so the handler can continue.
   */
  parse(input: unknown): T;
}

function defaultRejectError(
  issues: ValidationIssue[],
  name: string,
): StructuredError {
  return createStructuredError({
    name: 'ValidationError',
    status: 400,
    code: 'validation_failed',
    message: `Input for "${name}" did not match its declared shape.`,
    why: `${issues.length} field(s) failed validation: ${issues
      .map((i) => i.path || '(root)')
      .slice(0, VALIDATION_ISSUE_CAP)
      .join(', ')}.`,
    fix: 'Send a payload that matches the schema, or switch this validator to observe mode while you investigate.',
    // PII-safe: paths + codes only, no received values.
    details: { validation: name, issues },
  });
}

/**
 * Declare an expected input shape once and get a validator that records every
 * mismatch as telemetry.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { defineValidator } from 'autotel/validate';
 *
 * const OrderBody = defineValidator('POST /orders', z.object({
 *   items: z.array(z.object({ sku: z.string(), qty: z.number().int() })),
 * }), { boundary: 'http', toJsonSchema: (s) => z.toJSONSchema(s) });
 *
 * // reject mode (default): records + throws a 400-shaped structured error
 * const order = OrderBody.parse(req.body);
 *
 * // observe mode: records, returns the result, never throws
 * const result = OrderBody.safeParse(req.body);
 * if (!result.success) metrics.onDrift(result.issues);
 * ```
 */
export function defineValidator<T, S extends SchemaLike<T>>(
  name: string,
  schema: S,
  options: DefineValidatorOptions<S> = {},
): Validator<T> {
  const mode = options.onMismatch ?? 'reject';
  const boundary = options.boundary ?? 'input';
  const hash = options.toJsonSchema
    ? hashJson(options.toJsonSchema(schema))
    : undefined;

  const record = (issues: ValidationIssue[]): void => {
    recordValidationMismatch({
      name,
      boundary,
      mode,
      issues,
      hash,
      severity: options.severity,
    });
  };

  return {
    name,
    mode,
    safeParse(input: unknown): ValidatorResult<T> {
      const parsed = schema.safeParse(input);
      if (parsed.success) return { success: true, data: parsed.data };
      const issues = formatValidationIssues(parsed.error);
      record(issues);
      return { success: false, issues };
    },
    parse(input: unknown): T {
      const parsed = schema.safeParse(input);
      if (parsed.success) return parsed.data;
      const issues = formatValidationIssues(parsed.error);
      record(issues);
      if (mode === 'reject') {
        throw (
          options.onReject?.(issues, name) ?? defaultRejectError(issues, name)
        );
      }
      // observe: continue with the raw input (documented type caveat)
      return input as T;
    },
  };
}
