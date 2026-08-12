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

- `src/backends/`: TelemetryBackend interface + implementations. Self-hosted/OSS: collector, jaeger, tempo, prometheus, loki, devtools, fixture, plus `composite` (per-signal fan-out) and `autodetect`. Hosted vendors, traces only: logfire, datadog, signoz — these declare `metrics`/`logs` as `unsupported` rather than returning empty results, so a caller can tell "this backend can't answer that" from "there is nothing there".
- `src/tools/`: MCP tool registrations, split by investigation domain
- `src/modules/`: Pure logic (no MCP dependency), testable in isolation
- `src/resources/`: MCP resource registrations

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
