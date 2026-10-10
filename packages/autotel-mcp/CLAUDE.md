# autotel-mcp (MCP Server)

MCP server for AI agents to investigate OpenTelemetry traces, metrics, and logs.

## Your Role

You are working on the MCP investigation server. This is NOT the instrumentation package (that's autotel-mcp-instrumentation). This package is an MCP server that AI agents connect to for querying and investigating telemetry data.

## Tech Stack

- **MCP SDK**: `@modelcontextprotocol/server` + `@modelcontextprotocol/node` ^2.0.0 (protocol `2026-07-28`). Not the v1 `@modelcontextprotocol/sdk`, which tops out at `2025-11-25`.
- **Both eras served, one factory**: `createMcpHandler` / `serveStdio` default to `legacy: 'stateless'`, so 2025-era clients (the v1 SDK that Claude Code, Claude Desktop and Cursor still ship) are answered from the same `app.createServer` definitions. `test/legacy-client.test.ts` drives a real v1 client against the real entry point — the claim is worthless without it. Do not switch to `legacy: 'reject'` without deleting that suite deliberately.
- **Storage**: @libsql/client (in-memory or persistent)
- **OTLP**: @opentelemetry/otlp-transformer for ingestion
- **Validation**: zod
- **Build**: tsdown
- **Testing**: vitest

## Architecture

- `src/backends/`: TelemetryBackend interface + implementations. Self-hosted/OSS: collector, jaeger, tempo, prometheus, loki, devtools, fixture, plus `composite` (per-signal fan-out) and `autodetect`.
- **devtools backend pushes queries down.** autotel-devtools keeps telemetry in a sqlite store with a query language, so `searchTraces` compiles the structured query into query text (`query-pushdown.ts`) and `POST /api/query/traces` runs it as SQL over the whole retained history — not as a JS filter over the hundred-trace live tail. Metrics come from `/api/metrics` + `/api/query/metrics`, so devtools now declares `metrics: 'available'`. The compiler's output is checked against the real grammar, imported from `autotel-devtools/query`, so the two cannot drift into a 400 for a query nobody typed.
- **The devtools query path verifies the response shape, not just the status.** It returns results as _already filtered_, so a bare 200 from anything on that URL would present unfiltered traces as query matches. The query response always carries `nextCursor`; the older read-back shape carries `count`. A response without `nextCursor` means "fall back", and the probe result is cached so a legacy server costs one failed request per process.
- `cloudflare`: traces and Workers logs over Cloudflare's SQL API. Cloudflare samples by window width, so the backend hydrates each trace in a narrow window around its start. The header of `backends/cloudflare/index.ts` lists the API behaviour checked against the live service.
- `datadog`: traces (spans search), logs (logs search), metrics (`/api/v1/query`), and `aggregateSpans` pushdown (spans analytics API). The spans API can be limited to 5 requests/min and every spans endpoint shares that bucket, so `searchTraces` stays at two requests (find ids, then one `trace_id:(a OR b)` hydration), `searchSpans` at one. Never hydrate per trace.
- Grafana Cloud is the `stack` backend with auth: `grafanaAuth()` in `factory.ts` builds basic auth from `GRAFANA_CLOUD_TOKEN` and the per-signal `*_USERNAME`. Tempo/Loki/Prometheus take a `headers` argument; keep every request passing it.
- `tools/index.ts` `scoped()` wraps the server per toolset: it skips tools outside `AUTOTEL_TOOLSETS`/`AUTOTEL_OMIT_TOOLS` and makes every `z.object` input schema `.strict()`. New tool files register through it; do not call `registerTool` on the raw server.
- Analytics (`tools/analytics.ts`) samples across the window in 4 slices (`sampleAcrossWindow`), not one newest-N search, unless the backend implements `aggregateSpans`. 4 is the Datadog rate-limit budget; do not raise it.
- `traceUrl?()` on a backend becomes `url` on traces in tool results. Add it to any backend with a UI.
- Hosted vendors, traces only: logfire, signoz — these declare `metrics`/`logs` as `unsupported` rather than returning empty results, so a caller can tell "this backend can't answer that" from "there is nothing there".
- `src/tools/`: MCP tool registrations, split by investigation domain
- `src/modules/`: Pure logic (no MCP dependency), testable in isolation
- `src/resources/`: MCP resource registrations
- `src/apps/`: MCP Apps views. `trace-view.ts` serves the autotel-devtools waterfall as `ui://autotel/trace-view.html` and links it from `get_trace`. The build copies the script into `dist/` (`copy` in `tsdown.config.ts`), because autotel-devtools is a dev dependency and is not installed beside a published autotel-mcp
- `span.kind` is a tag on every backend that knows it (`spanKindTag` in `span-mapping.ts`): the waterfall colours bars by kind

## Commands

```bash
pnpm test                  # Unit tests
pnpm build                 # Build package
pnpm dev                   # Watch mode (stdio)
pnpm dev:http              # Watch mode (HTTP)
```

## Boundaries

- Tools are in `src/tools/`, logic is in `src/modules/`. Tools call modules, never the reverse.
- Backends implement TelemetryBackend interface. Never access backend internals from tools.
- The collector backend runs an OTLP receiver on a separate port from the MCP HTTP server.
- `app.createServer` is a per-request factory, not a shared instance: 2026-07-28 has no handshake and no session, so a server instance must hold nothing between requests. Anything expensive (the backend, the signal probe) is built once in `createApp`/`start` and closed over.
- Tools are read-only queries. Register them with `annotations: READ_ONLY` from `tools/shared.ts`.
