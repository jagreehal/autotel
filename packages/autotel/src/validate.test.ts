import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trace } from '@opentelemetry/api';

const counterAdd = vi.hoisted(() => vi.fn());
vi.mock('./metric-helpers', () => ({
  createCounter: () => ({ add: counterAdd }),
}));

import {
  defineValidator,
  recordValidationMismatch,
  formatValidationIssues,
  onValidationMismatch,
  type ValidationMismatch,
} from './validate';
import { VALIDATION_ATTR } from './validation-attributes';

/** A fake `SchemaLike` so tests don't depend on Zod. */
function schema<T>(
  decide: (input: unknown) => { success: true; data: T } | { success: false; error: unknown },
) {
  return { safeParse: decide };
}

/** A Zod-shaped error whose message/received embed a secret value. */
const SECRET = '123-45-6789';
const zodLikeError = {
  issues: [
    {
      path: ['user', 'ssn'],
      code: 'invalid_type',
      expected: 'string',
      received: SECRET, // value — must never escape
      message: `Expected string, received ${SECRET}`, // value — must never escape
    },
  ],
};

let setAttributes: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setAttributes = vi.fn();
  vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
    setAttributes,
  } as never);
  counterAdd.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatValidationIssues — PII guard', () => {
  it('keeps only path, code, and declared type — never values or messages', () => {
    const issues = formatValidationIssues(zodLikeError);
    expect(issues).toEqual([
      { path: 'user.ssn', code: 'invalid_type', expected: 'string' },
    ]);
    // The secret must not appear anywhere in the serialized output.
    expect(JSON.stringify(issues)).not.toContain(SECRET);
  });

  it('handles a generic { errors: [...] } shape', () => {
    const issues = formatValidationIssues({
      errors: [{ path: ['a'], code: 'custom' }],
    });
    expect(issues).toEqual([{ path: 'a', code: 'custom' }]);
  });

  it('returns [] for unrecognised errors', () => {
    expect(formatValidationIssues(new Error('boom'))).toEqual([]);
    expect(formatValidationIssues()).toEqual([]);
    expect(formatValidationIssues('nope')).toEqual([]);
  });

  it('defaults a missing code and root path', () => {
    expect(formatValidationIssues({ issues: [{}] })).toEqual([
      { path: '', code: 'invalid' },
    ]);
  });
});

describe('recordValidationMismatch', () => {
  const mismatch: ValidationMismatch = {
    name: 'POST /orders',
    boundary: 'http',
    mode: 'reject',
    issues: [
      { path: 'a', code: 'invalid_type' },
      { path: 'b', code: 'too_small' },
      { path: 'c', code: 'invalid_type' },
    ],
    hash: 'abc123',
    severity: 'warning',
  };

  it('sets validation.* attributes on the active span', () => {
    recordValidationMismatch(mismatch);
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        [VALIDATION_ATTR.name]: 'POST /orders',
        [VALIDATION_ATTR.boundary]: 'http',
        [VALIDATION_ATTR.mode]: 'reject',
        [VALIDATION_ATTR.issueCount]: 3,
        [VALIDATION_ATTR.issuePaths]: 'a,b,c',
        [VALIDATION_ATTR.issueCodes]: 'invalid_type,too_small', // deduped
        [VALIDATION_ATTR.hash]: 'abc123',
        [VALIDATION_ATTR.severity]: 'warning',
      }),
    );
  });

  it('increments the mismatch counter with boundary/validation/mode labels', () => {
    recordValidationMismatch(mismatch);
    expect(counterAdd).toHaveBeenCalledWith(1, {
      boundary: 'http',
      validation: 'POST /orders',
      mode: 'reject',
    });
  });

  it('skips span attributes when there is no active span (fail-open)', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue();
    expect(() => recordValidationMismatch(mismatch)).not.toThrow();
  });

  it('never throws even if the span sink throws', () => {
    setAttributes.mockImplementation(() => {
      throw new Error('span boom');
    });
    expect(() => recordValidationMismatch(mismatch)).not.toThrow();
  });
});

