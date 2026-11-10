# Proposal: GenAI conventions for user-agent-provided models

A draft proposal for the OpenTelemetry GenAI semantic conventions.
`autotel-builtin-ai` implements everything below under its own `builtin_ai.*`
names, which would become aliases once the conventions exist.

## Problem

Chrome and Edge ship web APIs backed by an on-device model the browser
provides: the Prompt API (`LanguageModel`) and the Summarizer, Writer,
Rewriter, Proofreader, Translator and Language Detector APIs. Instrumenting
them with today's GenAI conventions leaves four gaps.

1. **No provider value.** The model belongs to the user agent, not to an API
   endpoint. `gcp.gen_ai` is defined as a Google generative AI endpoint, and
   Edge serves the same APIs over a different model (Phi-4-mini by default, Aion-1.0-Instruct behind a flag), so there is no
   well-known value that fits. Instrumentations invent their own
   (`google.chrome`).
2. **No model identity.** The platform exposes no model id, so
   `gen_ai.request.model` / `gen_ai.response.model` cannot be set. The
   conventions should say what to do when the model is unknowable, rather than
   leaving it to look like an instrumentation bug. Even within one browser the
   model varies: Chrome serves Gemini Nano or Gemma with the same 9216-token
   window, and Edge switches models behind a flag.
   The one exception so far: Chrome's `SemanticEmbedder` names its embedding
   space after the model (`embeddinggemma-300m`), and that is usable as
   `gen_ai.request.model`.
3. **Context occupancy, not token billing.** The session reports
   `contextUsage` and `contextWindow`, and fires `contextoverflow` when it evicts
   older turns. None of that maps to `gen_ai.usage.*`, which counts tokens billed
   per request. There is no attribute for window size, occupancy, or a
   conversation that has been compacted.
4. **Model availability and download.** Before first use the model may need
   downloading (gigabytes, minutes). `create()` blocks for the whole download,
   and the progress monitor fires `loaded: 0` then `loaded: 1` even when nothing
   downloads, so "progress fired" is not "a download happened". This is the
   largest latency an on-device app has, and nothing in the conventions can
   express it.

## Proposal

### `gen_ai.provider.name` values

| Value            | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `google.chrome`  | A model provided by Google Chrome through built-in web APIs  |
| `microsoft.edge` | A model provided by Microsoft Edge through built-in web APIs |

Following the existing `{vendor}.{product}` pattern (`aws.bedrock`,
`azure.ai.openai`).

### Attributes

| Attribute                         | Type    | Description                                                  |
| --------------------------------- | ------- | ------------------------------------------------------------ |
| `gen_ai.context.window`           | int     | Tokens the session's context can hold                        |
| `gen_ai.context.usage`            | int     | Tokens occupied after the operation                          |
| `gen_ai.conversation.compacted`   | boolean | The conversation has evicted earlier turns to fit its window |
| `gen_ai.model.download.performed` | boolean | The operation fetched model weights before it could run      |
| `gen_ai.model.download.duration`  | double  | Seconds spent fetching weights, when one was performed       |

`gen_ai.context.*` is not specific to browsers: local runtimes (Ollama,
llama.cpp, LM Studio) report the same occupancy and window.

### Operations

`create_session` for the call that loads a model and opens a session, and
`check_availability` for the call that asks whether one can. Both carry the
download attributes above.

### Guidance

- When the platform exposes no model id, leave `gen_ai.request.model` unset
  rather than inventing one.
- Download is `performed` only when there is fractional progress (`0 < loaded <
1`) or the availability answer before the call was `downloadable` /
  `downloading`. A monitor that fired is not evidence.
- Tool calls in the Prompt API are open loop: the model emits a `tool-call`, the
  page runs the tool and replies with a `tool-response` on the next prompt. An
  `execute_tool` span is therefore reconstructed from outside, from the end of
  the turn that requested the call to the start of the turn carrying its
  response, paired by call id. This should be called out as valid, since the
  instrumentation never observes the tool itself.

## Prior art

`autotel-builtin-ai` implements all of the above under `builtin_ai.*` names
(this repository).
