---
'autotel-mcp': minor
'autotel-cli': minor
---

Query hosted observability vendors from `autotel investigate`.

Until now the investigate backends were all self-hosted or local (Jaeger, Tempo,
Prometheus, Loki, the built-in collector). Three hosted vendors now work too, as
trace-only backends:

- `--backend logfire` — Pydantic Logfire, over the `/v2/query` SQL API
- `--backend datadog` — Datadog APM, over the v2 spans search API
- `--backend signoz` — SigNoz, over its trace endpoints

Each declares `metrics` and `logs` as `unsupported` rather than returning empty
results, so a caller can tell "this backend cannot answer that" from "there is
nothing there".

Credentials come from the environment only — never flags — because argv is
readable from the process table:

| Backend   | Base URL                                  | Credentials                             |
| --------- | ----------------------------------------- | --------------------------------------- |
| `logfire` | `LOGFIRE_BASE_URL` / `--logfire-base-url` | `LOGFIRE_READ_TOKEN`                    |
| `datadog` | `DD_SITE` / `--datadog-site`              | `DD_API_KEY` + `DD_APP_KEY`             |
| `signoz`  | `SIGNOZ_BASE_URL` / `--signoz-base-url`   | `SIGNOZ_API_KEY` (optional self-hosted) |

`DD_SITE` accepts a bare Datadog site (`uk1.datadoghq.com`) as well as a full API
URL, since a bare site is what Datadog's own `DD_SITE` holds.

Two details that are easy to get wrong, both now handled:

- **Logfire's read and write paths are asymmetric.** Ingest accepts the
  token-routed host `logfire-api.pydantic.dev` and infers the region from the
  token; the query API does not, and needs the region host (`logfire-us` /
  `logfire-eu`) explicitly. A wrong region and a wrong token scope both return an
  indistinguishable bare 401, so the error now names both causes and the fix.
- **Datadog reads need two credentials.** An org API key alone gets a 403; a
  personal application key is also required. Missing credentials are reported
  before the request is built, so the error names the variable rather than
  failing on URL construction.

`jsonGet`/`jsonPost` now retry HTTP 429 honouring `Retry-After`. Hosted vendor
read APIs rate-limit aggressively and an investigation naturally fires bursts;
nothing else is retried, so a 500 or 404 still reaches the caller unchanged.
