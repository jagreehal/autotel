# autotel-agents

Browser-safe domain layer for **observing coding agents** — Claude Code, opencode, and (soon) Codex — from the OpenTelemetry **metrics and log events** they emit.

It turns a stream of decoded OTLP records into a session-centric model you can render: who did what, which tools and MCP servers were used, how many tokens/dollars, accept vs reject.

> This package does **no I/O**. The [`autotel-devtools`](../autotel-devtools) server decodes OTLP (JSON/protobuf), feeds plain objects in, and the devtools widget renders the resulting sessions. Nothing here imports `node:*`, `protobufjs`, or `ws` — enforced by an ESLint browser-safety guard — so the same code runs in the browser and on the server.

## Why this exists

Coding agents don't emit traces — they emit **metrics** (`*.token.usage`, `*.cost.usage`, `*.lines_of_code.count`, …) and **log events** (`api_request`, `tool_result`, `tool_decision`, `user_prompt`, `api_error`). opencode deliberately mirrors Claude Code's contract under an `opencode.` prefix, so one adapter shape covers many agents.

## Model

```
OtelMetricRecord  ─┐
                   ├─ adapter registry (by scope + name prefix) ─→ AgentSession
AgentRawEvent     ─┘                                              ├─ rollup (kept forever)
                                                                  └─ timeline (ring-buffered)
```

- **Events are authoritative** for the timeline and for cost/token totals (per-request, cache-accurate).
- **Metrics fill metric-only gaps** (lines of code, commits, PRs, active time) by `session.id`.
- `token.usage` / `cost.usage` **metrics are recognized but never summed** — they overlap `api_request` events, so summing both would double-count.

## Usage (server side)

```ts
import { ingestEventRecord, ingestMetricRecord, summarizeSessions } from 'autotel-agents';
import type { AgentSessionStore } from 'autotel-agents';

const store: AgentSessionStore = new Map();

// after decoding an OTLP log record / metric:
ingestEventRecord(store, decodedLogRecord);   // { eventName, timestamp, attributes, resource, scope }
ingestMetricRecord(store, decodedMetric);     // { name, dataPoints, resource, scope }

const sessions = [...store.values()];          // broadcast to the widget
const aggregate = summarizeSessions(sessions); // cost, models, MCP servers across sessions
```

## MCP visibility

Claude Code names MCP tools `mcp__<server>__<tool>`, and those names flow through `tool_result` / `tool_decision`. `parseToolName` splits them so you can break usage down by MCP server:

```ts
parseToolName('mcp__github__create_issue');
// → { name, isMcp: true, mcpServer: 'github', mcpTool: 'create_issue' }
```

## Adding an agent

```ts
import { createPrefixAdapter } from 'autotel-agents';

export const codexAdapter = createPrefixAdapter({
  kind: 'codex',
  prefix: 'codex.',
  scopeHint: 'codex',
});
```

Register it in `src/adapters/registry.ts`. No reducer or UI changes.

## License

Apache-2.0
