# PostHog Export Redaction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two-layer PII redaction (regex value scanning + slow-redact path-based) to all PostHog data export paths.

**Architecture:** Extract string redaction from the existing `AttributeRedactingProcessor` into a standalone utility. Apply it to error messages, stack traces, and log bodies. Add `slow-redact` for structured event attributes in the subscriber. Both layers compose in `PostHogSubscriber.sendToDestination()`.

**Tech Stack:** TypeScript, vitest, slow-redact, existing `REDACTOR_PATTERNS`/`REDACTOR_PRESETS`

---

### Task 1: Extract `createStringRedactor` utility from core autotel

**Files:**
- Create: `packages/autotel/src/redact-values.ts`
- Create: `packages/autotel/src/redact-values.test.ts`
- Modify: `packages/autotel/src/attribute-redacting-processor.ts`
- Modify: `packages/autotel/src/index.ts`

**Step 1: Write the failing tests**

```typescript
// packages/autotel/src/redact-values.test.ts
import { describe, it, expect } from 'vitest';
import { createStringRedactor } from './redact-values';

describe('createStringRedactor', () => {
  it('redacts emails with default preset', () => {
    const redact = createStringRedactor('default');
    expect(redact('User john@example.com not found')).toBe('User [REDACTED] not found');
  });

  it('redacts phone numbers with default preset', () => {
    const redact = createStringRedactor('default');
    expect(redact('Call 555-123-4567 for support')).toBe('Call [REDACTED] for support');
  });

  it('redacts credit card numbers with default preset', () => {
    const redact = createStringRedactor('default');
    expect(redact('Card 4111-1111-1111-1111 charged')).toBe('Card [REDACTED] charged');
  });

  it('redacts JWTs with strict preset', () => {
    const redact = createStringRedactor('strict');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123';
    expect(redact(`Token: ${jwt}`)).toBe('Token: [REDACTED]');
  });

  it('redacts bearer tokens with strict preset', () => {
    const redact = createStringRedactor('strict');
    expect(redact('Bearer abc123xyz')).toBe('[REDACTED]');
  });

  it('returns input unchanged when no patterns match', () => {
    const redact = createStringRedactor('default');
    expect(redact('TypeError: undefined is not a function')).toBe(
      'TypeError: undefined is not a function',
    );
  });

  it('accepts custom config with custom patterns', () => {
    const redact = createStringRedactor({
      valuePatterns: [
        { name: 'userId', pattern: /USER-\d+/g, replacement: 'USER-***' },
      ],
    });
    expect(redact('Found USER-12345 in db')).toBe('Found USER-*** in db');
  });

  it('uses custom replacement string', () => {
    const redact = createStringRedactor({
      valuePatterns: [
        { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi },
      ],
      replacement: '***',
    });
    expect(redact('user@test.com')).toBe('***');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/autotel && pnpm vitest run src/redact-values.test.ts`
Expected: FAIL  - module `./redact-values` not found

**Step 3: Write the implementation**

```typescript
// packages/autotel/src/redact-values.ts
/**
 * Standalone string redaction utility.
 *
 * Extracted from AttributeRedactingProcessor so the same regex patterns
 * can be applied to error messages, stack traces, log bodies, and event
 * attributes  - not just span attributes.
 */

import {
  REDACTOR_PRESETS,
  type AttributeRedactorConfig,
  type AttributeRedactorPreset,
  type ValuePatternConfig,
} from './attribute-redacting-processor';

/**
 * A function that redacts sensitive data from a string value.
 */
export type StringRedactor = (value: string) => string;

/**
 * Resolve a preset name or config object into a normalized config.
 */
function resolveConfig(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): AttributeRedactorConfig {
  if (typeof config === 'string') {
    const preset = REDACTOR_PRESETS[config];
    if (!preset) {
      throw new Error(
        `Unknown redactor preset: "${config}". Available: ${Object.keys(REDACTOR_PRESETS).join(', ')}`,
      );
    }
    return preset;
  }
  return config;
}

/**
 * Apply value patterns to a string, replacing matches with the replacement string.
 */
function redactString(
  value: string,
  patterns: ValuePatternConfig[],
  defaultReplacement: string,
): string {
  let result = value;
  for (const { pattern, replacement } of patterns) {
    pattern.lastIndex = 0;
    result = result.replaceAll(pattern, replacement ?? defaultReplacement);
  }
  return result;
}

/**
 * Create a string redactor function from a config or preset.
 *
 * @example
 * ```typescript
 * const redact = createStringRedactor('default');
 * redact('User john@example.com not found');
 * // => 'User [REDACTED] not found'
 * ```
 */
export function createStringRedactor(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): StringRedactor {
  const resolved = resolveConfig(config);
  const patterns = resolved.valuePatterns ?? [];
  const replacement = resolved.replacement ?? '[REDACTED]';

  return (value: string): string => redactString(value, patterns, replacement);
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/autotel && pnpm vitest run src/redact-values.test.ts`
Expected: All 8 tests PASS

