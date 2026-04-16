# autotel-mcp (MCP Server)

MCP server for AI agents to investigate OpenTelemetry traces, metrics, and logs.

## Your Role

You are working on the MCP investigation server. This is NOT the instrumentation package (that's autotel-mcp-instrumentation). This package is an MCP server that AI agents connect to for querying and investigating telemetry data.

## Tech Stack

- **MCP SDK**: @modelcontextprotocol/sdk ^1.29.0
- **Storage**: @libsql/client (in-memory or persistent)
- **OTLP**: @opentelemetry/otlp-transformer for ingestion
- **Validation**: zod
- **Build**: tsup
- **Testing**: vitest

## Architecture

- `src/backends/` — TelemetryBackend interface + implementations (collector, jaeger, fixture)
- `src/tools/` — MCP tool registrations, split by investigation domain
- `src/modules/` — Pure logic (no MCP dependency), testable in isolation
- `src/resources/` — MCP resource registrations

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
