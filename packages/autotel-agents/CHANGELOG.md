# autotel-agents

## 0.3.0

### Minor Changes

- 3d9e31c: **Devtools UX upgrades:**

  - **Faceted service filter** on the Traces view — a "Filter" popover with per-service live counts and multi-select, plus click-to-filter service pills on each row.
  - **Context-window gauge** in the GenAI model header — a radial gauge showing prompt tokens vs the model's context window (green → amber → red as it fills), backed by a new per-model context-window lookup table.
  - **Live activity indicator** — the connection dot pulses when telemetry arrives and shows a rolling ingest rate (items/sec).
  - **Human-readable names** — camelCase/snake_case tool names get a readable Title Case tooltip.

  **Coding-agent observability** — model Claude Code's runtime environment:

  - `autotel-agents` now models `mcp_server_connection`, `plugin_loaded` and `hook_execution_complete` events (previously dropped to `other`): MCP server connect/disconnect lifecycle, loaded plugins, and hook-execution tallies, exposed on the session rollup and aggregate.
  - The Agents tab gains a **Runtime environment** section (MCP servers with connection status, plugins, hooks).
  - **Golden contract test + drift guard**: a sanitized, recorded Claude Code OTLP export is run through the real decode → reduce pipeline, and a test fails if Claude Code emits an event the adapter neither handles nor knowingly ignores. Re-record with `scripts/record-claude-otel.mjs`.

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.

## 0.2.0

### Minor Changes

- 7c12332: Add first-class coding-agent observability, starting with Claude Code.
  - **New package `autotel-agents`** — a browser-safe domain layer that turns the OpenTelemetry metrics + log events coding agents emit into a session-centric model. Includes an adapter registry (Claude Code + opencode, by instrumentation scope / name prefix), pure session reducers (rollups kept indefinitely, raw timeline ring-buffered), MCP-aware tool parsing (`mcp__server__tool`), and a tool taxonomy that surfaces sub-agents (`Task`), skills (`Skill`), and tool categories. Cost is taken from the agent's reported `cost_usd` and estimated from tokens only as a fallback.
  - **`autotel-devtools`**:
    - New **Agents** tab — sessions list → per-session timeline + rollup, an aggregate strip across sessions, and breakdowns by tool category, MCP server, sub-agent, and skill. Prompts are private by default with a reveal/redact toggle.
    - The OTLP receiver now **parses metric data points** (Sum/Gauge/Histogram, JSON + protobuf) and **agent log events**, reconstructs sessions server-side, and streams them to the widget.
    - New **`npx autotel-devtools claude`** launcher subcommand that starts the receiver and launches Claude Code already wired to it (HTTP/protobuf, 1s export intervals, session id on metrics). `--print-env` emits the env block for MDM / VS Code; `--log-prompts` opts into prompt-text capture.