**Step 5: Refactor `attribute-redacting-processor.ts` to use the new utility**

In `packages/autotel/src/attribute-redacting-processor.ts`, the private `redactStringValue` function duplicates logic now in `redact-values.ts`. No functional change needed  - the processor uses key+value patterns while the string redactor uses value patterns only. They remain separate because the processor operates on `AttributeValue` (strings, numbers, arrays) while the utility operates on plain strings. Leave as-is to avoid unnecessary coupling.

**Step 6: Export from package public API**

Add to `packages/autotel/src/index.ts` after the existing attribute-redacting-processor exports:

```typescript
// String redaction utility
export {
  createStringRedactor,
  type StringRedactor,
} from './redact-values';
```

**Step 7: Run full test suite**

Run: `cd packages/autotel && pnpm test`
Expected: All tests pass (existing + new)

**Step 8: Commit**

```bash
git add packages/autotel/src/redact-values.ts packages/autotel/src/redact-values.test.ts packages/autotel/src/index.ts
git commit -m "feat(autotel): extract createStringRedactor utility for cross-package redaction"
```

---

### Task 2: Store redactor in `init()` and expose `getStringRedactor()`

**Files:**
- Modify: `packages/autotel/src/init.ts`
- Create: `packages/autotel/src/init-redactor.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/autotel/src/init-redactor.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getStringRedactor } from './init';

describe('getStringRedactor', () => {
  it('returns null when no attributeRedactor configured', () => {
    expect(getStringRedactor()).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/autotel && pnpm vitest run src/init-redactor.test.ts`
Expected: FAIL  - `getStringRedactor` is not exported from `./init`

**Step 3: Implement**

In `packages/autotel/src/init.ts`, add near the top (after other imports):

```typescript
import { createStringRedactor, type StringRedactor } from './redact-values';
```

Add a module-level variable (near other module state like `globalSdk`):

```typescript
let _stringRedactor: StringRedactor | null = null;
```

Inside the `init()` function body, after the `attributeRedactor` wrapping block (around line 1304), add:

```typescript
// Store string redactor for use by PostHog log/subscriber paths
if (mergedConfig.attributeRedactor) {
  _stringRedactor = createStringRedactor(mergedConfig.attributeRedactor);
}
```

Export the getter:

```typescript
/**
 * Get the string redactor configured via init({ attributeRedactor }).
 * Returns null if no redactor was configured.
 */
export function getStringRedactor(): StringRedactor | null {
  return _stringRedactor;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/autotel && pnpm vitest run src/init-redactor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/autotel/src/init.ts packages/autotel/src/init-redactor.test.ts
git commit -m "feat(autotel): store string redactor in init() and expose getStringRedactor()"
```

---

### Task 3: Add redaction to `posthog-logs.ts` log processor

**Files:**
- Modify: `packages/autotel/src/posthog-logs.ts`
- Modify: `packages/autotel/src/posthog-logs.test.ts`

**Step 1: Write the failing test**

Add to the existing test file `packages/autotel/src/posthog-logs.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('buildPostHogLogProcessors with redactor', () => {
  it('accepts an optional stringRedactor parameter', () => {
    // This test just verifies the function signature accepts the new param
    // without throwing. Actual wrapping is tested via integration.
    const result = buildPostHogLogProcessors(undefined, undefined);
    expect(result).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/autotel && pnpm vitest run src/posthog-logs.test.ts`
Expected: FAIL  - `buildPostHogLogProcessors` doesn't accept second argument (or test doesn't match current signature)

**Step 3: Implement**

