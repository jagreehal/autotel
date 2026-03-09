# Error Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full error tracking to autotel-web (benefits all users) and wire PostHog integration via `init({ posthog: { url } })` and `PostHogSubscriber.captureException()`.

**Architecture:** Three layers  - (1) autotel-web gets rich error capture with stack parsing, exception chains, rate limiting, suppression; (2) autotel core gets `posthog: { url }` / `POSTHOG_LOGS_URL` env var that auto-wires OTLP log exporter; (3) PostHogSubscriber gets `captureException()` and auto-detection of error spans.

**Tech Stack:** TypeScript, vitest, OpenTelemetry SDK, posthog-node (existing)

---

### Task 1: Error Tracking Types

**Files:**
- Create: `packages/autotel-web/src/error-tracking/types.ts`
- Test: `packages/autotel-web/src/error-tracking/types.test.ts`

**Step 1: Write the types file**

```typescript
/**
 * Structured error types for autotel-web error tracking.
 * Compatible with PostHog's $exception_list format and OTel semantic conventions.
 */

export interface StackFrame {
  /** Source filename (e.g., "app.js", "https://example.com/app.js") */
  filename?: string;
  /** Function name */
  function?: string;
  /** Line number (1-indexed) */
  lineno?: number;
  /** Column number (1-indexed) */
  colno?: number;
  /** Absolute path / full URL */
  abs_path?: string;
  /** Whether this frame is from application code (vs library) */
  in_app?: boolean;
  /** Platform identifier */
  platform?: string;
}

export interface ExceptionMechanism {
  /** How the error was captured */
  type: 'onerror' | 'onunhandledrejection' | 'console.error' | 'manual' | 'generic';
  /** Whether the error was explicitly caught by user code */
  handled: boolean;
}

export interface ExceptionRecord {
  /** Error class name (e.g., "TypeError", "RangeError") */
  type: string;
  /** Error message */
  value: string;
  /** How the error was captured */
  mechanism: ExceptionMechanism;
  /** Parsed stack trace */
  stacktrace?: { frames: StackFrame[] };
}

/**
 * List of exceptions, ordered from root cause to outermost.
 * Supports error.cause chains.
 */
export type ExceptionList = ExceptionRecord[];

export interface SuppressionRule {
  /** Field to match against */
  key: 'type' | 'value';
  /** Match operator */
  operator: 'exact' | 'contains' | 'regex';
  /** Value or pattern to match */
  value: string;
}

export interface RateLimitConfig {
  /** Max exceptions per type within the window (default: 10) */
  maxPerType: number;
  /** Time window in milliseconds (default: 10000) */
  windowMs: number;
}

export interface ErrorTrackingConfig {
  /** Rate limit per exception type */
  rateLimit?: RateLimitConfig;
  /** Suppression rules to filter known noise */
  suppressionRules?: SuppressionRule[];
  /** Capture console.error as exceptions (default: false) */
  captureConsoleErrors?: boolean;
  /** Skip autocapture if window.posthog is detected (default: true) */
  deferToPostHog?: boolean;
  /** Debug logging */
  debug?: boolean;
}
```

**Step 2: Write a basic type test**

```typescript
import { describe, it, expect } from 'vitest';
import type {
  StackFrame,
  ExceptionRecord,
  ExceptionList,
  SuppressionRule,
  RateLimitConfig,
  ErrorTrackingConfig,
} from './types';

describe('error-tracking types', () => {
  it('ExceptionRecord satisfies the expected shape', () => {
    const record: ExceptionRecord = {
      type: 'TypeError',
      value: 'Cannot read properties of undefined',
      mechanism: { type: 'onerror', handled: false },
      stacktrace: {
        frames: [
          {
            filename: 'app.js',
            function: 'handleClick',
            lineno: 42,
            colno: 10,
            in_app: true,
          },
        ],
      },
    };
    expect(record.type).toBe('TypeError');
    expect(record.stacktrace?.frames).toHaveLength(1);
  });

  it('ExceptionList supports cause chains', () => {
    const list: ExceptionList = [
      { type: 'Error', value: 'root cause', mechanism: { type: 'generic', handled: false } },
      { type: 'TypeError', value: 'outer error', mechanism: { type: 'onerror', handled: false } },
    ];
    expect(list).toHaveLength(2);
    expect(list[0].value).toBe('root cause');
  });
});
```

**Step 3: Run test to verify it passes**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/types.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/autotel-web/src/error-tracking/types.ts packages/autotel-web/src/error-tracking/types.test.ts
git commit -m "feat(autotel-web): add structured error tracking types"
```

---

### Task 2: Stack Trace Parser

**Files:**
- Create: `packages/autotel-web/src/error-tracking/stack-parser.ts`
- Test: `packages/autotel-web/src/error-tracking/stack-parser.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseStack } from './stack-parser';

