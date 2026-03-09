# PostHog Export Redaction Design

**Goal:** Add PII/sensitive data redaction to all PostHog data export paths  - error tracking, OTLP logs, and subscriber events.

**Problem:** Core autotel's `AttributeRedactingProcessor` only protects span export. Three PostHog paths send data unredacted: `posthog-logs.ts` (OTLP log export), `posthog-error-formatter.ts` (exception formatting), and `PostHogSubscriber.sendToDestination()` (event attributes). Error messages, stack traces, and event properties can contain PII (emails, tokens, file paths with usernames).

**Approach:** Two-layer redaction  - regex value scanning for PII in strings + `slow-redact` for known sensitive paths in structured objects.

---

## Layer 1: String Redactor (regex value scanning)

Extract the string redaction logic from `attribute-redacting-processor.ts` into a standalone utility.

**New file:** `packages/autotel/src/redact-values.ts`

```typescript
export type StringRedactor = (value: string) => string;

export function createStringRedactor(
  config: AttributeRedactorConfig | AttributeRedactorPreset
): StringRedactor;
```

Reuses existing `REDACTOR_PATTERNS` (emails, phones, SSNs, credit cards, JWTs, bearer tokens) and `REDACTOR_PRESETS` (`default`, `strict`, `pci-dss`). The existing `AttributeRedactingProcessor` is refactored to use this internally (no behavior change).

**Browser side:** Duplicate the ~30 lines of string redaction in `autotel-web`  - no new shared package, patterns are stable, avoids cross-package dependency.

Exported from `autotel` public API for `autotel-subscribers` to import.

## Layer 2: Path-based Redaction (slow-redact)

`slow-redact` (real dependency of `autotel-subscribers`) provides immutable path-based redaction for structured event attribute objects.

**Config:** New `redactPaths` option on `PostHogConfig`:

```typescript
new PostHogSubscriber({
  apiKey: 'phc_...',
  redactPaths: ['user.password', 'headers.authorization', 'body.token']
})
```

Immutable  - original event objects never mutated. Competitive performance via selective cloning.

## Where Each Layer Applies

| Export Path | Layer 1 (regex) | Layer 2 (slow-redact) |
|---|---|---|
| `autotel-web` `buildExceptionList()` | `exception.value`, `abs_path` | N/A (browser, fixed shape) |
| `posthog-error-formatter.ts` | `exception.value`, `abs_path` | N/A (fixed shape) |
| `posthog-logs.ts` log processor | Log body, string attributes | N/A (OTel SDK objects) |
| `PostHogSubscriber.sendToDestination()` | Remaining string values | Known sensitive paths |

In `sendToDestination()`, both layers run: slow-redact first (structural), then string redactor sweeps remaining values.

## What Gets Redacted

**Redacted:**
- `exception.value`  - error messages (main PII risk: `"User john@email.com not found"`)
- `abs_path` in stack frames  - can contain usernames, tokens in query strings
- Log body strings  - same risk as error messages
- Known attribute paths via `redactPaths` config
- All remaining string attribute values via regex patterns

**Not redacted:**
- `exception.type`  - class names (`TypeError`), never contain PII
- `function` names in stack frames  - code identifiers
- `filename`  - basename only, low risk, redacting breaks debugging
- `lineno`/`colno`  - numbers

## Config Flow

**Server-side (`autotel` core):**
- `init({ attributeRedactor: 'default' })` stores resolved config
- New export: `getStringRedactor(): StringRedactor | null`
- `buildPostHogLogProcessors()` calls `getStringRedactor()` to wrap log processor
- `PostHogSubscriber` receives string redactor via `stringRedactor` field on config; `init()` passes through when wiring

**Browser-side (`autotel-web`):**
- `ErrorTrackingConfig` gets optional `redactor?: StringRedactor`
- `initFull()` gets optional `attributeRedactor` config (preset or custom)
- Creates string redactor locally (duplicated utility) and passes to `setupErrorTracking()`

## Default Behavior

- `attributeRedactor` configured → all paths get value scanning automatically
- `redactPaths` configured on `PostHogSubscriber` → slow-redact runs on event attributes
- Neither configured → no redaction (opt-in, same as today's span redaction)

## Dependencies

- `slow-redact`  - real dependency of `autotel-subscribers` (not optional)
- No new shared packages  - string redactor duplicated in `autotel-web` (~30 lines)