Modify `packages/autotel/src/posthog-logs.ts` to accept an optional `StringRedactor`:

```typescript
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import { safeRequire } from './node-require';
import type { StringRedactor } from './redact-values';

export interface PostHogConfig {
  /** OTLP logs endpoint URL */
  url: string;
}

/**
 * A LogRecordProcessor wrapper that redacts string values before forwarding.
 */
class RedactingLogRecordProcessor implements LogRecordProcessor {
  constructor(
    private wrapped: LogRecordProcessor,
    private redact: StringRedactor,
  ) {}

  onEmit(logRecord: any, context?: any): void {
    // Redact body if it's a string
    if (logRecord.body && typeof logRecord.body === 'string') {
      logRecord.body = this.redact(logRecord.body);
    }
    // Redact string attributes
    if (logRecord.attributes) {
      for (const [key, value] of Object.entries(logRecord.attributes)) {
        if (typeof value === 'string') {
          logRecord.attributes[key] = this.redact(value);
        }
      }
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

export function buildPostHogLogProcessors(
  config: PostHogConfig | undefined,
  stringRedactor?: StringRedactor | null,
): LogRecordProcessor[] {
  const url = config?.url || process.env.POSTHOG_LOGS_URL;
  if (!url) return [];

  const sdkLogs = safeRequire<{
    BatchLogRecordProcessor: new (exporter: unknown) => LogRecordProcessor;
  }>('@opentelemetry/sdk-logs');

  const exporterModule = safeRequire<{
    OTLPLogExporter: new (config: { url: string }) => unknown;
  }>('@opentelemetry/exporter-logs-otlp-http');

  if (!sdkLogs || !exporterModule) return [];

  const exporter = new exporterModule.OTLPLogExporter({ url });
  let processor: LogRecordProcessor = new sdkLogs.BatchLogRecordProcessor(exporter);

  // Wrap with redacting processor if redactor is available
  if (stringRedactor) {
    processor = new RedactingLogRecordProcessor(processor, stringRedactor);
  }

  return [processor];
}
```

**Step 4: Update `init.ts` to pass redactor to `buildPostHogLogProcessors`**

In `packages/autotel/src/init.ts` around line 1357, change:

```typescript
// Before:
const posthogProcessors = buildPostHogLogProcessors(mergedConfig.posthog);

// After:
const posthogProcessors = buildPostHogLogProcessors(mergedConfig.posthog, _stringRedactor);
```

**Step 5: Run tests**

Run: `cd packages/autotel && pnpm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/autotel/src/posthog-logs.ts packages/autotel/src/posthog-logs.test.ts packages/autotel/src/init.ts
git commit -m "feat(autotel): add redaction wrapper to PostHog log processor"
```

---

### Task 4: Add redaction to `posthog-error-formatter.ts`

**Files:**
- Modify: `packages/autotel-subscribers/src/posthog-error-formatter.ts`
- Modify: `packages/autotel-subscribers/src/posthog-error-formatter.test.ts`

**Step 1: Write the failing tests**

Add to the existing test file:

