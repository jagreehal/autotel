---
'autotel-agents': minor
'autotel-devtools': minor
'autotel-mcp': minor
'autotel-mcp-instrumentation': minor
---

Coding-agent spend you can trust, Codex support, live semantic-convention checks, and session correlation for stateless MCP servers.

- **`autotel-agents`**: a Codex adapter (SSE and WebSocket transports). Every total says whether its cost and tokens are `complete`, `partial` or `unknown`, through `unpricedRequests`, `untokenedRequests` and `accountingStatus()`. `usageReport()` answers what a session, prompt, repository or agent spent, and an `autotel.agent.repository` event ties each session to its repository.
- **`autotel-devtools`**: `agents enable | disable | status` routes Claude Code and Codex here for every new session and installs a SessionStart hook that tags sessions with their repository. The Agents tab filters by repository and shows `$?` or `$1.20+?` where spend is unknown or partial. New routes: `GET /api/agents/usage`, `GET /api/validation` and `POST /api/validation/run` (semantic-convention checks through `weaver`, when installed). `GET /api/coverage` reports when `autotel.map.json` is older than the source.
- **`autotel-mcp`**: `agent_usage` and `semconv_validate` tools.
- **`autotel-mcp-instrumentation`**: opt-in task handles for MCP 2026-07-28 servers. `sessionHandles` issues a `session_id` the agent echoes back (`gen_ai.conversation.id`, plus `gen_ai.agent.id` with `agentId: true`), `captureIntent` records why each tool was called, `reportMissingTools` adds a `get_more_tools` tool, and `identify` sets `user.id`. Handlers receive only their own arguments.
