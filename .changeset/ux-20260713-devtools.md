---
'autotel-devtools': minor
'autotel-agents': minor
---

**Devtools UX upgrades:**

- **Faceted service filter** on the Traces view — a "Filter" popover with per-service live counts and multi-select, plus click-to-filter service pills on each row.
- **Context-window gauge** in the GenAI model header — a radial gauge showing prompt tokens vs the model's context window (green → amber → red as it fills), backed by a new per-model context-window lookup table.
- **Live activity indicator** — the connection dot pulses when telemetry arrives and shows a rolling ingest rate (items/sec).
- **Human-readable names** — camelCase/snake_case tool names get a readable Title Case tooltip.

**Coding-agent observability** — model Claude Code's runtime environment:

- `autotel-agents` now models `mcp_server_connection`, `plugin_loaded` and `hook_execution_complete` events (previously dropped to `other`): MCP server connect/disconnect lifecycle, loaded plugins, and hook-execution tallies, exposed on the session rollup and aggregate.
- The Agents tab gains a **Runtime environment** section (MCP servers with connection status, plugins, hooks).
- **Golden contract test + drift guard**: a sanitized, recorded Claude Code OTLP export is run through the real decode → reduce pipeline, and a test fails if Claude Code emits an event the adapter neither handles nor knowingly ignores. Re-record with `scripts/record-claude-otel.mjs`.
