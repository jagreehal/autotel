---
name: autotel-patterns
description: "Core patterns for autotel: OpenTelemetry instrumentation for Node.js and edge runtimes. Use when instrumenting with trace/span/track, configuring init(), adding subscribers, or working in the autotel monorepo."
user-invocable: true
---

# Autotel Core Patterns

**Use this skill when writing or modifying autotel instrumentation, adding event subscribers, or contributing to the autotel packages.**

Philosophy: "Write once, observe everywhere" — instrument once, stream to any OTLP-compatible backend.

---

## Rules

### R1: init() is synchronous; use node-require for dynamic loading

`init()` must remain synchronous. Do not use `await import()` for optional or lazy dependencies. Use the repo's `node-require` helpers (`safeRequire`, `requireModule`) so tree-shaking and sync init are preserved.

```typescript
// CORRECT - optional dependency
import { safeRequire } from './node-require';
const pkg = safeRequire('optional-pkg');
if (pkg) pkg.initialize();

// WRONG - breaks sync init and tree-shaking
const pkg = await import('optional-pkg');
```

### R2: Functional API for tracing

Use `trace()`, `span()`, and `instrument()` to wrap business logic. They manage span lifecycle; do not manually start/end spans for app code unless implementing low-level SDK glue.

```typescript
import { trace, span } from 'autotel';

// Wrapper with automatic span
const createUser = trace(async (data) => {
  return await db.users.create(data);
});

// Nested span
span('db.insert', async () => {
  await db.insert(record);
});
```

### R3: track() and event context

Events are enqueued and delivered asynchronously. When `events.includeTraceContext` is set in `init()`, the global `track()` path builds the same autotel context (correlation_id, trace_id, span_id, trace_url) as the Event class and passes it to subscribers via the third parameter. Subscribers (e.g. WebhookSubscriber) should accept `options?: EventTrackingOptions` and forward `options.autotel` in the payload.

```typescript
import { track, getEventQueue } from 'autotel';

track('user.signup', { userId: '123', plan: 'pro' });

// Before assert or process exit: flush
await getEventQueue()?.flush();
```

### R4: Correlation ID at boundaries

Use `getOrCreateCorrelationId()` or `getCorrelationId()` from `autotel`. Set at request/message boundaries with `runWithCorrelationId(id, fn)` or `setCorrelationId(id)` from `autotel/correlation-id`. Same ID for the whole AsyncLocalStorage context; new context gets a new ID unless you propagate (e.g. baggage, Kafka headers).

```typescript
import { getOrCreateCorrelationId } from 'autotel';
import { runWithCorrelationId } from 'autotel/correlation-id';

const correlationId = getOrCreateCorrelationId();
// Or at boundary:
runWithCorrelationId(incomingId, () => handleRequest());
```

### R5: Tree-shaking and exports

All packages use explicit `exports` in `package.json`. Do not add barrel re-exports that pull in unused code. New entry points (e.g. `autotel/correlation-id`) must be listed in `exports` and built (tsup) so they remain tree-shakeable.

---

## Disallowed

| Pattern | Why |
| ------- | --- |
| `await import()` for optional/lazy deps | Breaks synchronous init; use node-require helpers |
| Manual span start/end for app logic | Use `trace()` / `span()` / `instrument()` |
| Subscriber ignores third param `options` | Payload loses correlation_id / trace_url; accept `EventTrackingOptions` and forward `options.autotel` |
| Asserting on event delivery without flush | Events are batched; call `getEventQueue()?.flush()` before assertions or shutdown |
| Adding dependencies without asking | Repo rule: ask first for new deps and build config changes |

---

## Package layout

| Package | Role |
| ------- | ---- |
| `packages/autotel` | Node.js core: init, trace, span, track, event-queue, validation, correlation-id |
| `packages/autotel-edge` | Edge runtime foundation |
| `packages/autotel-cloudflare` | Cloudflare Workers |
| `packages/autotel-mcp` | MCP instrumentation |
| `packages/autotel-tanstack` | TanStack Start |
| `packages/autotel-subscribers` | Event subscribers (PostHog, Mixpanel, Webhook, etc.) |

Each package has a `CLAUDE.md` (or similar) for local conventions. See root `CLAUDE.md` and `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/DEVELOPMENT.md` for commands and patterns.

---

## Quick commands

```bash
pnpm build    # Build all
pnpm test     # Run all tests
pnpm lint     # Lint
pnpm quality  # build + lint + format + type-check + test
pnpm changeset
```

---

## Testing

- Unit tests: `*.test.ts` (excluded from integration config).
- Integration tests: `*.integration.test.ts` (require OTel SDK setup).
- When testing event tracking, flush before asserting: `await getEventQueue()?.flush();` then assert on subscriber payloads.
