# autotel-claude-code

OpenTelemetry for Claude Code plugins, as a [Claude Mod](https://github.com/anthropics/claude-code/issues/91870).

Function hooks make every plugin a middleware chain: each `$` call is an event, hooks nest by registration order, and a hook may answer for the tool beneath it. Claude Code's own OTel export tells you what the model and the tools did; this mod tells you what the **hooks** did around them — which plugin sat where, how long each link took, and who said no.

## What it records

- **One trace per interaction.** A `claude_code.turn` root opens at `prompt.submit` and closes at `turn.complete`, carrying the turn id, its reason and duration.
- **One span per dispatch worth the bytes** — `tool.call`, `tool.check`, `turn.step` (each model call), every `classic.*` shell hook, `process.run`, `http.fetch`, `fs.read`/`fs.write`, `mcp.call`, `model.*`, `agent.spawn`, `command.run`. Getters, per-draw and per-tick events are left out.
- **The chain beneath, one span event per link:** `plugin.name`, tier, outcome (`returned`, `passed`, `skipped`, `expired`, …), own wall time, and the skip reason. A denied dispatch names the plugin that decided it in `claude_code.decided_by`: the final denial, followed down through the links that passed it along unchanged.
- **The call's duration on its row.** A `ToolUse` render hook appends ` 1.2s` — or ` denied by hook · 3ms` — beside the tool row in the terminal and the desktop app.

Every span is `INTERNAL`, attributed with `claude_code.event`, `plugin.name` (who raised it) and `claude_code.tier`; a `tool.call` adds `tool_name`, `tool_use_id` and `agent_id` in a subagent.

## `$.autotel` for plugin authors

The mod adds one noun in the `engine.create` fold:

```ts
const summary = await $.autotel.span(
  'summarise',
  async (span) => {
    span.setAttribute('gen_ai.request.model', model);
    return $.model.complete(request);
  },
  { 'plugin.feature': 'summary' },
);
```

The span joins the current turn's trace beside the dispatches above. It ends when the body settles; a throw marks it failed with the error's message and rethrows. Types come from this package: add `node_modules/autotel-claude-code/types` to your tsconfig `include`, or `import type { Autotel } from 'autotel-claude-code'`, and `EngineInterface` gains `autotel`.

Where the mod is not seated, `$.autotel` is absent and the call throws — the same contract as Claude Code's built-in `$.telemetry`.

## Install

Function hooks ship behind a flag while Anthropic finishes them:

```bash
npm install autotel-claude-code
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir node_modules/autotel-claude-code
```

Or point a marketplace at the package directory. The mod exports to whatever `OTEL_EXPORTER_OTLP_ENDPOINT` names, over OTLP/HTTP JSON, honouring `OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_SERVICE_NAME` (default `claude-code`, so the spans sit beside Claude Code's own). With no endpoint set it records nothing and `$.autotel.span` only runs its body.

`autotel-devtools claude` sets the endpoint for you:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 npx autotel-devtools claude --plugin-dir node_modules/autotel-claude-code
```

## How it is built

The plugin runs inside Claude Code's hook sandbox (a Bun worker, no ambient imports), so there is no OpenTelemetry SDK here: spans are plain records batched over `$.clock.after` and posted with `$.http.fetch`. `hooks/register.ts` is the boundary that reads the engine's `e` and `next` into plain values; `hooks/recorder.ts` decides what a span is named, where it sits and what it carries; `hooks/otlp.ts` encodes and sends. The hooks are type-checked against the declarations `/plugin-types` writes, vendored in `types/claude-code.d.ts`.

`claude plugin validate .` lists the hooks, the `$` calls and the environment variables the module reads — nothing else is reachable.

## Limits

- A dispatch's own `$` calls (a hook reading a file during `tool.call`) are siblings under the turn, not children of the dispatch: the sandbox has no async context to carry a parent across.
- One attempt per batch; a collector that is down loses that batch. Devtools is loopback, so this has not mattered yet.
