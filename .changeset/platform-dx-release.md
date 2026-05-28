---
'autotel': minor
'autotel-web': minor
'autotel-adapters': minor
'autotel-devtools': minor
'autotel-subscribers': minor
'autotel-terminal': minor
---

### autotel-web — W3C baggage propagation

Add end-to-end business-context propagation via W3C baggage.

New `setBaggage(record)` / `clearBaggage(key?)` runtime API and an `init({ baggage: { initial, allowedOrigins } })` config option let you attach context such as `tenant.id` that travels with every instrumented request as a W3C `baggage` header and is tagged onto every browser-recorded span. On the backend, autotel's `BaggageSpanProcessor` copies the entries onto server spans, so a single attribute (e.g. `tenant.id`) appears on browser and server spans across the whole trace — no more reading the tenant from request URLs in devtools.

`setBaggage()` merges additively (matching Sentry `setTags` / Datadog `setGlobalContextProperty` ergonomics) and works for values known only at runtime (post-login, tenant switcher). Baggage injection is **fail-closed**: it is sent only to same-origin requests unless a destination is listed in `baggage.allowedOrigins`, and never travels wider than `traceparent` (inherits DNT/GPC/blocked-origin suppression), so customer-identifying values are not leaked to third-party origins. Covers both `fetch` and `XMLHttpRequest`.

### autotel-adapters — Express, Fastify, auto-emit

Add Express and Fastify adapters and emit one canonical wide event per request by default across all adapters.

`autotel-adapters/express` and `autotel-adapters/fastify` expose `withAutotel(handler, options)` and `useLogger(request)`, matching the existing Next, Nitro, and Cloudflare adapters. Each request opens a span, gets a request-scoped logger, and emits one canonical wide event when the handler settles.

```typescript
import { withAutotel, useLogger } from 'autotel-adapters/express';

app.get('/orders', withAutotel((req, res) => {
  useLogger(req).set({ feature: 'checkout' });
  res.json({ ok: true });
}));
```

The Express wrapper records thrown errors and forwards them to `next`; the Fastify wrapper records and rethrows for Fastify's error handling.

**Behavior change:** `autoEmit` now defaults to `true` for every adapter, including the existing Next, Nitro, and Cloudflare wrappers. Each wrapped handler emits one wide event per request. Pass `{ autoEmit: false }` to restore the previous behavior of not emitting automatically.

### autotel — PII redaction, catalogs, LLM cost

**Auto-enable PII redaction in production.** When `attributeRedactor` is left unset and the resolved environment is `production` (`config.environment` or `NODE_ENV`), `init()` now applies the `'default'` redaction preset. Span attributes are scrubbed of emails, phones, SSNs, credit cards, and sensitive keys before any exporter sees them. In non-production environments redaction stays off so local debugging shows real values.

**Behavior change:** production telemetry that previously exported raw values now has PII redacted by default. Control it:

- `init({ attributeRedactor: 'strict' })` — stronger preset, applied in every environment.
- `init({ attributeRedactor: false })` — disable redaction entirely, even in production.
- `AUTOTEL_REDACT_PII` env var — `off` disables, `default` / `strict` / `pci-dss` selects a preset, `on` forces the default preset on in any environment.

Precedence: explicit config, then env var, then the production default. The `attributeRedactor` config field now also accepts `false`.

**Typed error and audit catalogs:** `defineErrorCatalog()` and `defineAuditCatalog()`.

Group related errors into one catalog and get a refactor-safe builder per code, with autocomplete at every call site and typed message parameters. Each builder produces a `StructuredError` carrying the entry's `message`, `status`, `code`, `why`, `fix`, and `link`; codes default to `${namespace}.${KEY}`.

