---
name: autotel-agents
description: >
  Use this skill when turning the OpenTelemetry metrics and log events from a coding agent (Claude Code, opencode, Codex) into a session model — ingesting decoded OTLP records, summarizing token/cost/tool usage, breaking MCP tool calls down by server, or adding a new agent adapter. Browser-safe, no I/O.
---

# autotel-agents

A browser-safe domain layer that turns the OTel **metrics and log events** a coding agent emits into an `AgentSession` model: who did what, which tools and MCP servers ran, tokens and dollars, accept vs reject. Coding agents emit no traces, so nothing here reads spans.

This package does **no I/O** — no `node:*`, no `protobufjs`, no `ws`. The `autotel-devtools` server decodes OTLP and feeds plain objects in; the same code runs in the browser and on the server. Use it to build a UI over agent telemetry, not to collect that telemetry.

## When to use

- Build or feed the devtools Agents tab from decoded OTLP records.
- Summarize cost, models, and MCP servers across many agent sessions.
- Split `mcp__server__tool` names to attribute usage per MCP server.
- Add support for a new agent that mirrors the Claude Code contract.

## Core patterns

### Ingest records into a session store

Events are authoritative for the timeline and for cost/token totals. Metrics fill metric-only gaps (lines of code, commits, PRs, active time) by `session.id`.

```ts
import {
  ingestEventRecord,
  ingestMetricRecord,
  summarizeSessions,
  type AgentSessionStore,
} from 'autotel-agents';

const store: AgentSessionStore = new Map();

ingestEventRecord(store, decodedLogRecord); // { eventName, timestamp, attributes, resource, scope }
ingestMetricRecord(store, decodedMetric); // { name, dataPoints, resource, scope }

const sessions = [...store.values()];
const aggregate = summarizeSessions(sessions); // cost, models, MCP servers across sessions
```

### Break usage down by MCP server

```ts
import { parseToolName } from 'autotel-agents';

parseToolName('mcp__github__create_issue');
// → { name, isMcp: true, mcpServer: 'github', mcpTool: 'create_issue' }
```

### Add an agent adapter

```ts
import { createPrefixAdapter } from 'autotel-agents';

export const codexAdapter = createPrefixAdapter({
  kind: 'codex',
  prefix: 'codex.',
  scopeHint: 'codex',
});
```

Register it in `src/adapters/registry.ts`. No reducer or UI changes follow.

## Common mistakes

### HIGH: Summing `token.usage` / `cost.usage` metrics

These metrics overlap the `api_request` events, which already carry per-request, cache-accurate totals. The registry recognizes them but never sums them; summing both double-counts. Take totals from events.

### MEDIUM: Importing `node:*` or OTLP decoders into this layer

The browser-safety ESLint guard fails the build. Decode OTLP in the devtools server and pass plain `{ eventName, attributes, resource, scope }` objects in.

## Version

Browser-safe domain layer consumed by `autotel-devtools`. No runtime dependencies on the OpenTelemetry SDK.
