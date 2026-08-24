# autotel-agents

Browser-safe domain layer for **observing coding agents**, Claude Code, opencode, and (soon) Codex, from the OpenTelemetry **metrics and log events** they emit.

It turns a stream of decoded OTLP records into a session-centric model you can render: who did what, which tools and MCP servers were used, how many tokens/dollars, accept vs reject.

> This package does **no I/O**. The [`autotel-devtools`](../autotel-devtools) server decodes OTLP (JSON/protobuf), feeds plain objects in, and the devtools widget renders the resulting sessions. Nothing here imports `node:*`, `protobufjs`, or `ws`, enforced by an ESLint browser-safety guard, so the same code runs in the browser and on the server.

## Why this exists

Coding agents don't emit traces. They emit **metrics** (`*.token.usage`, `*.cost.usage`, `*.lines_of_code.count`, …) and **log events** (`api_request`, `tool_result`, `tool_decision`, `user_prompt`, `api_error`). opencode deliberately mirrors Claude Code's contract under an `opencode.` prefix, so one adapter shape covers many agents.

## Model

```
OtelMetricRecord  ─┐
                   ├─ adapter registry (by scope + name prefix) ─→ AgentSession
AgentRawEvent     ─┘                                              ├─ rollup (kept forever)
                                                                  └─ timeline (ring-buffered)
```

- **Events are authoritative** for the timeline and for cost/token totals (per-request, cache-accurate).
- **Metrics fill metric-only gaps** (lines of code, commits, PRs, active time) by `session.id`.
- `token.usage` / `cost.usage` **metrics are recognized but never summed**: they overlap `api_request` events, so summing both would double-count.

## Usage (server side)

```ts
import {
  ingestEventRecord,
  ingestMetricRecord,
  summarizeSessions,
} from 'autotel-agents';
import type { AgentSessionStore } from 'autotel-agents';

const store: AgentSessionStore = new Map();

// after decoding an OTLP log record / metric:
ingestEventRecord(store, decodedLogRecord); // { eventName, timestamp, attributes, resource, scope }
ingestMetricRecord(store, decodedMetric); // { name, dataPoints, resource, scope }

const sessions = [...store.values()]; // broadcast to the widget
const aggregate = summarizeSessions(sessions); // cost, models, MCP servers across sessions
```

## MCP visibility

Claude Code names MCP tools `mcp__<server>__<tool>`, and those names flow through `tool_result` / `tool_decision`. `parseToolName` splits them so you can break usage down by MCP server:

```ts
parseToolName('mcp__github__create_issue');
// → { name, isMcp: true, mcpServer: 'github', mcpTool: 'create_issue' }
```

## Context compaction

When a session outgrows its context window the agent replaces the conversation with a summary and carries on. Nothing announces it — Claude Code emits no compaction event, and the timeline either side of the boundary looks the same. But everything before that point has left the agent's head, so a later answer leaning on it is reconstruction, not recall.

The boundary shows up in token counts the agent already reports. A prompt is `input + cache_read + cache_creation` tokens and grows monotonically while a conversation accumulates; compaction is the discontinuity, where the cached prefix is abandoned and a summary is written in its place.

```ts
session.rollup.compactions;
// → [{ atEventId, timestamp, contextBefore: 120_000, contextAfter: 15_002,
//      droppedTokens: 104_998, confidence: 'likely' }]
session.rollup.contextHighWaterTokens; // largest prompt since the last reset
```

A drop alone is not enough. A `Task` sub-agent runs on its own fresh context, so its requests are small and interleaved among the parent's large ones, and pairwise comparison calls every one of them a compaction. What separates them is whether the context comes back, and how: an excursion returns to the parent's full size in one step from a context still the size of the summary, while regrowth after a real compaction climbs gradually. Only the first withdraws a recorded reset.

This is inference, never observation — hence `confidence`, and hence no claim about what the summary contained. Thresholds are tuned against synthetic timelines and stay provisional until validated against a recorded session that actually compacted.

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
