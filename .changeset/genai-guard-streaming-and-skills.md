---
'autotel-genai': minor
'autotel-devtools': minor
'autotel-adapters': patch
'autotel-aws': patch
'autotel-backends': patch
'autotel-cli': patch
'autotel-drizzle': patch
'autotel-mongoose': patch
'autotel-playwright': patch
'autotel-plugins': patch
'autotel-sentry': patch
'autotel-terminal': patch
'autotel-vitest': patch
'autotel-web': patch
---

feat(genai): inline guard and streaming telemetry, surfaced in the devtools GenAI tab

**autotel-genai** gains two subpath exports and two `events` additions:

- `./guard`: `createGenAiBudget`, `createGenAiGuard`, `parseGuardRules`, and rule factories for cost, token, tool-call, step, and duration ceilings, plus spin-loop, error-loop, and context-window budgets. A stop rule aborts an `AbortSignal` and throws `GEN_AI_GUARD_STOP`. It records `gen_ai.guard.*` events and `gen_ai.session.*` accumulators.
- `./streaming`: `createStreamTimer`, `computeStreamTiming`, and `recordStreamTiming` for time-to-first-chunk, output throughput, and the inter-chunk gap distribution. Records `gen_ai.response.time_to_first_chunk` plus the `time_to_finish`, `output_tokens_per_second`, and `time_per_output_chunk` extensions.
- `setGenAiContent` gates input and output capture and base64-encodes binary parts in place of corrupting them through `JSON.stringify`. New `recordModelWarnings` records the `gen_ai.client.warnings` event.

**autotel-devtools** reads all of it in the GenAI tab:

- Reads `gen_ai.usage.cost.usd` and shows it in place of the price-table estimate (cost `source: 'reported'`), and counts it in run totals.
- Reads the streaming attributes and shows a throughput chip with time-to-first-chunk and tokens/sec.
- Reads `gen_ai.guard.stopped`, the `gen_ai.guard.stop` and `gen_ai.guard.warning` events, and the `gen_ai.session.*` totals. A chip names the rule that fired.
- Reads the `gen_ai.client.warnings` event and shows a chip with the count. Exports `GenAiStreaming`, `GenAiGuard`, `GenAiSession`, and `GenAiWarning`.

**fix(skills)**: packages that ship a `skills/` directory now list `skills` in `package.json#files`, so the skill reaches npm and agents discover it from `node_modules`. This covers autotel-genai and twelve other packages: autotel-adapters, autotel-aws, autotel-backends, autotel-cli, autotel-drizzle, autotel-mongoose, autotel-playwright, autotel-plugins, autotel-sentry, autotel-terminal, autotel-vitest, and autotel-web. The `create-autotel-*` contributor skills now point at tsdown instead of tsup and drop the deleted `skills/index.json` step.