describe('parseStack', () => {
  it('parses Chrome/V8 stack trace', () => {
    const stack = `TypeError: Cannot read properties of undefined (reading 'foo')
    at handleClick (https://example.com/static/js/app.js:42:10)
    at HTMLButtonElement.onclick (https://example.com/static/js/app.js:100:5)`;

    const frames = parseStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      function: 'handleClick',
      filename: 'app.js',
      abs_path: 'https://example.com/static/js/app.js',
      lineno: 42,
      colno: 10,
      in_app: true,
    });
  });

  it('parses Firefox stack trace', () => {
    const stack = `handleClick@https://example.com/static/js/app.js:42:10
onclick@https://example.com/static/js/app.js:100:5`;

    const frames = parseStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe('handleClick');
    expect(frames[0].lineno).toBe(42);
  });

  it('parses Safari stack trace', () => {
    const stack = `handleClick@https://example.com/static/js/app.js:42:10
https://example.com/static/js/app.js:100:5`;

    const frames = parseStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe('handleClick');
    expect(frames[1].function).toBeUndefined();
  });

  it('parses anonymous functions', () => {
    const stack = `Error: test
    at https://example.com/app.js:10:5
    at <anonymous>:1:1`;

    const frames = parseStack(stack);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0].function).toBeUndefined();
  });

  it('marks node_modules frames as not in_app', () => {
    const stack = `Error: test
    at myFunc (https://example.com/app.js:10:5)
    at libFunc (https://example.com/node_modules/lib/index.js:20:3)`;

    const frames = parseStack(stack);
    expect(frames[0].in_app).toBe(true);
    expect(frames[1].in_app).toBe(false);
  });

  it('returns empty array for empty/undefined input', () => {
    expect(parseStack('')).toEqual([]);
    expect(parseStack(undefined as any)).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/stack-parser.test.ts`
Expected: FAIL  - module not found

**Step 3: Write the stack parser**

```typescript
import type { StackFrame } from './types';

// Chrome/V8: "    at funcName (url:line:col)" or "    at url:line:col"
const CHROME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

// Firefox/Safari: "funcName@url:line:col" or "url:line:col"
const FIREFOX_RE = /^(?:(.+)@)?(.+?):(\d+):(\d+)$/;

/**
 * Extract filename from a URL or path.
 * "https://example.com/static/js/app.js" -> "app.js"
 */
function extractFilename(absPath: string): string {
  try {
    const url = new URL(absPath);
    const parts = url.pathname.split('/');
    return parts[parts.length - 1] || absPath;
  } catch {
    const parts = absPath.split('/');
    return parts[parts.length - 1] || absPath;
  }
}

/**
 * Determine if a frame is from application code.
 * Frames from node_modules, browser extensions, or eval are not in_app.
 */
function isInApp(absPath: string): boolean {
  if (absPath.includes('node_modules')) return false;
  if (absPath.includes('extensions/')) return false;
  if (absPath.startsWith('chrome-extension://')) return false;
  if (absPath.includes('<anonymous>')) return false;
  if (absPath.startsWith('eval')) return false;
  return true;
}

/**
 * Parse an error.stack string into structured StackFrame[].
 * Handles Chrome/V8, Firefox, and Safari formats.
 *
 * Frames are returned in call order (outermost first).
 */
export function parseStack(stack: string | undefined | null): StackFrame[] {
  if (!stack) return [];

  const lines = stack.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try Chrome format first
    let match = trimmed.match(CHROME_RE);
    if (match) {
      const [, fn, absPath, lineStr, colStr] = match;
      frames.push({
        function: fn || undefined,
        abs_path: absPath,
        filename: extractFilename(absPath),
        lineno: parseInt(lineStr, 10),
        colno: parseInt(colStr, 10),
        in_app: isInApp(absPath),
      });
      continue;
    }

    // Try Firefox/Safari format
    match = trimmed.match(FIREFOX_RE);
    if (match) {
      const [, fn, absPath, lineStr, colStr] = match;
      frames.push({
        function: fn || undefined,
        abs_path: absPath,
        filename: extractFilename(absPath),
        lineno: parseInt(lineStr, 10),
        colno: parseInt(colStr, 10),
        in_app: isInApp(absPath),
      });
      continue;
    }

    // Skip lines that don't match (e.g., the error message line)
  }

  return frames;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/stack-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/autotel-web/src/error-tracking/stack-parser.ts packages/autotel-web/src/error-tracking/stack-parser.test.ts
git commit -m "feat(autotel-web): add stack trace parser for Chrome, Firefox, Safari"
```

---

### Task 3: Exception Builder

**Files:**
- Create: `packages/autotel-web/src/error-tracking/exception-builder.ts`
- Test: `packages/autotel-web/src/error-tracking/exception-builder.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildExceptionList } from './exception-builder';

describe('buildExceptionList', () => {
  it('builds from Error with stack', () => {
    const error = new TypeError('Cannot read properties of undefined');
    const list = buildExceptionList(error, 'onerror');
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('TypeError');
    expect(list[0].value).toBe('Cannot read properties of undefined');
    expect(list[0].mechanism).toEqual({ type: 'onerror', handled: false });
    expect(list[0].stacktrace?.frames.length).toBeGreaterThan(0);
  });

  it('walks error.cause chain', () => {
    const root = new Error('root cause');
    const outer = new Error('outer', { cause: root });
    const list = buildExceptionList(outer, 'onerror');
    expect(list).toHaveLength(2);
    // Root cause first, outermost last
    expect(list[0].value).toBe('root cause');
    expect(list[1].value).toBe('outer');
  });

  it('handles deep cause chain (max 5)', () => {
    let err: Error = new Error('level-0');
    for (let i = 1; i <= 10; i++) {
      err = new Error(`level-${i}`, { cause: err });
    }
    const list = buildExceptionList(err, 'onerror');
    expect(list.length).toBeLessThanOrEqual(5);
  });

  it('normalizes string input', () => {
    const list = buildExceptionList('something broke', 'manual');
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('Error');
    expect(list[0].value).toBe('something broke');
    expect(list[0].mechanism.type).toBe('manual');
  });

  it('normalizes unknown input', () => {
    const list = buildExceptionList(42, 'manual');
    expect(list).toHaveLength(1);
    expect(list[0].value).toBe('42');
  });

  it('normalizes null/undefined input', () => {
    const list = buildExceptionList(null, 'manual');
    expect(list).toHaveLength(1);
    expect(list[0].value).toBe('Unknown error');
  });

  it('sets handled=true for manual mechanism', () => {
    const list = buildExceptionList(new Error('test'), 'manual');
    expect(list[0].mechanism.handled).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/exception-builder.test.ts`
Expected: FAIL

**Step 3: Write the exception builder**

```typescript
import type { ExceptionList, ExceptionMechanism, ExceptionRecord } from './types';
import { parseStack } from './stack-parser';

const MAX_CAUSE_DEPTH = 5;

function normalizeToError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  if (value === null || value === undefined) return new Error('Unknown error');
  try {
    return new Error(String(value));
  } catch {
    return new Error('Unknown error');
  }
}

/**
 * Build an ExceptionList from any thrown value.
 *
 * Walks the error.cause chain (up to MAX_CAUSE_DEPTH).
 * Returns root cause first, outermost error last.
 */
export function buildExceptionList(
  input: unknown,
  mechanismType: ExceptionMechanism['type'],
): ExceptionList {
  const error = normalizeToError(input);
  const handled = mechanismType === 'manual';

  const records: ExceptionRecord[] = [];
  let current: Error | undefined = error;
  let depth = 0;

  while (current && depth < MAX_CAUSE_DEPTH) {
    const record: ExceptionRecord = {
      type: current.name || 'Error',
      value: current.message || 'Unknown error',
      mechanism: { type: mechanismType, handled },
    };

    if (current.stack) {
      const frames = parseStack(current.stack);
      if (frames.length > 0) {
        record.stacktrace = { frames };
      }
    }

    records.push(record);
    current = current.cause instanceof Error ? current.cause : undefined;
    depth++;
  }

  // Reverse: root cause first, outermost last
  return records.reverse();
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/exception-builder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/autotel-web/src/error-tracking/exception-builder.ts packages/autotel-web/src/error-tracking/exception-builder.test.ts
git commit -m "feat(autotel-web): add exception builder with cause chain support"
```

---

### Task 4: Rate Limiter

**Files:**
- Create: `packages/autotel-web/src/error-tracking/rate-limiter.ts`
- Test: `packages/autotel-web/src/error-tracking/rate-limiter.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('allows events within the limit', () => {
    const limiter = new RateLimiter({ maxPerType: 3, windowMs: 10000 });
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(true);
  });

  it('blocks events exceeding the limit', () => {
    const limiter = new RateLimiter({ maxPerType: 2, windowMs: 10000 });
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(false);
  });

  it('tracks types independently', () => {
    const limiter = new RateLimiter({ maxPerType: 1, windowMs: 10000 });
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('RangeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(false);
    expect(limiter.isAllowed('RangeError')).toBe(false);
  });

  it('resets after the time window', () => {
    const limiter = new RateLimiter({ maxPerType: 1, windowMs: 10000 });
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(false);

    vi.advanceTimersByTime(10001);
    expect(limiter.isAllowed('TypeError')).toBe(true);
  });

  it('uses default config when none provided', () => {
    const limiter = new RateLimiter();
    // Default: 10 per type per 10s
    for (let i = 0; i < 10; i++) {
      expect(limiter.isAllowed('Error')).toBe(true);
    }
    expect(limiter.isAllowed('Error')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/rate-limiter.test.ts`
Expected: FAIL

**Step 3: Write the rate limiter**

```typescript
import type { RateLimitConfig } from './types';

const DEFAULT_CONFIG: RateLimitConfig = {
  maxPerType: 10,
  windowMs: 10000,
};

interface BucketEntry {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private buckets = new Map<string, BucketEntry>();

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if an exception of the given type is allowed (and consume one slot).
   * Returns false if the rate limit for this type has been exceeded.
   */
  isAllowed(exceptionType: string): boolean {
    const now = Date.now();
    const entry = this.buckets.get(exceptionType);

    if (!entry || now - entry.windowStart >= this.config.windowMs) {
      this.buckets.set(exceptionType, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= this.config.maxPerType) {
      return false;
    }

    entry.count++;
    return true;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/rate-limiter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/autotel-web/src/error-tracking/rate-limiter.ts packages/autotel-web/src/error-tracking/rate-limiter.test.ts
git commit -m "feat(autotel-web): add per-type error rate limiter"
```

---

### Task 5: Suppression Rules

**Files:**
- Create: `packages/autotel-web/src/error-tracking/suppression.ts`
- Test: `packages/autotel-web/src/error-tracking/suppression.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { isSuppressed } from './suppression';
import type { ExceptionRecord, SuppressionRule } from './types';

const makeException = (type: string, value: string): ExceptionRecord => ({
  type,
  value,
  mechanism: { type: 'onerror', handled: false },
});

describe('isSuppressed', () => {
  it('returns false with no rules', () => {
    expect(isSuppressed(makeException('Error', 'test'), [])).toBe(false);
  });

  it('matches exact type', () => {
    const rules: SuppressionRule[] = [{ key: 'type', operator: 'exact', value: 'ResizeObserver loop' }];
    expect(isSuppressed(makeException('ResizeObserver loop', 'x'), rules)).toBe(true);
    expect(isSuppressed(makeException('TypeError', 'x'), rules)).toBe(false);
  });

  it('matches contains on value', () => {
    const rules: SuppressionRule[] = [{ key: 'value', operator: 'contains', value: 'Script error' }];
    expect(isSuppressed(makeException('Error', 'Script error.'), rules)).toBe(true);
    expect(isSuppressed(makeException('Error', 'other'), rules)).toBe(false);
  });

  it('matches regex on value', () => {
    const rules: SuppressionRule[] = [{ key: 'value', operator: 'regex', value: '^Loading chunk \\d+' }];
    expect(isSuppressed(makeException('Error', 'Loading chunk 42 failed'), rules)).toBe(true);
    expect(isSuppressed(makeException('Error', 'other error'), rules)).toBe(false);
  });

  it('matches if any rule matches (OR logic)', () => {
    const rules: SuppressionRule[] = [
      { key: 'type', operator: 'exact', value: 'AbortError' },
      { key: 'value', operator: 'contains', value: 'Script error' },
    ];
    expect(isSuppressed(makeException('AbortError', 'request aborted'), rules)).toBe(true);
    expect(isSuppressed(makeException('Error', 'Script error.'), rules)).toBe(true);
    expect(isSuppressed(makeException('TypeError', 'other'), rules)).toBe(false);
  });

  it('handles invalid regex gracefully', () => {
    const rules: SuppressionRule[] = [{ key: 'value', operator: 'regex', value: '[invalid' }];
    expect(isSuppressed(makeException('Error', 'test'), rules)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/suppression.test.ts`
Expected: FAIL

**Step 3: Write suppression logic**

```typescript
import type { ExceptionRecord, SuppressionRule } from './types';

function matchesRule(exception: ExceptionRecord, rule: SuppressionRule): boolean {
  const fieldValue = rule.key === 'type' ? exception.type : exception.value;

  switch (rule.operator) {
    case 'exact':
      return fieldValue === rule.value;
    case 'contains':
      return fieldValue.includes(rule.value);
    case 'regex':
      try {
        return new RegExp(rule.value).test(fieldValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Check if an exception should be suppressed (filtered out) based on rules.
 * Returns true if any rule matches (OR logic).
 */
export function isSuppressed(exception: ExceptionRecord, rules: SuppressionRule[]): boolean {
  return rules.some((rule) => matchesRule(exception, rule));
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/suppression.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/autotel-web/src/error-tracking/suppression.ts packages/autotel-web/src/error-tracking/suppression.test.ts
git commit -m "feat(autotel-web): add error suppression rules"
```

---

### Task 6: Error Tracking Main Module (setupErrorTracking + captureException)

**Files:**
- Create: `packages/autotel-web/src/error-tracking/index.ts`
- Test: `packages/autotel-web/src/error-tracking/error-tracking.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace, SpanStatusCode } from '@opentelemetry/api';

// We'll test the public API
import { setupErrorTracking, captureException, resetErrorTrackingForTesting } from './index';

// Mock OTel tracer
const mockRecordException = vi.fn();
const mockSetStatus = vi.fn();
const mockSetAttribute = vi.fn();
const mockAddEvent = vi.fn();
const mockEnd = vi.fn();

const mockSpan = {
  recordException: mockRecordException,
  setStatus: mockSetStatus,
  setAttribute: mockSetAttribute,
  addEvent: mockAddEvent,
  end: mockEnd,
  isRecording: () => true,
};

const mockStartActiveSpan = vi.fn((name: string, fn: (span: any) => any) => fn(mockSpan));
const mockTracer = {
  startActiveSpan: mockStartActiveSpan,
};

vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer as any);
vi.spyOn(trace, 'getActiveSpan').mockReturnValue(null);

describe('setupErrorTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetErrorTrackingForTesting();
  });

  it('captures window error events', () => {
    setupErrorTracking({ debug: false });

    const error = new TypeError('test error');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'test error' }));

    expect(mockStartActiveSpan).toHaveBeenCalled();
    expect(mockSetAttribute).toHaveBeenCalledWith('exception.type', 'TypeError');
    expect(mockSetAttribute).toHaveBeenCalledWith('exception.message', 'test error');
    expect(mockSetAttribute).toHaveBeenCalledWith('error.source', 'window.onerror');
  });

  it('captures unhandled rejection events', () => {
    setupErrorTracking({ debug: false });

    const error = new Error('rejected');
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: error,
    }));

    expect(mockStartActiveSpan).toHaveBeenCalled();
    expect(mockSetAttribute).toHaveBeenCalledWith('error.source', 'unhandledrejection');
  });

  it('adds exception.list attribute with structured data', () => {
    setupErrorTracking({ debug: false });

    const error = new Error('structured test');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'structured test' }));

    expect(mockSetAttribute).toHaveBeenCalledWith(
      'exception.list',
      expect.any(String),
    );
    // Verify it's valid JSON
    const call = mockSetAttribute.mock.calls.find((c: any) => c[0] === 'exception.list');
    const parsed = JSON.parse(call![1]);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed[0].type).toBe('Error');
  });

  it('rate-limits by exception type', () => {
    setupErrorTracking({
      debug: false,
      rateLimit: { maxPerType: 1, windowMs: 10000 },
    });

    const error1 = new TypeError('first');
    const error2 = new TypeError('second');
    window.dispatchEvent(new ErrorEvent('error', { error: error1, message: 'first' }));
    window.dispatchEvent(new ErrorEvent('error', { error: error2, message: 'second' }));

    // Only one span should be created
    expect(mockStartActiveSpan).toHaveBeenCalledTimes(1);
  });

  it('suppresses matching errors', () => {
    setupErrorTracking({
      debug: false,
      suppressionRules: [{ key: 'value', operator: 'contains', value: 'Script error' }],
    });

    const error = new Error('Script error.');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'Script error.' }));

    expect(mockStartActiveSpan).not.toHaveBeenCalled();
  });

  it('skips autocapture when window.posthog detected and deferToPostHog=true', () => {
    (globalThis as any).posthog = { captureException: vi.fn() };

    setupErrorTracking({ debug: false, deferToPostHog: true });

    const error = new Error('test');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'test' }));

    // Should NOT create spans (PostHog handles it)
    expect(mockStartActiveSpan).not.toHaveBeenCalled();

    delete (globalThis as any).posthog;
  });

  it('still captures when deferToPostHog=false even if posthog exists', () => {
    (globalThis as any).posthog = { captureException: vi.fn() };

    setupErrorTracking({ debug: false, deferToPostHog: false });

    const error = new Error('test');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'test' }));

    expect(mockStartActiveSpan).toHaveBeenCalled();

    delete (globalThis as any).posthog;
  });
});