```typescript
describe('formatExceptionForPostHog with redactor', () => {
  const mockRedactor = (value: string) =>
    value.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, '[REDACTED]');

  it('redacts PII from exception.value', () => {
    const exceptions: ExceptionRecord[] = [
      {
        type: 'Error',
        value: 'User john@example.com not found',
        mechanism: { type: 'manual', handled: true },
      },
    ];
    const result = formatExceptionForPostHog(exceptions, 'web:javascript', mockRedactor);
    expect(result.$exception_list[0].value).toBe('User [REDACTED] not found');
  });

  it('redacts PII from abs_path in stack frames', () => {
    const exceptions: ExceptionRecord[] = [
      {
        type: 'Error',
        value: 'fail',
        mechanism: { type: 'manual', handled: true },
        stacktrace: {
          frames: [
            {
              function: 'handleRequest',
              abs_path: '/home/john@example.com/app/index.js',
              filename: 'index.js',
              lineno: 10,
              colno: 5,
              in_app: true,
            },
          ],
        },
      },
    ];
    const result = formatExceptionForPostHog(exceptions, 'web:javascript', mockRedactor);
    expect(result.$exception_list[0].stacktrace.frames[0].abs_path).toBe(
      '/home/[REDACTED]/app/index.js',
    );
  });

  it('does not redact exception.type', () => {
    const exceptions: ExceptionRecord[] = [
      {
        type: 'TypeError',
        value: 'john@example.com caused error',
        mechanism: { type: 'manual', handled: true },
      },
    ];
    const result = formatExceptionForPostHog(exceptions, 'web:javascript', mockRedactor);
    expect(result.$exception_list[0].type).toBe('TypeError');
  });

  it('works without redactor (backwards compatible)', () => {
    const exceptions: ExceptionRecord[] = [
      {
        type: 'Error',
        value: 'User john@example.com not found',
        mechanism: { type: 'manual', handled: true },
      },
    ];
    const result = formatExceptionForPostHog(exceptions);
    expect(result.$exception_list[0].value).toBe('User john@example.com not found');
  });
});

describe('errorToExceptionList with redactor', () => {
  const mockRedactor = (value: string) =>
    value.replace(/secret-token-\w+/g, '[REDACTED]');

  it('redacts error message', () => {
    const error = new Error('Failed with secret-token-abc123');
    const result = errorToExceptionList(error, mockRedactor);
    expect(result[0].value).toBe('Failed with [REDACTED]');
  });

  it('works without redactor', () => {
    const error = new Error('Failed with secret-token-abc123');
    const result = errorToExceptionList(error);
    expect(result[0].value).toBe('Failed with secret-token-abc123');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/autotel-subscribers && pnpm vitest run src/posthog-error-formatter.test.ts`
Expected: FAIL  - functions don't accept redactor parameter

**Step 3: Implement**

Modify `packages/autotel-subscribers/src/posthog-error-formatter.ts`:

Add `StringRedactor` type at the top (inline, no cross-package import needed):

```typescript
/** String redaction function  - matches autotel's StringRedactor type */
type StringRedactor = (value: string) => string;
```

Update `formatExceptionForPostHog` signature and body:

```typescript
export function formatExceptionForPostHog(
  exceptionList: ExceptionRecord[],
  platform: string = 'web:javascript',
  redactor?: StringRedactor,
): PostHogExceptionProperties {
  return {
    $exception_list: exceptionList.map((ex) => ({
      type: ex.type,
      value: redactor ? redactor(ex.value) : ex.value,
      mechanism: ex.mechanism,
      stacktrace: {
        frames: (ex.stacktrace?.frames || []).map((frame) => ({
          ...frame,
          abs_path: frame.abs_path && redactor ? redactor(frame.abs_path) : frame.abs_path,
          platform,
        })),
      },
    })),
  };
}
```

Update `errorToExceptionList` signature and body:

```typescript
export function errorToExceptionList(
  input: unknown,
  redactor?: StringRedactor,
): ExceptionRecord[] {
  const error =
    input instanceof Error
      ? input
      : new Error(
          input === null || input === undefined ? 'Unknown error' : String(input),
        );

  const records: ExceptionRecord[] = [];
  let current: Error | undefined = error;
  let depth = 0;

  while (current && depth < MAX_CAUSE_DEPTH) {
    const value = current.message || 'Unknown error';
    records.push({
      type: current.name || 'Error',
      value: redactor ? redactor(value) : value,
      mechanism: { type: 'manual', handled: true },
      stacktrace: current.stack
        ? {
            frames: parseStackBasic(current.stack).map((frame) => ({
              ...frame,
              abs_path:
                frame.abs_path && redactor
                  ? redactor(frame.abs_path)
                  : frame.abs_path,
            })),
          }
        : undefined,
    });
    current = current.cause instanceof Error ? current.cause : undefined;
    depth++;
  }

  return records.reverse();
}
```

**Step 4: Run tests**

Run: `cd packages/autotel-subscribers && pnpm vitest run src/posthog-error-formatter.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/autotel-subscribers/src/posthog-error-formatter.ts packages/autotel-subscribers/src/posthog-error-formatter.test.ts
git commit -m "feat(autotel-subscribers): add redactor support to posthog-error-formatter"
```

---

### Task 5: Install `slow-redact` and add path-based redaction to `PostHogSubscriber`

**Files:**
- Modify: `packages/autotel-subscribers/package.json`
- Modify: `packages/autotel-subscribers/src/posthog.ts`
- Create: `packages/autotel-subscribers/src/posthog-redaction.test.ts`

