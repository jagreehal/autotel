# Configuration, enrichers, backends and redaction

Everything that goes into `init()` and the attribute pipeline in front of the
exporter.

## Configuration options

All options work with `init()`, framework adapters, and `wrapModule` / `defineWorkerFetch`:

| Option                                  | Type                                                            | Default           | Description                                                     |
| --------------------------------------- | --------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| `service` / `service.name`              | `string`                                                        | `'app'`           | Service name in `service.name` resource attribute               |
| `endpoint`                              | `string`                                                        | —                 | Single OTLP destination shorthand                               |
| `destinations`                          | `Array<{ endpoint, headers?, protocol?, signals? }>`            | —                 | Declarative OTLP fan-out to multiple backends                   |
| `spanProcessors`                        | `SpanProcessor[]`                                               | —                 | Use **instead of** `exporter` for full control                  |
| `sampling.rates`                        | `{ server?: number, client?: number, internal?: number }`       | `100%`            | Head sampling per span kind (0–100%)                            |
| `sampling.tail`                         | `TailSampleFn`                                                  | —                 | Keep traces matching predicate (e.g. errors, slow)              |
| `attributeRedactor`                     | `'default' \| 'strict' \| 'pci-dss' \| AttributeRedactorConfig` | —                 | PII redaction; on by default in production                      |
| `instrumentation.disabled`              | `boolean`                                                       | `false`           | Hard-off switch (ideal for local dev)                           |
| `instrumentation.instrumentGlobalFetch` | `boolean`                                                       | `true`            | Patch `globalThis.fetch` for outbound HTTP spans                |
| `subscribers`                           | `EdgeSubscriber[]`                                              | —                 | In-process side effects (metrics, audit, AI cost)               |
| `postProcessor`                         | `PostProcessorFn`                                               | —                 | Mutate spans before export (redact, drop, tag)                  |
| `propagator`                            | `TextMapPropagator`                                             | W3C trace-context | Override propagation format                                     |
| `dataSafety`                            | `DataSafetyConfig`                                              | —                 | Per-attribute safety (`captureDbStatement: 'obfuscated'`, etc.) |

## Built-in enrichers

Enrichers turn raw request data into standard, low-cardinality span attributes. Import the helpers from `autotel/enrichers` and spread their output onto the active span or request logger. Each returns `undefined` when there is nothing to add, so spreading is safe.

| Helper                                 | Returns attributes                                                           | Source                          |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| `userAgent(headers)`                   | `user_agent.raw`, `user_agent.browser`, `user_agent.os`, `user_agent.device` | `user-agent` request header     |
| `geo(headers)`                         | `geo.country`, `geo.region`, `geo.city`, `geo.latitude`, `geo.longitude`     | Vercel / Cloudflare geo headers |
| `requestSize(reqHeaders, resHeaders?)` | `http.request.body.size`, `http.response.body.size`                          | `content-length` headers        |

```typescript
import { withTracing } from 'autotel';
import { userAgent, geo, requestSize } from 'autotel/enrichers';

export const handler = withTracing({ name: 'http.request' })(
  (ctx) => async (request: Request) => {
    ctx.setAttributes({
      ...userAgent(request.headers),
      ...geo(request.headers),
      ...requestSize(request.headers),
    });
    // ... handle request
  },
);
```

For your own derived fields on a request's wide event, build a reusable enricher with `defineEnricher` (from `autotel`) instead of scattering ad-hoc field writes. `compute` returns an object that is merged into the named `field`; return `undefined` to skip. Keep the output low-cardinality (bucket or hash high-cardinality values):

```typescript
import { defineEnricher } from 'autotel';

// Merge a derived, low-cardinality object into event.user on each request.
const enrichTier = defineEnricher<
  { user?: { plan?: string } },
  { tier: string }
>({
  name: 'user-tier',
  field: 'user',
  compute: ({ event }) => ({ tier: event.user?.plan ?? 'anonymous' }),
});
```

**Review checks:** raw `User-Agent` strings stored verbatim (use `userAgent()` to parse), geo data hand-parsed per framework (use `geo()`), and high-cardinality values (full URLs, emails, ids) set directly as attributes instead of being bucketed or hashed.

## Backends (multi-vendor OTLP)

Switch backends with **no code changes**. Autotel speaks OTLP HTTP/JSON and HTTP/protobuf out of the box.

| Backend                          | Endpoint                                                   | Headers                               |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Honeycomb                        | `https://api.honeycomb.io/v1/traces`                       | `{ 'x-honeycomb-team': '<key>' }`     |
| Grafana Cloud                    | `https://otlp-gateway-<region>.grafana.net/otlp/v1/traces` | `{ authorization: 'Basic <b64>' }`    |
| Datadog (OTLP intake)            | `https://trace.agent.datadoghq.com/api/v0.4/traces`        | `{ 'dd-api-key': '<key>' }`           |
| Sentry                           | `<dsn>/api/<id>/envelope/` (use `autotel-sentry`)          | `{ 'x-sentry-auth': '…' }`            |
| Axiom                            | `https://api.axiom.co/v1/traces`                           | `{ authorization: 'Bearer <token>' }` |
| HyperDX                          | `https://in-otel.hyperdx.io/v1/traces`                     | `{ authorization: '<key>' }`          |
| New Relic                        | `https://otlp.nr-data.net/v1/traces`                       | `{ 'api-key': '<key>' }`              |
| Local Jaeger / Tempo / Collector | `http://localhost:4318/v1/traces`                          | —                                     |

Use `init({ endpoint, headers })` for one backend. For multiple OTLP backends, prefer `init({ destinations: [...] })`. Drop to `composeSpanProcessors([batchA, batchB])` only when you need custom processor-level control.

Ready-made presets with the auth headers already wired: `skills/integrations/autotel-backends/SKILL.md`.

## Auto-redaction (PII protection)

Built-in masking scrubs sensitive data from span attributes **before** export. **On by default in production**, off in development. Smart partial masking preserves debug signal:

| Pattern      | Example input         | Masked output                                |
| ------------ | --------------------- | -------------------------------------------- |
| `creditCard` | `4111-1111-1111-1111` | `****1111` (PCI-DSS compliant)               |
| `email`      | `alice@example.com`   | `a***@***.com`                               |
| `ipv4`       | `192.168.1.100`       | `***.***.***.100`                            |
| `phone`      | `+33 6 12 34 56 78`   | `+33******78` (requires `+cc` or `(parens)`) |
| `jwt`        | `eyJhbGciOi…`         | `eyJ***.***`                                 |
| `bearer`     | `Bearer sk_live_abc…` | `Bearer ***`                                 |
| `iban`       | `FR76 3000 6000 …189` | `FR76****189`                                |

Three presets ship out of the box: `'default'` (PII-grade), `'strict'` (adds JWT / Bearer / IBAN, redacts more keys), `'pci-dss'` (cards only, PCI focus).

```typescript
init({
  service: 'my-app',
  attributeRedactor: 'default',
});
```

Custom config:

```typescript
import { builtinPatterns, type AttributeRedactorConfig } from 'autotel';

const config: AttributeRedactorConfig = {
  keyPatterns: [/password/i, /^x-internal-/i],
  builtins: ['email', 'creditCard', 'jwt'], // pick specific masks
  valuePatterns: [
    { name: 'customerId', pattern: /CUST-\d{8}/g, replacement: 'CUST-***' },
  ],
};
init({ attributeRedactor: config });
```

For free-text fields outside the span pipeline (logs, error messages, frontend payloads), use `createStringRedactor('default')`. Same masks, returns a `(s: string) => string`.
