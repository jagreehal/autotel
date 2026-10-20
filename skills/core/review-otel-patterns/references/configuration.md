# Configuration, enrichers, backends and redaction

Everything that goes into `init()` and the attribute pipeline in front of the
exporter.

## Configuration options (Node `init()` from `autotel`)

| Option                 | Type                                                                     | Default                                              | Description                                                                       |
| ---------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `service`              | `string`                                                                 | **required** (`OTEL_SERVICE_NAME` fills it from env) | `service.name` resource attribute                                                 |
| `endpoint`             | `string` (base URL)                                                      | `OTEL_EXPORTER_OTLP_ENDPOINT`, else no export        | Single OTLP destination; `/v1/traces` etc. is appended for you                    |
| `headers`              | `Record<string, string> \| string`                                       | `OTEL_EXPORTER_OTLP_HEADERS`                         | Auth headers for `endpoint`                                                       |
| `protocol`             | `'http' \| 'http/protobuf' \| 'grpc'`                                    | `'http'` (JSON body)                                 | protobuf / gRPC need their exporter packages installed                            |
| `destinations`         | `Array<{ endpoint, headers?, protocol?, signals? }>`                     | —                                                    | Declarative OTLP fan-out to multiple backends                                     |
| `spanProcessors`       | `SpanProcessor[]`                                                        | —                                                    | Replaces the built-in OTLP processors entirely                                    |
| `sampling`             | `'development' \| 'errors-only' \| 'production' \| 'off'`                | `'production'` (10% + errors + slow > 1s)            | Sampling preset                                                                   |
| `sampler`              | `Sampler`                                                                | —                                                    | Custom sampler; wins over `sampling`                                              |
| `attributeRedactor`    | `'default' \| 'strict' \| 'pci-dss' \| AttributeRedactorConfig \| false` | `'default'` when environment is `production`         | PII redaction before export                                                       |
| `spanFilter`           | `(span: ReadableSpan) => boolean`                                        | —                                                    | Return `false` to drop a span (health checks, noise)                              |
| `spanNameNormalizer`   | `'rest-api' \| 'graphql' \| 'minimal' \| (name) => string`               | —                                                    | Bound span-name cardinality                                                       |
| `baggage`              | `boolean \| string`                                                      | off                                                  | Copy baggage onto spans (`true` → `baggage.*`, string → custom prefix)            |
| `autoInstrumentations` | `boolean \| string[] \| Record<string, { enabled? }>`                    | off                                                  | `@opentelemetry/auto-instrumentations-node` (peer dep), e.g. `['http', 'undici']` |
| `environment`          | `string`                                                                 | `NODE_ENV`, else `'development'`                     | `deployment.environment.name`; drives auto-redaction                              |
| `debug`                | `boolean \| 'pretty'`                                                    | —                                                    | Print spans locally                                                               |

Edge runtimes (`wrapModule` / `defineWorkerFetch` / `instrument` from `autotel-cloudflare`, typed with `defineConfig` from `autotel-edge`) take a different config: `service: { name }`, `exporter: { url, headers }` (the **full** URL, e.g. `.../v1/traces`), `sampling: { headSampler, tailSampler }`, `instrumentation: { instrumentGlobalFetch }` (default `true`), `postProcessor`, `subscribers`, `propagator`, `dataSafety`. There is no `attributeRedactor` on edge. See [processor-pipeline.md](processor-pipeline.md).

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

Switch backends with **no code changes**. Autotel speaks OTLP HTTP/JSON by default; HTTP/protobuf and gRPC with their exporter packages installed. `endpoint` is a **base URL**: autotel appends `/v1/traces`, `/v1/metrics`, `/v1/logs`.