**Step 1: Install slow-redact**

```bash
cd packages/autotel-subscribers && pnpm add slow-redact
```

**Step 2: Write the failing tests**

```typescript
// packages/autotel-subscribers/src/posthog-redaction.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('PostHogSubscriber redactPaths', () => {
  it('accepts redactPaths config option', async () => {
    // Mock posthog-node
    const mockCapture = vi.fn();
    const { PostHogSubscriber } = await import('./posthog');

    const subscriber = new PostHogSubscriber({
      client: {
        capture: mockCapture,
        shutdown: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      } as any,
      redactPaths: ['user.password', 'headers.authorization'],
    });

    await subscriber.trackEvent('test.event', {
      userId: 'user-123',
      user: { password: 'secret123', name: 'John' },
      headers: { authorization: 'Bearer token123', contentType: 'json' },
    } as any);

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.properties.user.password).toBe('[REDACTED]');
    expect(captured.properties.user.name).toBe('John');
    expect(captured.properties.headers.authorization).toBe('[REDACTED]');
    expect(captured.properties.headers.contentType).toBe('json');
  });

  it('works without redactPaths (backwards compatible)', async () => {
    const mockCapture = vi.fn();
    const { PostHogSubscriber } = await import('./posthog');

    const subscriber = new PostHogSubscriber({
      client: {
        capture: mockCapture,
        shutdown: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      } as any,
    });

    await subscriber.trackEvent('test.event', {
      userId: 'user-123',
      password: 'secret123',
    } as any);

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.properties.password).toBe('secret123');
  });
});

describe('PostHogSubscriber stringRedactor', () => {
  it('applies string redactor to remaining string attribute values', async () => {
    const mockCapture = vi.fn();
    const { PostHogSubscriber } = await import('./posthog');

    const mockRedactor = (value: string) =>
      value.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, '[REDACTED]');

    const subscriber = new PostHogSubscriber({
      client: {
        capture: mockCapture,
        shutdown: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      } as any,
      stringRedactor: mockRedactor,
    });

    await subscriber.trackEvent('test.event', {
      userId: 'user-123',
      message: 'Contact john@example.com for help',
    } as any);

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.properties.message).toBe('Contact [REDACTED] for help');
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd packages/autotel-subscribers && pnpm vitest run src/posthog-redaction.test.ts`
Expected: FAIL  - `redactPaths` and `stringRedactor` not recognized options

**Step 4: Implement**

In `packages/autotel-subscribers/src/posthog.ts`:

Add import at top:

```typescript
import slowRedact from 'slow-redact';
```

Add type alias (inline to avoid cross-package dependency):

```typescript
/** String redaction function  - matches autotel's StringRedactor type */
type StringRedactor = (value: string) => string;
```

Add new fields to `PostHogConfig` interface:

```typescript
  /**
   * Known attribute paths to redact using slow-redact (path-based, immutable).
   * Applied before string value scanning.
   *
   * @example
   * ```typescript
   * new PostHogSubscriber({
   *   apiKey: 'phc_...',
   *   redactPaths: ['user.password', 'headers.authorization']
   * })
   * ```
   */
  redactPaths?: string[];

  /**
   * String redactor for value-based PII scanning (emails, phones, etc).
   * Typically provided by autotel's createStringRedactor().
   * Applied after path-based redaction.
   */
  stringRedactor?: StringRedactor;
```

Add private fields to `PostHogSubscriber` class:

```typescript
  private pathRedactor: ((obj: Record<string, unknown>) => string) | null = null;
  private stringRedactor: StringRedactor | null = null;
```

In the constructor, after `this.config = { ... }`, initialize the redactors:

```typescript
    if (this.config.redactPaths && this.config.redactPaths.length > 0) {
      this.pathRedactor = slowRedact({
        paths: this.config.redactPaths,
        serialize: false,
      }) as any;
    }

    if (this.config.stringRedactor) {
      this.stringRedactor = this.config.stringRedactor;
    }
```

Add a private method to apply both redaction layers to properties:

