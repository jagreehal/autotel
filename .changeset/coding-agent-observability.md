---
'autotel-agents': minor
'autotel-devtools': minor
---

Add first-class coding-agent observability, starting with Claude Code.

- **New package `autotel-agents`** — a browser-safe domain layer that turns the OpenTelemetry metrics + log events coding agents emit into a session-centric model. Includes an adapter registry (Claude Code + opencode, by instrumentation scope / name prefix), pure session reducers (rollups kept indefinitely, raw timeline ring-buffered), MCP-aware tool parsing (`mcp__server__tool`), and a tool taxonomy that surfaces sub-agents (`Task`), skills (`Skill`), and tool categories. Cost is taken from the agent's reported `cost_usd` and estimated from tokens only as a fallback.
- **`autotel-devtools`**:
  - New **Agents** tab — sessions list → per-session timeline + rollup, an aggregate strip across sessions, and breakdowns by tool category, MCP server, sub-agent, and skill. Prompts are private by default with a reveal/redact toggle.
  - The OTLP receiver now **parses metric data points** (Sum/Gauge/Histogram, JSON + protobuf) and **agent log events**, reconstructs sessions server-side, and streams them to the widget.
  - New **`npx autotel-devtools claude`** launcher subcommand that starts the receiver and launches Claude Code already wired to it (HTTP/protobuf, 1s export intervals, session id on metrics). `--print-env` emits the env block for MDM / VS Code; `--log-prompts` opts into prompt-text capture.