| Backend                          | `endpoint`                                               | Headers                                                          |
| -------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Honeycomb                        | `https://api.honeycomb.io`                               | `{ 'x-honeycomb-team': '<key>' }`                                |
| Grafana Cloud                    | `https://otlp-gateway-<region>.grafana.net/otlp`         | `{ authorization: 'Basic <b64>' }`                               |
| Datadog (agentless OTLP)         | `https://otlp.<site>` (e.g. `otlp.datadoghq.com`)        | `{ 'dd-api-key': '<key>' }` (or `createDatadogConfig`)           |
| Sentry                           | `sentryOtlpConfig(dsn).endpoint` (`autotel-sentry`)      | `sentryOtlpConfig(dsn).headers`                                  |
| Axiom                            | `https://api.axiom.co`                                   | `{ authorization: 'Bearer <token>', 'x-axiom-dataset': '<ds>' }` |
| HyperDX                          | `https://in-otel.hyperdx.io`                             | `{ authorization: '<key>' }`                                     |
| New Relic                        | `https://otlp.nr-data.net` (EU: `otlp.eu01.nr-data.net`) | `{ 'api-key': '<license key>' }`, `protocol: 'http/protobuf'`    |
| Local Jaeger / Tempo / Collector | `http://localhost:4318`                                  | —                                                                |

New Relic recommends OTLP protobuf, which needs `@opentelemetry/exporter-trace-otlp-proto` installed.

Use `init({ endpoint, headers })` for one backend. For multiple OTLP backends, use `init({ destinations: [...] })`. Drop to `spanProcessors` only when you need custom processor-level control (it replaces the built-in processors).

Ready-made presets with the auth headers already wired (`createHoneycombConfig`, `createDatadogConfig`, `createGrafanaConfig`, … from `autotel-backends/<vendor>`): `skills/integrations/autotel-backends/SKILL.md`.

## Auto-redaction (PII protection)

Built-in masking scrubs sensitive data from span attributes **before** export. When `attributeRedactor` is unset, `init()` applies `'default'` if the resolved environment is `production` (`environment` option, else `NODE_ENV`, else `'development'`), and nothing otherwise. `AUTOTEL_REDACT_PII` (`off` / `default` / `strict` / `pci-dss`) overrides that; `attributeRedactor: false` disables it. Smart partial masking preserves debug signal:

| Pattern      | Example input         | Masked output                  |
| ------------ | --------------------- | ------------------------------ |
| `creditCard` | `4111-1111-1111-1111` | `****1111` (PCI-DSS compliant) |
| `email`      | `alice@example.com`   | `a***@***.com`                 |
| `ipv4`       | `192.168.1.100`       | `***.***.***.100`              |
| `phone`      | `+33 6 12 34 56 78`   | `+33******78`                  |
| `jwt`        | `eyJhbGciOi…`         | `eyJ***.***`                   |
| `bearer`     | `Bearer sk_live_abc…` | `Bearer ***`                   |
| `iban`       | `FR76 3000 6000 …189` | `FR76****189`                  |

Three presets ship out of the box: `'default'` (all built-in masks plus sensitive keys like `password` / `token` / `authorization`), `'strict'` (adds `bearer` / `jwt` key patterns and API keys in values), `'pci-dss'` (cards only, plus `card` / `cvv` / `pan` / `expir` keys).

```typescript
init({
  service: 'my-app',
  attributeRedactor: 'default',
});
```

Custom config:

```typescript
import { init, type AttributeRedactorConfig } from 'autotel';

const config: AttributeRedactorConfig = {
  keyPatterns: [/password/i, /^x-internal-/i],
  builtins: ['email', 'creditCard', 'jwt'], // pick specific masks
  valuePatterns: [
    { name: 'customerId', pattern: /CUST-\d{8}/g, replacement: 'CUST-***' },
  ],
};
init({ service: 'my-app', attributeRedactor: config });
```

All three presets also replace query and fragment values in `url.full`, `url.query`, `http.url` and `http.target` with `REDACTED` (names kept), and literals in MongoDB query text (`db.query.text`, `db.statement`) with `?`. A custom config opts in with `urlQueryValues: true` and `mongoQueryLiterals: true`.

Each key pattern is tested against the full key and its last dot segment, so `/^x-internal-/i` also matches `http.request.header.x-internal-id`. String arrays under a matching key have each element replaced.

For free-text fields outside the span pipeline (logs, error messages, frontend payloads), use `createStringRedactor('default')` from `autotel`. It applies the preset's value patterns and returns a `(s: string) => string`.
