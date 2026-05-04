# OTLP E2E tests

Real-network tests against an OTLP collector. They are the safety net that
catches "the destination quietly changed its API" before your users do.

## What runs

| File          | Mode                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `otlp.e2e.ts` | Smoke (asserts the OTLP HTTP/JSON endpoint accepts spans with a 2xx) |

Every span is tagged with `e2e: true`, `e2e_run_id`, `e2e_branch`, `e2e_sha`,
`e2e_test`, `e2e_correlation_id` so you can grep / clean it from the
destination at any time.

## Run locally

```bash
pnpm --filter autotel run test:e2e
```

Tokens are read from the workspace `.env` (already gitignored). Suites whose
required env vars are missing are skipped with a visible "skipped: missing X"
label, never silently green.

## Required env vars

- `OTLP_E2E_ENDPOINT` — full URL of the OTLP HTTP/JSON traces endpoint
- `OTLP_E2E_HEADERS` — JSON object of headers, e.g. `{"x-honeycomb-team":"…"}`
- `OTLP_E2E_SERVICE` — optional service.name (default: `autotel-e2e`)

Examples for common backends:

| Backend             | Endpoint                                                           | Headers                                         |
| ------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Honeycomb           | `https://api.honeycomb.io/v1/traces`                               | `{"x-honeycomb-team":"<api key>"}`              |
| Grafana Cloud OTLP  | `https://otlp-gateway-<region>.grafana.net/otlp/v1/traces`         | `{"authorization":"Basic <base64 user:token>"}` |
| Datadog OTLP intake | `https://trace.agent.datadoghq.com/v0.4/traces` (with their proxy) | `{"dd-api-key":"<api key>"}`                    |

## Run in CI

`.github/workflows/e2e.yml` runs on:

- daily cron (`0 3 * * *` UTC)
- push to `main` (only when the autotel core / e2e tests / workflow change)
- PR labelled `e2e` (only on same-repo PRs — never forks, for secret safety)
- manual dispatch