describe('captureException', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetErrorTrackingForTesting();
    setupErrorTracking({ debug: false });
  });

  it('manually captures an error', () => {
    captureException(new Error('manual'));

    expect(mockStartActiveSpan).toHaveBeenCalled();
    expect(mockSetAttribute).toHaveBeenCalledWith('exception.type', 'Error');
    expect(mockSetAttribute).toHaveBeenCalledWith('exception.message', 'manual');
  });

  it('sets mechanism to manual with handled=true', () => {
    captureException(new Error('manual'));

    const call = mockSetAttribute.mock.calls.find((c: any) => c[0] === 'exception.list');
    const parsed = JSON.parse(call![1]);
    expect(parsed[0].mechanism.type).toBe('manual');
    expect(parsed[0].mechanism.handled).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/error-tracking.test.ts`
Expected: FAIL

**Step 3: Write the main error tracking module**

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { ErrorTrackingConfig, ExceptionMechanism } from './types';
import { buildExceptionList } from './exception-builder';
import { RateLimiter } from './rate-limiter';
import { isSuppressed } from './suppression';

export type { ErrorTrackingConfig, ExceptionList, ExceptionRecord, StackFrame, SuppressionRule, RateLimitConfig } from './types';

let isInitialized = false;
let rateLimiter: RateLimiter;
let config: ErrorTrackingConfig;
let cleanupFns: (() => void)[] = [];

function hasPostHog(): boolean {
  const g = typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : undefined;
  return !!(g?.posthog && typeof (g.posthog as any).captureException === 'function');
}

function recordException(
  error: unknown,
  mechanismType: ExceptionMechanism['type'],
): void {
  const exceptionList = buildExceptionList(error, mechanismType);
  if (exceptionList.length === 0) return;

  const topException = exceptionList[exceptionList.length - 1];

  // Check suppression
  if (config.suppressionRules && isSuppressed(topException, config.suppressionRules)) {
    if (config.debug) {
      console.debug('[autotel-web] Suppressed exception:', topException.type, topException.value);
    }
    return;
  }

  // Check rate limit
  if (!rateLimiter.isAllowed(topException.type)) {
    if (config.debug) {
      console.debug('[autotel-web] Rate-limited exception:', topException.type);
    }
    return;
  }

  const tracer = trace.getTracer('autotel-web', '1.0.0');

  // Record on active span or create new one
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    activeSpan.recordException(normalizedError);
    activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: topException.value });
    activeSpan.setAttribute('exception.type', topException.type);
    activeSpan.setAttribute('exception.message', topException.value);
    activeSpan.setAttribute('exception.list', JSON.stringify(exceptionList));
    activeSpan.setAttribute('error.source', mechanismType);
  } else {
    tracer.startActiveSpan('unhandled_error', (span) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      span.recordException(normalizedError);
      span.setStatus({ code: SpanStatusCode.ERROR, message: topException.value });
      span.setAttribute('exception.type', topException.type);
      span.setAttribute('exception.message', topException.value);
      span.setAttribute('exception.list', JSON.stringify(exceptionList));
      span.setAttribute('error.source', mechanismType);
      span.end();
    });
  }

  if (config.debug) {
    console.debug('[autotel-web] Captured exception:', topException.type, topException.value);
  }
}

/**
 * Set up automatic error tracking.
 * Replaces the old setupErrorCapture().
 */
export function setupErrorTracking(cfg: ErrorTrackingConfig): void {
  if (typeof window === 'undefined') return;
  if (isInitialized) return;

  config = cfg;
  rateLimiter = new RateLimiter(cfg.rateLimit);

  const shouldDeferToPostHog = cfg.deferToPostHog !== false && hasPostHog();

  if (!shouldDeferToPostHog) {
    const onError = (event: ErrorEvent) => {
      const error = event.error != null ? event.error : new Error(event.message);
      recordException(error, 'onerror');
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      recordException(event.reason, 'onunhandledrejection');
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    cleanupFns.push(
      () => window.removeEventListener('error', onError),
      () => window.removeEventListener('unhandledrejection', onRejection),
    );

    if (cfg.captureConsoleErrors) {
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        const error = args[0] instanceof Error ? args[0] : new Error(args.map(String).join(' '));
        recordException(error, 'console.error');
        originalConsoleError.apply(console, args);
      };
      cleanupFns.push(() => {
        console.error = originalConsoleError;
      });
    }
  }

  isInitialized = true;
  if (cfg.debug) {
    console.debug('[autotel-web] Error tracking initialized', {
      deferToPostHog: shouldDeferToPostHog,
      captureConsoleErrors: cfg.captureConsoleErrors ?? false,
    });
  }
}

/**
 * Manually capture an exception.
 * Use this for caught errors you want to track.
 */
export function captureException(error: unknown): void {
  recordException(error, 'manual');
}

/** @internal Reset for testing */
export function resetErrorTrackingForTesting(): void {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  isInitialized = false;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/error-tracking.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/autotel-web/src/error-tracking/index.ts packages/autotel-web/src/error-tracking/error-tracking.test.ts
git commit -m "feat(autotel-web): add error tracking with rate limiting, suppression, PostHog detection"
```

---

### Task 7: Wire Error Tracking into autotel-web/full

**Files:**
- Modify: `packages/autotel-web/src/full.ts` (lines 27, 87-88, 111, 225-227)
- Modify: `packages/autotel-web/src/errors.ts` (keep for backwards compat or delete)

**Step 1: Update full.ts config to use new ErrorTrackingConfig**

In `packages/autotel-web/src/full.ts`:

Replace the import of `setupErrorCapture` (line 27):
```typescript
// OLD
import { setupErrorCapture } from './errors';
// NEW
import { setupErrorTracking, type ErrorTrackingConfig } from './error-tracking';
```

Add `errorTracking` to `AutotelWebFullConfig` (after line 104, the `captureLongTasks` field):
```typescript
  /**
   * Advanced error tracking configuration.
   * When captureErrors is true (default), this configures rate limiting, suppression, etc.
   */
  errorTracking?: Omit<ErrorTrackingConfig, 'debug'>;
```

Replace the error capture setup call (lines 225-227):
```typescript
// OLD
  if (config.captureErrors !== false) {
    setupErrorCapture({ debug: config.debug ?? false });
  }
// NEW
  if (config.captureErrors !== false) {
    setupErrorTracking({
      debug: config.debug ?? false,
      ...config.errorTracking,
    });
  }
```

Export `captureException` from full.ts (add after line 339):
```typescript
export { captureException } from './error-tracking';
```

**Step 2: Delete old errors.ts**

Delete `packages/autotel-web/src/errors.ts`  - its functionality is fully replaced.

**Step 3: Run all autotel-web tests**

Run: `cd packages/autotel-web && pnpm vitest run`
Expected: All PASS (old errors.ts had no tests)

**Step 4: Commit**

```bash
git add packages/autotel-web/src/full.ts
git rm packages/autotel-web/src/errors.ts
git commit -m "feat(autotel-web): wire error tracking into initFull(), remove old errors.ts"
```

---

### Task 8: PostHog OTLP Logs in autotel init()

**Files:**
- Modify: `packages/autotel/src/init.ts` (lines 213-240 config type, lines 1332-1338 log processor wiring)
- Test: `packages/autotel/src/posthog-logs.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the OTel log modules before import
const mockBatchLogRecordProcessor = vi.fn();
const mockOTLPLogExporter = vi.fn();

vi.mock('@opentelemetry/sdk-logs', () => ({
  BatchLogRecordProcessor: mockBatchLogRecordProcessor,
}));

vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: mockOTLPLogExporter,
}));

import { buildPostHogLogProcessors } from './posthog-logs';

describe('buildPostHogLogProcessors', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns processor when posthog.url is configured', () => {
    const result = buildPostHogLogProcessors({
      url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test',
    });
    expect(result).toHaveLength(1);
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({
      url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test',
    });
    expect(mockBatchLogRecordProcessor).toHaveBeenCalled();
  });

  it('returns processor from POSTHOG_LOGS_URL env var', () => {
    process.env.POSTHOG_LOGS_URL = 'https://eu.i.posthog.com/i/v1/logs?token=phc_eu';
    const result = buildPostHogLogProcessors(undefined);
    expect(result).toHaveLength(1);
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({
      url: 'https://eu.i.posthog.com/i/v1/logs?token=phc_eu',
    });
  });

  it('config.url takes precedence over env var', () => {
    process.env.POSTHOG_LOGS_URL = 'https://env-url.com';
    const result = buildPostHogLogProcessors({ url: 'https://config-url.com' });
    expect(result).toHaveLength(1);
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({ url: 'https://config-url.com' });
  });

  it('returns empty array when no url configured', () => {
    const result = buildPostHogLogProcessors(undefined);
    expect(result).toHaveLength(0);
    expect(mockOTLPLogExporter).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/autotel && pnpm vitest run src/posthog-logs.test.ts`
Expected: FAIL

**Step 3: Write posthog-logs.ts**

Create `packages/autotel/src/posthog-logs.ts`:

```typescript
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';

export interface PostHogConfig {
  /** OTLP logs endpoint URL (e.g., https://us.i.posthog.com/i/v1/logs?token=phc_xxx) */
  url: string;
}

/**
 * Build log record processors for PostHog OTLP logs integration.
 *
 * Resolution order:
 * 1. config.url if provided
 * 2. POSTHOG_LOGS_URL env var
 * 3. Empty array (disabled)
 */
export function buildPostHogLogProcessors(
  config: PostHogConfig | undefined,
): LogRecordProcessor[] {
  const url = config?.url || process.env.POSTHOG_LOGS_URL;
  if (!url) return [];

  const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');

  const exporter = new OTLPLogExporter({ url });
  const processor = new BatchLogRecordProcessor(exporter);

  return [processor];
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/autotel && pnpm vitest run src/posthog-logs.test.ts`
Expected: PASS

**Step 5: Wire into init.ts**

In `packages/autotel/src/init.ts`:

Add to the `AutotelConfig` interface (after the `logRecordProcessors` field around line 410):
```typescript
  /**
   * PostHog integration  - auto-configures OTLP log exporter.
   *
   * @example
   * ```typescript
   * init({
   *   service: 'my-app',
   *   posthog: { url: 'https://us.i.posthog.com/i/v1/logs?token=phc_xxx' }
   * });
   * ```
   *
   * Also reads from POSTHOG_LOGS_URL environment variable as fallback.
   */
  posthog?: { url: string };
```

In the init() function, after the existing log processor handling (after line 1338), add:
```typescript
  // PostHog OTLP logs integration
  const posthogProcessors = buildPostHogLogProcessors(mergedConfig.posthog);
  if (posthogProcessors.length > 0) {
    if (!logRecordProcessors) {
      logRecordProcessors = [];
    }
    logRecordProcessors.push(...posthogProcessors);
    logger.info({}, '[autotel] PostHog OTLP logs configured');
  }
```

Add the import at the top of init.ts:
```typescript
import { buildPostHogLogProcessors } from './posthog-logs';
```

**Step 6: Run all autotel tests**

Run: `cd packages/autotel && pnpm test`
Expected: All PASS

**Step 7: Commit**

```bash
git add packages/autotel/src/posthog-logs.ts packages/autotel/src/posthog-logs.test.ts packages/autotel/src/init.ts
git commit -m "feat(autotel): add posthog: { url } init option and POSTHOG_LOGS_URL env var"
```

---

### Task 9: PostHogSubscriber captureException + Error Formatter

**Files:**
- Create: `packages/autotel-subscribers/src/posthog-error-formatter.ts`
- Modify: `packages/autotel-subscribers/src/posthog.ts` (add captureException, enhance sendToDestination)
- Test: `packages/autotel-subscribers/src/posthog-error-formatter.test.ts`
- Test: `packages/autotel-subscribers/src/posthog-capture-exception.test.ts`

**Step 1: Write the error formatter test**

```typescript
import { describe, it, expect } from 'vitest';
import { formatExceptionForPostHog, errorToExceptionList } from './posthog-error-formatter';

describe('formatExceptionForPostHog', () => {
  it('formats an ExceptionList for PostHog $exception event', () => {
    const exceptionList = [
      {
        type: 'TypeError',
        value: 'Cannot read properties of undefined',
        mechanism: { type: 'onerror' as const, handled: false },
        stacktrace: {
          frames: [
            { filename: 'app.js', function: 'handleClick', lineno: 42, colno: 10, in_app: true },
          ],
        },
      },
    ];

    const result = formatExceptionForPostHog(exceptionList);
    expect(result.$exception_list).toHaveLength(1);
    expect(result.$exception_list[0].type).toBe('TypeError');
    expect(result.$exception_list[0].value).toBe('Cannot read properties of undefined');
    expect(result.$exception_list[0].stacktrace.frames[0].platform).toBe('web:javascript');
  });

  it('adds platform to all frames', () => {
    const exceptionList = [
      {
        type: 'Error',
        value: 'test',
        mechanism: { type: 'manual' as const, handled: true },
        stacktrace: {
          frames: [
            { filename: 'a.js', lineno: 1, colno: 1 },
            { filename: 'b.js', lineno: 2, colno: 2 },
          ],
        },
      },
    ];

    const result = formatExceptionForPostHog(exceptionList, 'node:javascript');
    expect(result.$exception_list[0].stacktrace.frames[0].platform).toBe('node:javascript');
    expect(result.$exception_list[0].stacktrace.frames[1].platform).toBe('node:javascript');
  });
});

describe('errorToExceptionList', () => {
  it('builds exception list from Error', () => {
    const error = new TypeError('test');
    const result = errorToExceptionList(error);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TypeError');
    expect(result[0].value).toBe('test');
  });

  it('handles non-Error input', () => {
    const result = errorToExceptionList('string error');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('string error');
  });

  it('walks cause chain', () => {
    const cause = new Error('root');
    const outer = new Error('outer', { cause });
    const result = errorToExceptionList(outer);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('root');
    expect(result[1].value).toBe('outer');
  });
});
```

**Step 2: Write the error formatter**

Create `packages/autotel-subscribers/src/posthog-error-formatter.ts`:

```typescript
/**
 * Format errors for PostHog's $exception event format.
 *
 * Compatible with autotel-web's ExceptionList type.
 * Can also build ExceptionList from raw errors (for server-side use).
 */

interface StackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  abs_path?: string;
  in_app?: boolean;
  platform?: string;
}

interface ExceptionRecord {
  type: string;
  value: string;
  mechanism: { type: string; handled: boolean };
  stacktrace?: { frames: StackFrame[] };
}

interface PostHogExceptionProperties {
  $exception_list: Array<{
    type: string;
    value: string;
    mechanism: { type: string; handled: boolean };
    stacktrace: { frames: Array<StackFrame & { platform: string }> };
  }>;
}

const MAX_CAUSE_DEPTH = 5;

/**
 * Format an ExceptionList into PostHog's $exception_list property format.
 */
export function formatExceptionForPostHog(
  exceptionList: ExceptionRecord[],
  platform: string = 'web:javascript',
): PostHogExceptionProperties {
  return {
    $exception_list: exceptionList.map((ex) => ({
      type: ex.type,
      value: ex.value,
      mechanism: ex.mechanism,
      stacktrace: {
        frames: (ex.stacktrace?.frames || []).map((frame) => ({
          ...frame,
          platform,
        })),
      },
    })),
  };
}

/**
 * Build an ExceptionList from any thrown value.
 * For server-side use where autotel-web's exception builder isn't available.
 */
export function errorToExceptionList(input: unknown): ExceptionRecord[] {
  const error = input instanceof Error ? input : new Error(
    input === null || input === undefined ? 'Unknown error' : String(input),
  );

  const records: ExceptionRecord[] = [];
  let current: Error | undefined = error;
  let depth = 0;

  while (current && depth < MAX_CAUSE_DEPTH) {
    records.push({
      type: current.name || 'Error',
      value: current.message || 'Unknown error',
      mechanism: { type: 'manual', handled: true },
      stacktrace: current.stack ? { frames: parseStackBasic(current.stack) } : undefined,
    });
    current = current.cause instanceof Error ? current.cause : undefined;
    depth++;
  }

  return records.reverse();
}

/**
 * Basic stack parser for server-side (Node.js V8 format only).
 */
function parseStackBasic(stack: string): StackFrame[] {
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];
  const re = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

  for (const line of lines) {
    const match = line.trim().match(re);
    if (match) {
      const [, fn, absPath, lineStr, colStr] = match;
      frames.push({
        function: fn || undefined,
        abs_path: absPath,
        filename: absPath.split('/').pop() || absPath,
        lineno: parseInt(lineStr, 10),
        colno: parseInt(colStr, 10),
        in_app: !absPath.includes('node_modules'),
      });
    }
  }

  return frames;
}
```

**Step 3: Run formatter tests**

Run: `cd packages/autotel-subscribers && pnpm vitest run src/posthog-error-formatter.test.ts`
Expected: PASS

**Step 4: Write the captureException test**

Create `packages/autotel-subscribers/src/posthog-capture-exception.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockCapture = vi.fn();
const mockShutdown = vi.fn(() => Promise.resolve());

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function (this: any) {
    this.capture = mockCapture;
    this.shutdown = mockShutdown;
    this.debug = vi.fn();
    this.on = vi.fn();
  }),
}));

import 'posthog-node';
import { PostHogSubscriber } from './posthog';

describe('PostHogSubscriber.captureException', () => {
  let subscriber: PostHogSubscriber;

  beforeEach(async () => {
    vi.clearAllMocks();
    subscriber = new PostHogSubscriber({ apiKey: 'phc_test' });
    // Wait for async init
    await new Promise((r) => setTimeout(r, 50));
  });

  it('sends $exception event via capture API', async () => {
    await subscriber.captureException(new TypeError('test error'), {
      distinctId: 'user-123',
    });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'user-123',
        event: '$exception',
        properties: expect.objectContaining({
          $exception_list: expect.any(Array),
        }),
      }),
    );
  });

  it('uses anonymous distinctId when not provided', async () => {
    await subscriber.captureException(new Error('test'));

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'anonymous',
      }),
    );
  });

  it('includes additional properties', async () => {
    await subscriber.captureException(new Error('test'), {
      distinctId: 'user-1',
      additionalProperties: { page: '/checkout' },
    });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          page: '/checkout',
        }),
      }),
    );
  });

  it('does not throw when disabled', async () => {
    const disabled = new PostHogSubscriber({ apiKey: 'phc_test', enabled: false });
    await expect(disabled.captureException(new Error('test'))).resolves.not.toThrow();
  });
});
```

**Step 5: Add captureException to PostHogSubscriber**

In `packages/autotel-subscribers/src/posthog.ts`, add the import at top:
```typescript
import { formatExceptionForPostHog, errorToExceptionList } from './posthog-error-formatter';
```

Add the method to the `PostHogSubscriber` class (before the `shutdown` method around line 699):

```typescript
  /**
   * Capture an exception and send to PostHog error tracking.
   *
   * If using browser client (window.posthog), delegates to its captureException.
   * Otherwise, formats and sends via posthog-node capture API.
   *
   * @param error - The error to capture (Error, string, or unknown)
   * @param options - Optional distinctId and additional properties
   */
  async captureException(
    error: unknown,
    options?: {
      distinctId?: string;
      additionalProperties?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!this.enabled) return;
    await this.ensureInitialized();

    try {
      if (this.isBrowserClient) {
        // Browser SDK handles stack parsing, grouping, etc.
        (this.posthog as any)?.captureException?.(error, options?.additionalProperties);
        return;
      }

      // Server-side: build $exception_list and send via capture API
      const exceptionList = errorToExceptionList(error);
      const formatted = formatExceptionForPostHog(exceptionList, 'node:javascript');

      this.posthog?.capture({
        distinctId: options?.distinctId || 'anonymous',
        event: '$exception',
        properties: {
          ...formatted,
          ...options?.additionalProperties,
        },
      });
    } catch (err) {
      this.config.onError?.(err as Error);
    }
  }
```

Also enhance `sendToDestination` to auto-detect error spans. Add after the existing properties building (after line 435, before `const distinctId` line):

```typescript
    // Auto-detect error spans and send as $exception event
    if (payload.attributes?.['exception.list']) {
      try {
        const exceptionList = JSON.parse(payload.attributes['exception.list'] as string);
        const formatted = formatExceptionForPostHog(exceptionList);
        const exceptionProperties = {
          ...properties,
          ...formatted,
        };

        if (this.isBrowserClient) {
          (this.posthog as any)?.capture('$exception', exceptionProperties);
        } else {
          this.posthog?.capture({
            distinctId: this.extractDistinctId(filteredAttributes),
            event: '$exception',
            properties: exceptionProperties,
          });
        }
      } catch {
        // If exception.list parsing fails, continue with normal event tracking
      }
    }
```

**Step 6: Run all subscriber tests**

Run: `cd packages/autotel-subscribers && pnpm vitest run`
Expected: All PASS

**Step 7: Commit**

```bash
git add packages/autotel-subscribers/src/posthog-error-formatter.ts packages/autotel-subscribers/src/posthog-error-formatter.test.ts packages/autotel-subscribers/src/posthog-capture-exception.test.ts packages/autotel-subscribers/src/posthog.ts
git commit -m "feat(autotel-subscribers): add captureException and error formatting for PostHog"
```

---

### Task 10: Build Verification & Full Test Suite

**Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

**Step 3: Lint**

Run: `pnpm lint`
Expected: No lint errors

**Step 4: Create changeset**

Run: `pnpm changeset`

Create changeset for:
- `autotel-web` (minor): Add error tracking with stack parsing, exception chains, rate limiting, suppression rules, and manual captureException API
- `autotel` (minor): Add `posthog: { url }` init option and `POSTHOG_LOGS_URL` env var for zero-config PostHog OTLP logs integration
- `autotel-subscribers` (minor): Add `captureException()` to PostHogSubscriber and auto-detection of error spans

**Step 5: Final commit**

```bash
git add .changeset/
git commit -m "chore: add changesets for error tracking feature"
```
