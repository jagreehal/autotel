---
'autotel-cli': minor
'autotel-backends': minor
---

Measure ingest-to-queryable lag, and send to Logfire and Langfuse.

**`autotel health --otlp-endpoint <url>`** writes one probe span and polls the
read backend until it comes back, reporting `freshness.timeToQueryableSeconds`.

This is the number that decides whether a write-then-read loop works at all.
Hosted backends differ by two orders of magnitude in ingest lag, and on a slow
one an agent that writes and immediately reads sees nothing and concludes the
operation produced no telemetry. Reachability alone doesn't distinguish those.

- The probe span is serialized by `@opentelemetry/otlp-transformer`, so the
  payload is whatever the spec says rather than hand-built JSON.
- It sends OTLP **protobuf** by default — the encoding every OTLP/HTTP receiver
  must accept, and the only one some vendors take. The built-in collector parses
  JSON and is switched automatically; `--otlp-encoding json|protobuf` overrides.
  A rejected payload reports which encoding was sent and which to try.
- Auth for hosted endpoints comes from the standard
  `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization=<token>`), so no token reaches
  argv. Note this is the **write** credential, which for most vendors is a
  different token from the read one the query backend uses.
- `--freshness-timeout-ms` bounds the wait (default 120000).

**New backend presets** in `autotel-backends`:

```typescript
import { createLogfireConfig } from 'autotel-backends/logfire';
import { createLangfuseConfig } from 'autotel-backends/langfuse';
```

Both force OTLP/HTTP, since neither vendor accepts gRPC and most OTel SDKs
default to it. `createLogfireConfig` defaults to Logfire's token-routed ingest
host so a token from one data region can't fail against another region's
endpoint, and sends the write token bare — its query API wants
`Bearer <read-token>` instead, a different credential in a different format.
`createLangfuseConfig` builds basic auth from the public/secret key pair and
opts into v4 ingestion, which keeps traces queryable promptly.
