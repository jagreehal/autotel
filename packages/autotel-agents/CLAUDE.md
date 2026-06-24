# autotel-agents

Browser-safe domain layer for **observing coding agents** (Claude Code, opencode, Codex) from the OpenTelemetry **metrics + log events** they emit. No I/O, no `node:*` — the `autotel-devtools` server decodes OTLP and feeds plain objects in; the widget renders the result.

## Quick Commands

```bash
pnpm build        # tsdown → ESM + CJS
pnpm test         # vitest
pnpm lint         # eslint (browser-safety guard via no-restricted-imports)
pnpm type-check   # tsc --noEmit
```

## Architecture

```
OtelMetricRecord ─┐  adapter registry (scope + name prefix)   ┌─ rollup (kept forever)
                  ├─────────────────────────────────────────► AgentSession
AgentRawEvent    ─┘  → normalize → reduce                      └─ timeline (ring-buffered)
```

- **`types.ts`** — decoded-OTLP input types + normalized `AgentSession`/`AgentEvent` model.
- **`adapters/`** — `createPrefixAdapter({ kind, prefix, scopeHint })` factory; `claude-code` + `opencode` adapters; `registry.ts` (ordered, first match wins). Add Codex = one adapter, registered here.
- **`reduce.ts`** — pure stateful reducers over a caller-owned `Map`: `ingestEventRecord` / `ingestMetricRecord` (+ batch `ingestAgent*`), `summarizeSessions`.
- **`mcp.ts`** — `parseToolName` splits `mcp__<server>__<tool>`.
- **`tool-taxonomy.ts`** — `classifyTool` (file/shell/search/web/todo/subagent/skill/mcp); `Task`→sub-agent, `Skill`→skill.
- **`cost.ts`** — fallback token→USD estimate (reported `cost_usd` always wins).

## Invariants

- **Pure / browser-safe.** No `node:*`, no protobuf, no `ws`, no fs (lint-enforced). Runs in the browser widget AND the node server.
- **Events are authoritative** for the timeline and cost/token totals (`api_request`). The `token.usage`/`cost.usage` **metrics overlap and are NOT summed** into rollups — only metric-only signals (lines_of_code, commit, pull_request, active_time, code_edit_tool.decision) fold in by `session.id`. Don't change this without re-checking double-counting.
- **Cumulative vs delta temporality.** `delta` counter points are summed; `cumulative` points are differenced per series via `session.metricState` (re-exporting a cumulative total must not inflate). Absent temporality ⇒ treated as `delta` (Claude Code's default). Claude Code defaults to delta; opencode/standard SDKs default to cumulative.
- **Positive-signal detection only.** An adapter claims a record by name prefix, instrumentation scope, OR resource `service.name` — never by a bare `event.name` like `api_request`, which any app could emit.
- **No enums** (union types / `as const`); functions over classes.
- Adding an agent must not require touching the reducers or the devtools UI.

## Boundaries

- ✅ **Always**: keep it pure; add agents via adapters; cover new behavior with `agents.test.ts`.
- ⚠️ **Ask first**: new dependencies, changing the source-of-truth (events vs metrics) rule.
- 🚫 **Never**: import server-only modules; sum overlapping metric + event facts; persist/do I/O here (that's the devtools server).
