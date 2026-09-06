---
name: autotel-agents
description: >
  Use this skill when turning the OpenTelemetry metrics and log events from a coding agent (Claude Code, opencode, Codex) into a session model — ingesting decoded OTLP records, attributing cost to the model, effort, skill, sub-agent or prompt behind it, breaking MCP tool calls down by server, or adding a new agent adapter. Browser-safe, no I/O.
---

# autotel-agents

A browser-safe domain layer that turns the OTel **metrics and log events** a coding agent emits into an `AgentSession` model: who did what, which tools and MCP servers ran, tokens and dollars, accept vs reject, and which model, effort, skill, sub-agent or prompt each dollar went to.

Claude Code also emits **spans** under `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` — `claude_code.interaction` → `llm_request` / `tool`, with a sub-agent tree on `parent_agent_id`. `autotel-devtools` requests those and renders them in its Traces tab. The session model here is built from the metrics and events, which carry the same cost and tokens: reading both would count every call twice.

This package does **no I/O** — no `node:*`, no `protobufjs`, no `ws`. The `autotel-devtools` server decodes OTLP and feeds plain objects in; the same code runs in the browser and on the server. Use it to build a UI over agent telemetry, not to collect that telemetry.

## When to use

- Build or feed the devtools Agents tab from decoded OTLP records.
- Summarize cost, models, and MCP servers across many agent sessions.
- Attribute spend to the skill, sub-agent, effort level or prompt that drove it.
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

### Read where the money went

Five breakdowns, all the same `UsageBreakdown` shape (`requests`, `costUsd`, and the four token counts), so one reader covers every dimension:

```ts
const { rollup } = sessions[0];

rollup.byModel['claude-opus-5']; // { requests: 12, costUsd: 3.10, … }
rollup.byEffort['high'];
rollup.bySkill['tdd']; // from `skill.name` on the requests it drove
rollup.byAgent['Explore']; // from `agent.name` — the delegate that spent it
rollup.byPrompt['0b4e…']; // one user prompt, start to finish
```

`byPrompt` keys on `prompt.id`, which every event from one user prompt shares. The breakdowns live in the rollup, not in `timeline` — that is ring-buffered, and a prompt's spend has to outlive the events that made it up.

A request naming no skill is filed under none, never under `"unknown"`.

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

### HIGH: Keying a new bucket on a plain object

Breakdown keys are wire values — a model id, a tool name, a skill. `__proto__`, `constructor` and `toString` are all legal strings, and on a plain `{}` they name properties every object already has. Build any telemetry-keyed record with a null prototype (`Object.create(null)`, or the `wireKeyed()` helper in `reduce.ts`) so such a key is an ordinary key.

### MEDIUM: Importing `node:*` or OTLP decoders into this layer

The browser-safety ESLint guard fails the build. Decode OTLP in the devtools server and pass plain `{ eventName, attributes, resource, scope }` objects in.

## Version

Browser-safe domain layer consumed by `autotel-devtools`. No runtime dependencies on the OpenTelemetry SDK.