describe('onValidationMismatch', () => {
  const mismatch = (name: string): ValidationMismatch => ({
    name,
    boundary: 'event',
    mode: 'observe',
    issues: [],
  });

  // The listener registry is module-global; track every unsubscribe so a test
  // can't leak a subscriber into the next one.
  const cleanups: Array<() => void> = [];
  const register = (handler: (m: ValidationMismatch) => void) => {
    const off = onValidationMismatch(handler);
    cleanups.push(off);
    return off;
  };
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!();
  });

  it('invokes a registered listener and can unsubscribe', () => {
    const seen: ValidationMismatch[] = [];
    const off = register((m) => seen.push(m));
    recordValidationMismatch(mismatch('x'));
    expect(seen).toHaveLength(1);
    off();
    recordValidationMismatch(mismatch('y'));
    expect(seen).toHaveLength(1); // not called after unsubscribe
  });

  it('delivers each mismatch to every simultaneous subscriber', () => {
    // The real case: autotel-audit registers a security bridge while the app
    // registers its own webhook/logger — both must fire.
    const audit: string[] = [];
    const webhook: string[] = [];
    register((m) => audit.push(m.name));
    register((m) => webhook.push(m.name));

    recordValidationMismatch(mismatch('POST /login'));

    expect(audit).toEqual(['POST /login']);
    expect(webhook).toEqual(['POST /login']);
  });

  it('unsubscribes each subscriber independently', () => {
    const a: string[] = [];
    const b: string[] = [];
    const offA = register((m) => a.push(m.name));
    register((m) => b.push(m.name));

    recordValidationMismatch(mismatch('first'));
    offA(); // remove only A
    recordValidationMismatch(mismatch('second'));

    expect(a).toEqual(['first']); // A stopped after unsubscribe
    expect(b).toEqual(['first', 'second']); // B keeps firing
  });

  it('isolates faults: a throwing subscriber neither throws nor starves peers', () => {
    const survivor: string[] = [];
    register(() => {
      throw new Error('subscriber boom');
    });
    register((m) => survivor.push(m.name));

    expect(() => recordValidationMismatch(mismatch('z'))).not.toThrow();
    expect(survivor).toEqual(['z']); // the healthy subscriber still fired
  });

  it('treats a re-registered identical handler as a single subscription', () => {
    const seen: string[] = [];
    const handler = (m: ValidationMismatch) => seen.push(m.name);
    register(handler);
    register(handler); // Set semantics → still one
    recordValidationMismatch(mismatch('once'));
    expect(seen).toEqual(['once']);
  });
});

describe('defineValidator', () => {
  const ok = schema<{ a: number }>(() => ({ success: true, data: { a: 1 } }));
  const bad = schema<{ a: number }>(() => ({
    success: false,
    error: zodLikeError,
  }));

  it('reject mode (default): records then throws a 400 structured error', () => {
    const v = defineValidator('POST /orders', bad, { boundary: 'http' });
    expect(v.mode).toBe('reject');
    try {
      v.parse({ user: { ssn: SECRET } });
      throw new Error('should have thrown');
    } catch (error) {
      const e = error as { status?: number; code?: string; message: string };
      expect(e.status).toBe(400);
      expect(e.code).toBe('validation_failed');
      // even the thrown error must not leak the value
      expect(JSON.stringify({ m: e.message })).not.toContain(SECRET);
    }
    expect(setAttributes).toHaveBeenCalled();
  });

  it('observe mode: records then returns the raw input (no throw)', () => {
    const v = defineValidator('order.placed', bad, {
      boundary: 'event',
      onMismatch: 'observe',
    });
    const raw = { user: { ssn: SECRET } };
    expect(v.parse(raw)).toBe(raw);
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ [VALIDATION_ATTR.mode]: 'observe' }),
    );
  });

  it('returns parsed data and records nothing on success', () => {
    const v = defineValidator('ok', ok);
    expect(v.parse({})).toEqual({ a: 1 });
    expect(setAttributes).not.toHaveBeenCalled();
    expect(counterAdd).not.toHaveBeenCalled();
  });

  it('safeParse returns a discriminated result and never throws', () => {
    const v = defineValidator('POST /orders', bad);
    const result = v.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]).toEqual({
        path: 'user.ssn',
        code: 'invalid_type',
        expected: 'string',
      });
    }
  });

  it('honors a custom onReject error builder', () => {
    const v = defineValidator('x', bad, {
      onReject: () => new Error('custom reject'),
    });
    expect(() => v.parse({})).toThrow('custom reject');
  });

  it('emits a stable validation.hash when toJsonSchema is provided', () => {
    const v = defineValidator('x', bad, {
      toJsonSchema: () => ({ type: 'object' }),
    });
    v.safeParse({});
    const attrs = setAttributes.mock.calls[0][0];
    expect(typeof attrs[VALIDATION_ATTR.hash]).toBe('string');
    expect(attrs[VALIDATION_ATTR.hash]).toHaveLength(64); // sha256 hex
  });
});