```typescript
  private redactProperties(properties: Record<string, unknown>): Record<string, unknown> {
    // Layer 1: Path-based redaction (slow-redact, structural)
    let result = properties;
    if (this.pathRedactor) {
      result = this.pathRedactor(properties) as Record<string, unknown>;
    }

    // Layer 2: String value scanning (regex-based)
    if (this.stringRedactor) {
      result = this.redactStringValues(result);
    }

    return result;
  }

  private redactStringValues(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.stringRedactor!(value);
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.redactStringValues(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
```

In `sendToDestination()`, add redaction call just before the `distinctId` extraction and capture calls. After the `exception.list` auto-detect block and before line `const distinctId = ...`:

```typescript
    // Apply redaction layers to properties
    const redactedProperties = this.redactProperties(properties);
```

Then replace all subsequent uses of `properties` with `redactedProperties` in the capture calls.

Also pass `stringRedactor` to `formatExceptionForPostHog` in the exception.list auto-detect block:

```typescript
    if (payload.attributes?.['exception.list']) {
      try {
        const exceptionList = JSON.parse(payload.attributes['exception.list'] as string);
        const formatted = formatExceptionForPostHog(
          exceptionList,
          undefined,
          this.stringRedactor ?? undefined,
        );
        // ... rest unchanged, but use redactedProperties
      }
    }
```

**Step 5: Run tests**

Run: `cd packages/autotel-subscribers && pnpm vitest run src/posthog-redaction.test.ts`
Expected: All tests pass

**Step 6: Run full subscriber test suite**

Run: `cd packages/autotel-subscribers && pnpm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/autotel-subscribers/package.json packages/autotel-subscribers/src/posthog.ts packages/autotel-subscribers/src/posthog-redaction.test.ts pnpm-lock.yaml
git commit -m "feat(autotel-subscribers): add slow-redact path-based + string value redaction to PostHogSubscriber"
```

---

### Task 6: Duplicate string redactor in `autotel-web` and wire into error tracking

**Files:**
- Create: `packages/autotel-web/src/error-tracking/redact-values.ts`
- Create: `packages/autotel-web/src/error-tracking/redact-values.test.ts`
- Modify: `packages/autotel-web/src/error-tracking/exception-builder.ts`
- Modify: `packages/autotel-web/src/error-tracking/types.ts`
- Modify: `packages/autotel-web/src/error-tracking/index.ts`
- Modify: `packages/autotel-web/src/full.ts`

**Step 1: Write the failing tests for the duplicated utility**

```typescript
// packages/autotel-web/src/error-tracking/redact-values.test.ts
import { describe, it, expect } from 'vitest';
import { createStringRedactor } from './redact-values';

describe('createStringRedactor (browser)', () => {
  it('redacts emails with default preset', () => {
    const redact = createStringRedactor('default');
    expect(redact('User john@example.com not found')).toBe('User [REDACTED] not found');
  });

  it('redacts credit cards with default preset', () => {
    const redact = createStringRedactor('default');
    expect(redact('Card 4111-1111-1111-1111')).toBe('Card [REDACTED]');
  });

  it('returns input unchanged when no match', () => {
    const redact = createStringRedactor('default');
    expect(redact('TypeError: cannot read property')).toBe('TypeError: cannot read property');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/redact-values.test.ts`
Expected: FAIL  - module not found

**Step 3: Implement the duplicated utility**

