---
'autotel': minor
'autotel-agents': minor
'autotel-audit': minor
'autotel-aws': minor
'autotel-cli': minor
'autotel-cloudflare': minor
'autotel-devtools': minor
'autotel-drizzle': minor
'autotel-edge': minor
'autotel-genai': minor
'autotel-langfuse': minor
'autotel-mcp': minor
'autotel-mcp-instrumentation': minor
'autotel-mongoose': minor
'autotel-plugins': minor
'autotel-posthog': minor
'autotel-tanstack': minor
'autotel-terminal': minor
'autotel-web': minor
---

Track the current OpenTelemetry releases: SDK 2.11.0, experimental 0.222.0,
auto-instrumentations 0.80.0.

Spans now carry the current names for the attributes OpenTelemetry has renamed,
so they line up with every other OTel producer:

| before                | now                         |
| --------------------- | --------------------------- |
| `http.method`         | `http.request.method`       |
| `http.status_code`    | `http.response.status_code` |
| `http.url`            | `url.full`                  |
| `http.scheme`         | `url.scheme`                |
| `http.host`           | `server.address`            |
| `http.target`         | `url.path` (+ `url.query`)  |
| `db.system`           | `db.system.name`            |
| `db.operation`        | `db.operation.name`         |
| `db.name`             | `db.namespace`              |
| `db.statement`        | `db.query.text`             |
| `db.sql.table`        | `db.collection.name`        |
| `rpc.system`          | `rpc.system.name`           |
| `messaging.operation` | `messaging.operation.type`  |

This covers `autotel`, `autotel-aws`, `autotel-cloudflare`, `autotel-tanstack`
and `autotel-web`. Queries, dashboards and alerts pinned to the previous
spellings should move to the new ones. `deployment.environment` now ships
alongside `deployment.environment.name` everywhere, matching what `init()`
already did.

Everything that reads spans — `autotel-devtools`, `autotel-terminal`,
`autotel-mcp`, `autotel-agents`, `autotel-audit`, `autotel-vscode`,
`autotel-cli` — accepts both spellings, so existing traces keep rendering,
filtering and aggregating as they did.

`rpc.service` is unchanged. `autotel-drizzle` and `autotel-plugins` keep their
`'legacy'` semconv mode exactly as documented.
