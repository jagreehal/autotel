---
'autotel': minor
'autotel-genai': minor
'autotel-cli': minor
'autotel-terminal': minor
'autotel-devtools': patch
---

**autotel**

- An `Error` in attribute fields records its `name`, `message`, `stack`, scalar fields such as `code`, and its `cause` chain. autotel skips `config`, `request`, `response`, `headers` and `options`, where HTTP clients keep credentials. `{ error: err }` now produces `error.name`, `error.message` and `error.stack`, and `toAttributeValue(err)` returns `undefined` so the error flattens like any object.
- Redaction matches key patterns against the last dot segment too, so `user.password` and `http.request.header.authorization` get redacted, along with string arrays under a matching key. Custom `keyPatterns` see the last segment as well.
- `spanEnrichers` drain before the exporters flush or shut down, so spans an enricher ends at exit reach the exporter. `EnrichedSpanProcessor` gives the same order to apps that build their own SDK.

**autotel-genai**

- New `autotel-genai/signals` (experimental): `defineSignal` and `createSignals` ask your AI SDK evaluation model yes/no, pick-one or rubric questions about finished requests. Answers land as `signals.<name>.*` attributes, and a `keep` answer can retain a request through tail sampling. Budget, cooldown, timeout, cache and redaction come built in.

**autotel-cli**

- `autotel map --format github` emits GitHub Actions annotations: regressions as errors with `--baseline`, the "Fix these first" list as warnings without one. `--limit` caps the list and the first line carries the score.

**autotel-terminal**

- Bring your own model: pass any AI SDK model to `renderTerminal({ ai: { model } })`, or a spec to `--model`/`AI_MODEL` (`ollama:`, `openai:`, `openai-compatible:` or a gateway id). Install the provider package you use; `@ai-sdk/openai`, `@ai-sdk/openai-compatible` and `ai-sdk-ollama` are optional peers. Name a model to use a remote provider; a local Ollama starts the assistant on its own.

**autotel-devtools**

- The GenAI tab shows tool arguments and results, unwraps MCP tool results, and folds an MCP call seen from both ends into one row. Selection follows trace and span ids, so `#tab=genai&trace=…&span=…` links open the right span.