```typescript
// packages/autotel-web/src/error-tracking/redact-values.ts
/**
 * String redaction utility for browser environments.
 * Duplicated from autotel core (~30 lines) to avoid cross-package dependency.
 */

export type StringRedactor = (value: string) => string;

interface ValuePatternConfig {
  name: string;
  pattern: RegExp;
  replacement?: string;
}

type RedactorPreset = 'default' | 'strict' | 'pci-dss';

interface RedactorConfig {
  valuePatterns?: ValuePatternConfig[];
  replacement?: string;
}

const PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
  phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  ssn: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
  creditCard: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
  bearerToken: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  apiKeyInValue: /(?:api[_-]?key|apikey|api_secret)[=:][\s"']*[A-Za-z0-9_-]+/gi,
  jwt: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
};

const DEFAULT_PATTERNS: ValuePatternConfig[] = [
  { name: 'email', pattern: PATTERNS.email },
  { name: 'phone', pattern: PATTERNS.phone },
  { name: 'ssn', pattern: PATTERNS.ssn },
  { name: 'creditCard', pattern: PATTERNS.creditCard },
];

const PRESETS: Record<RedactorPreset, RedactorConfig> = {
  default: { valuePatterns: DEFAULT_PATTERNS, replacement: '[REDACTED]' },
  strict: {
    valuePatterns: [
      ...DEFAULT_PATTERNS,
      { name: 'bearerToken', pattern: PATTERNS.bearerToken },
      { name: 'apiKeyInValue', pattern: PATTERNS.apiKeyInValue },
      { name: 'jwt', pattern: PATTERNS.jwt },
    ],
    replacement: '[REDACTED]',
  },
  'pci-dss': {
    valuePatterns: [{ name: 'creditCard', pattern: PATTERNS.creditCard }],
    replacement: '[REDACTED]',
  },
};

export function createStringRedactor(
  config: RedactorConfig | RedactorPreset,
): StringRedactor {
  const resolved = typeof config === 'string' ? PRESETS[config] : config;
  if (!resolved) throw new Error(`Unknown redactor preset: "${config}"`);
  const patterns = resolved.valuePatterns ?? [];
  const replacement = resolved.replacement ?? '[REDACTED]';

  return (value: string): string => {
    let result = value;
    for (const { pattern, replacement: r } of patterns) {
      pattern.lastIndex = 0;
      result = result.replaceAll(pattern, r ?? replacement);
    }
    return result;
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/autotel-web && pnpm vitest run src/error-tracking/redact-values.test.ts`
Expected: PASS

**Step 5: Add `redactor` to `ErrorTrackingConfig` and wire through**

In `packages/autotel-web/src/error-tracking/types.ts`, add import and field:

```typescript
import type { StringRedactor } from './redact-values';
```

Add to `ErrorTrackingConfig`:

```typescript
  /** String redactor for PII in error messages and stack traces */
  redactor?: StringRedactor;
```

In `packages/autotel-web/src/error-tracking/exception-builder.ts`, add redaction:

```typescript
import type { StringRedactor } from './redact-values';
```

Update `buildExceptionList` signature:

```typescript
export function buildExceptionList(
  input: unknown,
  mechanismType: ExceptionMechanism['type'],
  redactor?: StringRedactor,
): ExceptionList {
```

Inside the while loop, redact the value and abs_path:

```typescript
    const record: ExceptionRecord = {
      type: current.name || 'Error',
      value: redactor ? redactor(current.message || 'Unknown error') : (current.message || 'Unknown error'),
      mechanism: { type: mechanismType, handled },
    };

    if (current.stack) {
      const frames = parseStack(current.stack);
      if (frames.length > 0) {
        record.stacktrace = {
          frames: redactor
            ? frames.map((f) => ({
                ...f,
                abs_path: f.abs_path ? redactor(f.abs_path) : f.abs_path,
              }))
            : frames,
        };
      }
    }
```

In `packages/autotel-web/src/error-tracking/index.ts`, pass the redactor through:

In `recordException()`, change:

```typescript
// Before:
const exceptionList = buildExceptionList(error, mechanismType);

// After:
const exceptionList = buildExceptionList(error, mechanismType, config.redactor);
```

In `packages/autotel-web/src/full.ts`, add `attributeRedactor` config option:

Add import:

```typescript
import { createStringRedactor } from './error-tracking/redact-values';
```

Add to `AutotelWebFullConfig`:

```typescript
  /**
   * Redact PII from error messages, stack traces, and attributes before export.
   * Accepts a preset ('default', 'strict', 'pci-dss') or custom config.
   */
  attributeRedactor?: 'default' | 'strict' | 'pci-dss' | { valuePatterns?: Array<{ name: string; pattern: RegExp; replacement?: string }>; replacement?: string };
```

In `initFull()`, before the `setupErrorTracking` call, build the redactor:

```typescript
  const stringRedactor = config.attributeRedactor
    ? createStringRedactor(config.attributeRedactor)
    : undefined;
```

Pass it through:

```typescript
  if (config.captureErrors !== false) {
    setupErrorTracking({
      debug: config.debug ?? false,
      ...config.errorTracking,
      ...(stringRedactor && { redactor: stringRedactor }),
    });
  }
```

**Step 6: Add tests for exception-builder redaction**

Add to existing `packages/autotel-web/src/error-tracking/exception-builder.test.ts`:

