# Error Tracking Design

Full observability for apps: errors sent to PostHog error tracking UI, correlated with OTel traces, enriched with product context. Benefits all users regardless of backend.

## Architecture

Three independent layers, each useful on its own:

```
Layer 1: autotel-web (rich error capture for everyone)
    ↓ structured error data on OTel spans
Layer 2: autotel init({ posthog: { url } }) (OTLP logs → PostHog)
    ↓ auto-wired log exporter
Layer 3: PostHogSubscriber (product events + captureException via capture API)
```

## Layer 1: autotel-web Enhanced Error Capture

Replaces current `src/errors.ts` (66 lines) with a full error tracking module. Ships in `autotel-web/full` only  - lean mode stays untouched.

### New files in `packages/autotel-web/src/error-tracking/`

**`types.ts`**  - Structured error types (no dependencies)

```typescript
interface StackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  abs_path?: string;
  in_app?: boolean;
}

interface ExceptionRecord {
  type: string;
  value: string;
  mechanism: { type: string; handled: boolean };
  stacktrace?: { frames: StackFrame[] };
}

type ExceptionList = ExceptionRecord[];
```

**`stack-parser.ts`**  - Parse `error.stack` into structured frames. Handles Chrome, Firefox, Safari formats. ~150 lines.

**`exception-builder.ts`**  - Build `ExceptionList` from any error. Normalizes unknown → Error. Walks `error.cause` chain. Calls stack parser for each error in chain.

**`rate-limiter.ts`**  - Per-exception-type rate limiting. Default: 10 per type per 10 seconds (configurable).

**`suppression.ts`**  - Filter known noise. Rules match by exception type and/or message (regex, exact, contains).

**`index.ts`**  - Main `setupErrorTracking()` replacing current `setupErrorCapture()`.
- Global listeners: `window.onerror`, `unhandledrejection`, `console.error` (opt-in)
- Builds `ExceptionList`, rate-limits, checks suppression
- Records on OTel span with structured attributes: `exception.list` (JSON), `exception.type`, `exception.message`, `error.source`
- Exposes `captureException(error)` for manual capture
- Detects `window.posthog`  - if present and capturing errors, skips autocapture (avoids doubles) but still enriches OTel spans

### Config additions to `AutotelWebFullConfig`

```typescript
errorTracking?: {
  rateLimit?: { maxPerType: number; windowMs: number };
  suppressionRules?: SuppressionRule[];
  captureConsoleErrors?: boolean;
  deferToPostHog?: boolean; // default: true
};
```

### Public API addition

Exported from `autotel-web/full`:

```typescript
export { captureException } from './error-tracking';
```

## Layer 2: PostHog via init()

`autotel` core gets a first-class PostHog shortcut that auto-wires `BatchLogRecordProcessor` + `OTLPLogExporter`.

### User experience

```typescript
import { init } from 'autotel';

// Explicit config
init({
  service: 'my-app',
  posthog: { url: 'https://us.i.posthog.com/i/v1/logs?token=phc_xxx' }
});

// Or just set env var  - zero config
// POSTHOG_LOGS_URL=https://us.i.posthog.com/i/v1/logs?token=phc_xxx
init({ service: 'my-app' });
```

### Resolution order

1. `config.posthog.url` if provided
2. `process.env.POSTHOG_LOGS_URL` if set
3. Disabled (no log exporter)

### What it does under the hood

Creates `BatchLogRecordProcessor` + `OTLPLogExporter` pointing at the URL. Registers on the SDK. Structured error logs from autotel-web flow to PostHog. Logs-only (PostHog does not have `/v1/traces`).

### New dependencies for autotel core

- `@opentelemetry/sdk-logs`
- `@opentelemetry/exporter-logs-otlp-http`

Both OTel ecosystem. Only loaded when PostHog URL is configured.

## Layer 3: PostHogSubscriber Enhancements

The existing subscriber in `autotel-subscribers` gets error tracking capabilities.

### New method

```typescript
async captureException(
  error: unknown,
  options?: {
    distinctId?: string;
    additionalProperties?: Record<string, unknown>;
  }
): Promise<void>
```

### Behavior by client type

**Browser client (`window.posthog`):** Delegates to `posthog.captureException(error)`  - PostHog handles stack parsing, grouping. Adds trace correlation: `$trace_id`, `$span_id`, `$trace_url`.

**Server client (posthog-node):** Builds `$exception_list` payload and sends via `posthog.capture({ event: '$exception', properties: { $exception_list, ... } })`.

### New file: `src/posthog-error-formatter.ts`

Maps autotel-web's `ExceptionList` (or raw Error) to PostHog's `$exception_list` format. Adds `platform: 'web:javascript'` or `'node:javascript'` on frames. Minimal code  - formats are nearly identical by design.

### Auto-detection of error spans

`sendToDestination()` checks for `exception.list` in payload attributes. If present, also sends as `$exception` event with trace correlation.

### Combined usage

```typescript
init({
  service: 'my-app',
  posthog: { url: 'https://us.i.posthog.com/i/v1/logs?token=phc_xxx' },
  subscribers: [
    new PostHogSubscriber({ apiKey: 'phc_xxx' })  // product events
  ]
});
```

## Package Boundaries

| Package | Changes | New deps |
|---------|---------|----------|
| `autotel-web` | Error tracking module (stack parser, exception builder, rate limiter, suppression, `captureException()`) | None |
| `autotel` | `posthog: { url }` in init config, `POSTHOG_LOGS_URL` env, auto-wire log exporter | `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-http` |
| `autotel-subscribers` | `captureException()` on PostHogSubscriber, `$exception` formatting, `posthog-error-formatter.ts` | None |

## Testing Strategy

### autotel-web error tracking (unit tests)

- `stack-parser.test.ts`  - Chrome, Firefox, Safari stack formats → structured frames
- `exception-builder.test.ts`  - Error, string, unknown, `.cause` chains → ExceptionList
- `rate-limiter.test.ts`  - allows N per window, blocks after
- `suppression.test.ts`  - regex/exact/contains rules filter correctly
- `error-tracking.test.ts`  - simulated window events → OTel spans with structured attributes, `window.posthog` detection skips autocapture

### autotel init PostHog wiring (unit tests)

- Config `posthog.url` creates log exporter
- `POSTHOG_LOGS_URL` env fallback works
- Neither set → no exporter
- `BatchLogRecordProcessor` configured correctly

### autotel-subscribers PostHog errors (unit tests)

- `captureException()` with browser client → delegates to `posthog.captureException()`
- `captureException()` with node client → sends `$exception` event with `$exception_list`
- Error spans in event pipeline → auto-formatted as `$exception`
- Trace correlation properties present on all exception events

## Tree-shaking

- Error tracking only pulled in via `autotel-web/full`
- Lean mode unaffected
- PostHog log exporter behind runtime check (server-side, bundle size irrelevant)
- `posthog-error-formatter.ts` only imported by PostHogSubscriber

## Decisions

- No dependency on `posthog-js`  - error types modeled to be compatible but independent
- PostHog does not have `/v1/traces`  - logs-only via OTLP
- `window.posthog` detection avoids double-capture in browser
- Env var `POSTHOG_LOGS_URL` for zero-config serverless deployments
