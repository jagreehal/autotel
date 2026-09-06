---
'autotel-agents': minor
'autotel-devtools': minor
'autotel-mcp': minor
---

Split Claude Code spend by what drove it, and record the span hierarchy.

A session reported one bill. It now splits five ways, from attributes Claude
Code sends on `api_request` and its cost/token metrics:

```ts
rollup.byModel['claude-opus-5']; // { requests, costUsd, inputTokens, … }
rollup.byEffort['high'];
rollup.bySkill['tdd'];
rollup.byAgent['Explore'];
rollup.byPrompt['0b4e…']; // one user prompt, start to finish
```

Every breakdown is the same `UsageBreakdown` shape, so one reader covers all
five, and the Agents tab shows the split by effort, skill, sub-agent and model.
`effort`, `speed`, and the skill and sub-agent behind a call show on its
timeline row. A request naming no skill is filed under none.

`agent.name` and `skill.name` are read where the spend is — on the requests a
sub-agent or skill makes — so the delegate that spent the tokens is the one
they land on. `byPrompt` keys on `prompt.id`, shared by every event from one
user prompt. Each total lives in the rollup, so it outlives the ring-buffered
timeline and stays exact across a long session.

Keys like these arrive over the wire, so every telemetry-keyed record has a
null prototype: `__proto__` and `constructor` are ordinary keys, held in their
own slice like any other.

`api_refusal` is modelled with its own `rollup.apiRefusals` — a completed call
that returned no answer, kept apart from `apiErrors`. `permission_mode_changed`
and `auth` are recorded as known-and-unmodelled, so the drift guard keeps
flagging genuinely new events.

`autotel-devtools claude` now sets `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` and
`OTEL_TRACES_EXPORTER=otlp`, so Claude Code emits `claude_code.interaction` →
`llm_request` / `tool` with the sub-agent tree on `parent_agent_id`, and the
Traces tab renders it. The Agents session model reads metrics and events alone,
which carry the same cost, so each call counts once.

`autotel-mcp` gains `--allowed-hosts` and `--allowed-origins` (also
`AUTOTEL_ALLOWED_HOSTS` / `AUTOTEL_ALLOWED_ORIGINS`), for naming the hostnames a
hosted server answers for. The localhost default stands until one is set, and
naming hosts replaces it rather than adding to it — name `localhost` too if a
local client still needs in, which the startup banner now spells out alongside
the hostnames that do answer.

Both take hostnames — `app.example.com`, not `https://app.example.com` — because
each guard compares the hostname it parses from the header. Entries are
lowercased to match, since that header hostname already is. An entry carrying a
scheme, port or path is named at startup with what to remove. A bracketed IPv6
literal such as `[::1]` is a hostname and is accepted. Neither flag adds
authentication.

A settings mistake now reads as a sentence naming the setting:

```
invalid configuration:
  allowedOrigins: "https://app.example.com" is not a hostname — remove the scheme.
```

Every `autotel-mcp` config error prints this way, message only. The stack that
used to come with it pointed at the parser rather than at the line to change.