```typescript
describe('buildExceptionList with redactor', () => {
  const mockRedactor = (value: string) =>
    value.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, '[REDACTED]');

  it('redacts PII from error message', () => {
    const error = new Error('User john@example.com not found');
    const result = buildExceptionList(error, 'manual', mockRedactor);
    expect(result[0].value).toBe('User [REDACTED] not found');
  });

  it('does not redact without redactor', () => {
    const error = new Error('User john@example.com not found');
    const result = buildExceptionList(error, 'manual');
    expect(result[0].value).toBe('User john@example.com not found');
  });
});
```

**Step 7: Run full test suite**

Run: `cd packages/autotel-web && pnpm test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add packages/autotel-web/src/error-tracking/redact-values.ts packages/autotel-web/src/error-tracking/redact-values.test.ts packages/autotel-web/src/error-tracking/exception-builder.ts packages/autotel-web/src/error-tracking/exception-builder.test.ts packages/autotel-web/src/error-tracking/types.ts packages/autotel-web/src/error-tracking/index.ts packages/autotel-web/src/full.ts
git commit -m "feat(autotel-web): add string redaction to error tracking and wire through initFull()"
```

---

### Task 7: Wire `PostHogSubscriber` to receive redactor from `init()`

**Files:**
- Modify: `packages/autotel/src/init.ts`

**Step 1: Check how subscribers are wired in init()**

Look at how `init()` passes config to subscribers. The `PostHogSubscriber` is instantiated by the user and passed to `init()`, so `init()` can't inject config at construction time. Instead, add a `setStringRedactor()` method on `PostHogSubscriber` that `init()` calls after the subscriber is provided.

**Step 2: Add `setStringRedactor` to PostHogSubscriber**

In `packages/autotel-subscribers/src/posthog.ts`, add method:

```typescript
  /**
   * Set the string redactor. Called by autotel init() when attributeRedactor is configured.
   * Can also be called manually.
   */
  setStringRedactor(redactor: StringRedactor): void {
    this.stringRedactor = redactor;
  }
```

**Step 3: In `init.ts`, call `setStringRedactor` on PostHog subscribers**

After the `_stringRedactor` is set in `init()`, check if any subscriber has `setStringRedactor`:

```typescript
// Wire string redactor to subscribers that support it
if (_stringRedactor && mergedConfig.subscribers) {
  for (const subscriber of mergedConfig.subscribers) {
    if ('setStringRedactor' in subscriber && typeof (subscriber as any).setStringRedactor === 'function') {
      (subscriber as any).setStringRedactor(_stringRedactor);
    }
  }
}
```

**Step 4: Run tests**

Run: `cd packages/autotel && pnpm test && cd ../autotel-subscribers && pnpm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/autotel-subscribers/src/posthog.ts packages/autotel/src/init.ts
git commit -m "feat: wire string redactor from init() to PostHogSubscriber automatically"
```

---

### Task 8: Add changeset and run full quality check

**Files:**
- Create: `.changeset/posthog-redaction.md`

**Step 1: Create changeset**

```bash
cat > .changeset/posthog-redaction.md << 'EOF'
---
"autotel": minor
"autotel-web": minor
"autotel-subscribers": minor
---

Add PII redaction to all PostHog export paths. Two-layer approach: regex value scanning
for emails, phones, credit cards, JWTs in error messages and stack traces, plus slow-redact
path-based redaction for known sensitive fields in structured event attributes.

- Extract `createStringRedactor()` utility from core `AttributeRedactingProcessor`
- Add `RedactingLogRecordProcessor` wrapper for PostHog OTLP logs
- Add redactor support to `posthog-error-formatter` (exception.value, abs_path)
- Add `redactPaths` and `stringRedactor` options to `PostHogSubscriber`
- Duplicate string redactor in `autotel-web` for browser error tracking
- Wire `attributeRedactor` from `init()` through to all PostHog paths automatically
EOF
```

**Step 2: Run full quality check**

Run: `pnpm quality`
Expected: Build + lint + format + type-check + tests all pass

**Step 3: Fix any issues found**

Address lint errors, type errors, or test failures.

**Step 4: Commit**

```bash
git add .changeset/posthog-redaction.md
git commit -m "chore: add changeset for PostHog redaction feature"
```
