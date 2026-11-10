# autotel-builtin-ai

OpenTelemetry instrumentation for [Chrome's built-in AI APIs](https://developer.chrome.com/docs/ai/built-in). It traces the on-device model sessions your page creates.

It is the counterpart to [`autotel-webmcp`](../autotel-webmcp). It patches the built-in AI globals and every session they hand back, and your calls stay as they are.

```bash
npm install autotel-builtin-ai autotel-web
```

```ts
import { initFull } from 'autotel-web/full';
import { instrumentBuiltInAI } from 'autotel-builtin-ai';

initFull({ service: 'shop', endpoint: 'https://collector.example.com' });
instrumentBuiltInAI();
```

Each availability check, session creation, model call, clone and destroy
becomes a span. A `LanguageModel` question answered with tools becomes one
trace: an `invoke_agent` root with each model turn and each tool run beneath it.

Spans go to the global OpenTelemetry tracer provider, which `autotel-web`
registers. Pass `tracer` to send them somewhere else.

## What it records

The Prompt API looks synchronous and cheap. These are the costs and behaviours
you can see only while a call runs:

- `availability()` can answer for the options you pass it as well as for model
  readiness. On Canary 154, behind an experimental speculative-decoding flag,
  the guard in the documentation refused on a browser where `create()` worked.
  Canary 159 no longer offers that flag and gives one answer either way.
- `create()` blocks for the entire model download: 190,163 ms measured, against
  11–26 ms warm.
- The download monitor fires when the model is already on disk, so a progress
  bar flashes 0→100 for a returning user.
- Web pages ignore `topK` and `temperature`. On Canary 159 a session created
  with `temperature: 0` reads back `samplingMode: 'balanced'`; on 154 it read
  back `null`.
- Time to first token exists only while the stream runs.

The spans keep each of these after the call returns.

## Spans

### `builtin_ai.availability`

| Attribute                                  | Meaning                                     |
| ------------------------------------------ | ------------------------------------------- |
| `builtin_ai.api`                           | Which global was asked                      |
| `builtin_ai.availability.answer`           | What it said                                |
| `builtin_ai.availability.options_supplied` | **Whether the guard passed any options**    |
| `builtin_ai.availability.sampling_option`  | Which sampling knob, if any, the guard used |

`options_supplied` is the one to watch. On Canary 154 with speculative
decoding enabled and a working model:

```js
await LanguageModel.availability(); // 'unavailable'
await LanguageModel.availability({ samplingMode: 'most-predictable' }); // 'available'
await LanguageModel.create({ samplingMode: 'most-predictable' }); // succeeds
```

There, `availability() !== 'available'`, the shape the docs show, turned the
feature off for users who had it. On Canary 159 the flag is gone from
`chrome://flags`, availability gives the same answer with or without options,
and Chrome accepts each sampling shape. If a later Chrome brings the behaviour
back, a bare guard followed by an optioned `create()` shows up as two spans
sharing an installation id, and one query finds it.
`guardWouldRefuse(bare, withOptions)` is exported for pages that want to check
it themselves.

### `create_session {api}`

The name follows the GenAI convention, so a trace list reads as the APIs in
use: `create_session LanguageModel`, `create_session Summarizer`.

| Attribute                                         | Meaning                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `builtin_ai.create.ms`                            | **How long `create()` blocked**                                        |
| `builtin_ai.create.sampling_option`               | `samplingMode`, `topK`, `temperature`, `topK+temperature`, `none`      |
| `builtin_ai.create.refusal`                       | Why it threw: see below                                                |
| `builtin_ai.create.user_activation`               | Whether a user gesture was live when it ran                            |
| `builtin_ai.availability.before`                  | The last answer this page saw for those options                        |
| `builtin_ai.download.events`                      | How many progress events arrived                                       |
| `builtin_ai.download.observed`                    | Whether any arrived                                                    |
| `builtin_ai.download.real`                        | **Whether Chrome fetched a model**                                     |
| `builtin_ai.download.ms`                          | First to last progress event, for a real download                      |
| `builtin_ai.create.blocked_on_download`           | Whether this call paid for that fetch                                  |
| `builtin_ai.context.window`                       | Total tokens available                                                 |
| `builtin_ai.context.usage_at_create`              | Tokens the system prompt cost, before any input                        |
| `builtin_ai.session.sampling_mode_reported`       | **Whether the session described its own sampling**                     |
| `builtin_ai.session.sampling_mode`                | The mode it reported                                                   |
| `builtin_ai.request.output_languages`             | From `expectedOutputs` or `outputLanguage`; absent when none was given |
| `builtin_ai.tool.names`                           | Tools declared on the session                                          |
| `builtin_ai.session.expected_inputs` / `_outputs` | Declared modalities, as JSON                                           |
| `gen_ai.system_instructions`                      | System prompts, with payload capture on                                |
| `gen_ai.tool.definitions`                         | Tool declarations, with payload capture on                             |

`download.real` answers a question nothing else can. `create()` fires the
monitor on a browser that already has the model: two events ending at
`loaded: 1` within milliseconds. Two facts separate that from a download: a
fractional progress event, which only a real fetch produces, and the
availability answer from _before_ the call. A real download also adds a
`builtin_ai.download.complete` event.

The package takes that answer from the page's own `availability()` calls and
asks the platform nothing extra, so installing telemetry adds no calls of its
own. A page that never calls `availability()`, on a create with no fractional
progress, gets no `download.real`: the span records what it knows.

The package classifies `create.refusal` from the error and quotes nothing, so
you get it with payload capture off. `sampling_incompatible` means speculative
decoding rejected the sampling options; pair it with `create.sampling_option`
to see which shape the page tried. On Canary 154 the error names three remedies
and accepts one: `samplingMode: 'most-predictable'`. The Prompt API explainer
has since deprecated `topK` and `temperature` for web pages.

| Kind                       | Cause                                                                          |
| -------------------------- | ------------------------------------------------------------------------------ |
| `sampling_incompatible`    | Speculative decoding rejected the sampling options                             |
| `service_unavailable`      | The on-device model service is not running                                     |
| `feature_disabled`         | Flags or policy switched model execution off                                   |
| `download_failed`          | The model download failed (`NetworkError`, per the explainer)                  |
| `user_activation_required` | The model had to download and the page had no user gesture (`NotAllowedError`) |

Chrome starts a download from `create()` only inside a user gesture. A
`create()` on page load works for a returning visitor and refuses for a new
one, and `create.user_activation: false` next to the refusal tells you which
happened. On Canary 159 the refusal reads: _Requires a user gesture when
availability is "downloading" or "downloadable"._ Permissions-policy refusals
share the `NotAllowedError` name, so the package sets the kind when the message
names the gesture; the activation attribute covers the rest.

Chrome deletes the model when the profile's volume falls below 10 GB free, and
downloads it again once there is room. A returning visitor with
`download.real: true` had a full disk.

### `{method} {api}`

One per model call: `prompt LanguageModel`, `summarize Summarizer`,
`rewriteStreaming Rewriter`. Every argument, per-call options such as `signal`
and `responseConstraint` included, reaches the platform as the page passed it.

| Attribute                                    | Meaning                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `gen_ai.operation.name`                      | `generate_content`; `embeddings` for `embed`; absent for `detect`              |
| `gen_ai.provider.name`                       | `microsoft.edge` on Edge, else `google.chrome` (option `providerName`)         |
| `gen_ai.conversation.id`                     | The session's conversation, shared by its clones                               |
| `gen_ai.request.stream`                      | Set on the streaming variant                                                   |
| `gen_ai.output.type`                         | `json` when the page passed a `responseConstraint`                             |
| `gen_ai.response.finish_reasons`             | `stop`, `tool_call`, `length`, `abort` or `error`                              |
| `gen_ai.response.time_to_first_chunk`        | **Time to first token**, seconds                                               |
| `builtin_ai.session.id` / `.parent_id`       | This session, and the session a clone came from                                |
| `builtin_ai.embedding.space`                 | `SemanticEmbedder`: the space its vectors land in, also `gen_ai.request.model` |
| `builtin_ai.turn.index`                      | Call order within the session                                                  |
| `builtin_ai.streaming`                       | Whether this was the streaming variant                                         |
| `builtin_ai.input.chars`                     | Text input length, recorded without capturing it                               |
| `builtin_ai.input.parts`                     | Message-list input: how many messages                                          |
| `builtin_ai.output.chars`                    | Text output length                                                             |
| `builtin_ai.stream.chunks` / `.chars`        | How many chunks and how much text arrived                                      |
| `builtin_ai.stream.cancelled`                | The caller stopped reading the stream                                          |
| `builtin_ai.context.usage_before` / `_after` | Tokens spent before and after the call                                         |
| `builtin_ai.context.usage_delta`             | What this call cost                                                            |
| `builtin_ai.context.remaining`               | Tokens left afterwards                                                         |
| `builtin_ai.context.utilization`             | Fraction of the window used afterwards                                         |
| `builtin_ai.context.compacted`               | The session overflowed and compacted its context                               |
| `builtin_ai.tool.call_count` / `_names`      | Tools this turn asked for                                                      |
| `gen_ai.input.messages` / `.output.messages` | The messages, with payload capture on                                          |
| `error.type`                                 | The call rejected: the error's name                                            |

Time to first token against the span's duration tells you what to build. On
Gemma 4 a stream took 572 ms to first token and 963 ms to last on Canary 154,
and 197 ms and 296 ms on Canary 159, warm and uncontended. The first token is
most of the wait and a warm `create()` costs 11–26 ms, so pre-_prompting_ a
session buys more than pre-creating one. Calls on one model queue behind each
other: with a long generation in flight, a `create()` took 68 s and a
`measureContextUsage()` 117 s.

The package reads context from `contextUsage` / `contextWindow`, or `inputUsage`
/ `inputQuota` on the writing-assistance APIs. A `contextoverflow` (or
`quotaoverflow`) event, or usage that drops across a call, adds a
`builtin_ai.context.overflow` event to the call it happened in, and marks each
later call `builtin_ai.context.compacted`.

The package reads the platform's stream inside one of its own, and you receive
each chunk as the platform sent it: text as strings, tool calls as structured
chunks. Chrome (Canary 159) does not run a `TransformStream` transformer's
`cancel` hook, so reading the source directly is how the span sees an error or
a cancel. Cancelling the stream you hold cancels the platform's, and the model
stops generating. A stream nobody reads stays open, and so does its span.

A generation that reaches the output limit rejects with `QuotaExceededError:
The response exceeded output limits and was truncated`. The span records finish
reason `length`, the convention's name for it, alongside the error.

### `clone {api}` and `destroy {api}`

`clone()` returns a fresh object with its own methods, and the package
instruments it too, so a conversation forked per turn keeps its spans. The
clone keeps `gen_ai.conversation.id`, gets its own `builtin_ai.session.id`, and
points back with `builtin_ai.session.parent_id`.

### `append {api}` and `measureContextUsage {api}`

`append()` adds to the context without asking for an answer: its span carries
the context before and after. `measureContextUsage()` (or `measureInputUsage()`)
prices an input without spending it: `builtin_ai.context.measured`, plus
`builtin_ai.context.would_overflow` when the session's usage plus that price
exceeds the window. Neither is a turn, so neither opens a tool exchange.

### Tool calls: `invoke_agent LanguageModel` and `execute_tool {name}`

On a session created with `tools`, a question is one trace:

```
invoke_agent LanguageModel        "Weather and population of Kyoto?"
├── prompt LanguageModel          asks for two tools
├── execute_tool get_weather
├── execute_tool get_population
└── prompt LanguageModel          "Light rain; 1.4 million people."
```

Turns and tool runs are siblings: they happen one after another, and backends
summarise a trace from its root while the answer arrives on the last turn. The
root carries `builtin_ai.exchange.turns` and `.tool_calls`, plus the final
answer with capture on.

The tool runs in page code, so the package rebuilds `execute_tool` from the end
of the turn that asked for the call to the moment the page sent the response,
paired by `callId` (`gen_ai.tool.call.id`). With capture on it also carries
`gen_ai.tool.description`, `gen_ai.tool.call.arguments` and `.result`. A response
carrying `errorMessage` sets error status.

When the page moves on without answering (a new question arrives, or it
destroys the session), the root closes with `builtin_ai.exchange.abandoned`.

### `builtin_ai.install`

The package emits this once the patch is live. It carries
`builtin_ai.installation.id`, which every span from that installation repeats,
and `builtin_ai.apis`, the globals it covers. An installation naming fewer APIs
than the page uses means the page installed before the flags were on.

### The device

Every span carries what the browser reports about the hardware the model runs
on, since the hardware sets on-device latency:
`builtin_ai.runtime.device_memory_gib` (`navigator.deviceMemory`),
`builtin_ai.runtime.cpu_performance_tier` (`navigator.cpuPerformance`) and
`builtin_ai.runtime.logical_cores` (`navigator.hardwareConcurrency`). The span
leaves off a hint the browser does not offer.

Chrome's published floor for the foundation model is more than 4 GB of GPU
memory, or 16 GB of RAM with 4 CPU cores. `logical_cores` and
`device_memory_gib` answer the CPU path: on Canary `navigator.deviceMemory`
reads 32, so it separates a 16 GB machine from an 8 GB one. No web API reports
GPU memory.

## Metrics

| Metric                                            | Attributes                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `gen_ai.client.operation.duration` (s)            | `gen_ai.operation.name`, `gen_ai.provider.name`, `builtin_ai.api`, `builtin_ai.method`, `error.type` |
| `gen_ai.client.operation.time_to_first_chunk` (s) | the same, streaming calls only                                                                       |
| `builtin_ai.create.duration` (s)                  | `builtin_ai.api`, `builtin_ai.download.real`                                                         |

The package records these through the global meter provider (or `meter`), with
the GenAI convention's advised bucket boundaries. `create.duration` stands
apart from operation duration because a create that downloads a model blocks
for minutes, and averaging that into model calls would hide both.

## Options

```ts
instrumentBuiltInAI({
  capturePayloads: true, // opt in when your data policy allows it
  maxPayloadLength: 8192, // cap each captured attribute (default 32768)
  apis: ['LanguageModel', 'Summarizer'], // default: all of them
  providerName: 'google.chrome', // gen_ai.provider.name; default detects Edge
  tracer, // default: the global provider's `autotel-builtin-ai` tracer
  meter, // default: the global provider's `autotel-builtin-ai` meter
});
```

Payload capture is off by default: what people put into an on-device model is
often why they wanted it on-device. Sizes, timings, context accounting,
download facts, tool names and refusal kinds all arrive without it. With
capture on, messages follow the GenAI convention's shape, and image and audio
parts appear as `{ "type": "redacted", "modality": "image" }`. The package caps
each captured attribute at `maxPayloadLength` characters from the inside: it
cuts long strings first, then drops trailing entries from the longest lists
behind a `...[n more]` marker, so every attribute stays valid JSON. Error
messages go on the span status and an exception event with capture on.

`instrumentBuiltInAI()` returns `{ uninstall() }`, and patches nothing when no
built-in AI globals exist (an unflagged Chrome, another browser, server
rendering), so you can call it unconditionally. Repeated calls share one
installation and count references: each owner uninstalls its own handle.

## Notes

Measured on Chrome Canary 154.0.8034.0 and 159.0.8154.0 with Gemma 4, on macOS.
The behaviour described here comes from measurement in a real Canary, which in
places differs from the specification.

The package reads the current names (`contextUsage`, `contextWindow`,
`measureContextUsage()`, `contextoverflow`) and falls back to the old ones
(`inputUsage`, `inputQuota`, `measureInputUsage()`, `quotaoverflow`). The
explainer removed the old names from web pages; extensions still have them.

`contextWindow` is 9216 on both Gemma 4 and Gemini Nano V3, so it cannot tell
you which model answered. The generative APIs report no model, and their spans
claim none. `SemanticEmbedder` is the exception: on Canary 159 `params()` lists
one space, `embeddinggemma-300m`, named for the model that produces it, and
embedding spans carry it as `gen_ai.request.model`.

The spans record facts: no rules, no thresholds, no opinions about your prompts.
Analysis belongs in whatever consumes them.