```typescript
import { defineErrorCatalog } from 'autotel';

const billing = defineErrorCatalog('billing', {
  PAYMENT_DECLINED: { status: 402, message: 'Card declined', why: '...', fix: '...' },
  INSUFFICIENT_FUNDS: {
    status: 402,
    message: ({ available, required }: { available: number; required: number }) =>
      `Insufficient funds: $${available} of $${required}`,
  },
});

throw billing.PAYMENT_DECLINED({ cause: stripeError });
throw billing.INSUFFICIENT_FUNDS({ available: 5, required: 100 });

if (billing.PAYMENT_DECLINED.match(err)) { /* ... */ }
```

`defineAuditCatalog()` produces typed audit-action descriptors (`action`, `severity`, optional `message`). Helpers `isCatalogError()` and `getCatalogCode()` read the catalog code off any error.

**Per-model LLM cost estimation:** `estimateLLMCost()`, `recordLLMCost()`, and a `MODEL_PRICING` table.

Estimate the USD cost of an LLM call from its token usage and record it as the `gen_ai.usage.cost.usd` span attribute, pairing with the existing `gen_ai.client.cost.usd` metric bucket advice.

```typescript
import { trace, recordLLMCost } from 'autotel';

export const chat = trace((ctx) => async (prompt: string) => {
  const res = await client.messages.create({ model, /* ... */ });
  recordLLMCost(ctx, model, {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  });
  return res;
});
```

`MODEL_PRICING` ships approximate public list prices for common OpenAI, Anthropic, and Gemini models; override or extend per call via `{ pricing }`. Versioned model ids resolve to a base entry by longest-prefix match, and cached input tokens are billed at `cachedInputPer1M` when provided.

### autotel-devtools — HTTP read-back and dual-stack loopback

- **`GET /v1/traces`** returns the traces the receiver has actually captured (`{ traces, count }`), and **`DELETE /v1/traces`** clears captured telemetry. This lets integration/Playwright tests verify the collector *received* spans by polling it over HTTP — instead of only asserting "the client tried to send", which a browser-level route intercept can fulfil before the request ever reaches a server.
- **Dual-stack loopback:** when bound to a loopback host, the CLI and `createDevtools()` now listen on **both** `127.0.0.1` and `::1`, so a client connecting via `localhost` reaches the receiver regardless of how the OS resolves `localhost` (macOS prefers IPv6 `::1`). This removes a silent footgun where a dev-server proxy targeting `localhost` saw its spans vanish with no error against an IPv4-only receiver.
- **Startup self-check:** the CLI prints every bound address, a `curl .../v1/traces` verification hint, and a warning (not a silent failure) if a loopback family can't be bound.
- New README sections: "Behind a dev-server proxy" (the `pathRewrite` + `127.0.0.1` gotchas) and "Verifying ingestion in tests".

### autotel-subscribers — FileSubscriber

Add `FileSubscriber` (`autotel-subscribers/file`): append tracked events to a file as newline-delimited JSON (NDJSON).

Useful for AI agents, scripts, evals, and local debugging that want structured events on disk without a hosted backend. Query the file with `jq`, load it into a notebook, or feed it to an agent.

```typescript
import { Event } from 'autotel/events';
import { FileSubscriber } from 'autotel-subscribers/file';

const events = new Event('worker', {
  subscribers: [new FileSubscriber({ path: './telemetry/events.ndjson' })],
});
```

Writes are serialized so concurrent events never interleave. Options: `pretty` for indented JSON, `mkdir` to create parent directories (default on), and `transform` to reshape or drop events before writing.

### autotel-terminal — dual-stack loopback

Bind both loopback families and warn on partial binding.

When bound to a loopback host, the receiver now listens on **both** `127.0.0.1` and `::1`, so a client (or dev-server proxy) connecting via `localhost` reaches it regardless of how the OS resolves `localhost` (macOS prefers IPv6 `::1`). Previously the CLI bound IPv4-only, so a `localhost` proxy could silently send spans into a black hole. The startup line now prints every bound address and warns (rather than failing silently) if a loopback family can't be bound. Added a README "Behind a dev-server proxy" section documenting the `pathRewrite` + `127.0.0.1` gotchas.
