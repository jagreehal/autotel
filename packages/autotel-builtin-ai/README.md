# autotel-builtin-ai

OpenTelemetry instrumentation for [Chrome's built-in AI APIs](https://developer.chrome.com/docs/ai/built-in) — traces the on-device model sessions your page creates.

The counterpart to [`autotel-webmcp`](../autotel-webmcp). It patches the built-in AI globals and every session they hand back, with no changes required in your calls.

```bash
npm install autotel-builtin-ai autotel-web
```

```ts
import { initFull } from 'autotel-web/full';
import { instrumentBuiltInAI } from 'autotel-builtin-ai';

initFull({ service: 'shop', endpoint: 'https://collector.example.com' });
instrumentBuiltInAI();
```

Every availability check, session creation and model call becomes a span.

## Why this exists

The Prompt API looks synchronous and cheap. Measured, it is neither, and the
parts that bite are the parts nothing reports afterwards:

- `availability()` answers for the **options you passed it**, not for model
  readiness — so the guard in the documentation refuses on a browser where the
  call would have worked.
- `create()` **blocks for the entire model download**. Measured at 190,163 ms
  against 1–3 ms warm.
- The download monitor **fires when nothing is downloaded**, so a progress bar
  flashes 0→100 for every returning user.
- A session **cannot say how it samples**: `samplingMode` reads back `null`
  when `topK` or `temperature` was used.
- Time-to-first-token exists only while the stream is running.

None of it is recoverable after the call. These spans are where it lives.

## Spans

### `builtin_ai.availability`

| Attribute                                  | Meaning                                             |
| ------------------------------------------ | --------------------------------------------------- |
| `builtin_ai.api`                           | Which global was asked                              |
| `builtin_ai.availability.answer`           | What it said                                        |
| `builtin_ai.availability.options_supplied` | **Whether the guard was passed any options at all** |
| `builtin_ai.availability.sampling_option`  | Which sampling knob, if any, the guard used         |

`options_supplied` is the one to alert on. On Canary 154 with speculative
decoding enabled and a working model:

```js
await LanguageModel.availability(); // 'unavailable'
await LanguageModel.availability({ samplingMode: 'most-predictable' }); // 'available'
await LanguageModel.create({ samplingMode: 'most-predictable' }); // succeeds
```

So `availability() !== 'available'` — the shape the docs show — turns the
feature off for users who have it. A bare guard followed by an optioned
`create()` is two spans sharing an installation id, and the disagreement is a
query rather than a bug report. `guardWouldRefuse(bare, withOptions)` is
exported for pages that want to check it themselves.

### `create_session {api}`

Named for the GenAI convention, so a trace list reads as the APIs that were
used — `create_session LanguageModel` — rather than one repeated string.

| Attribute                                   | Meaning                                                           |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `builtin_ai.create.ms`                      | **How long `create()` blocked**                                   |
| `builtin_ai.create.sampling_option`         | `samplingMode`, `topK`, `temperature`, `topK+temperature`, `none` |
| `builtin_ai.create.refusal`                 | `sampling_incompatible` or `service_unavailable`, when it threw   |
| `builtin_ai.availability.before`            | The last answer this page saw for that API                        |
| `builtin_ai.download.events`                | How many progress events arrived                                  |
| `builtin_ai.download.observed`              | Events arrived at all                                             |
| `builtin_ai.download.real`                  | **A model was actually fetched**                                  |
| `builtin_ai.create.blocked_on_download`     | This call paid for that fetch                                     |
| `builtin_ai.context.window`                 | Total tokens available                                            |
| `builtin_ai.context.usage_at_create`        | Tokens the system prompt cost, before any input                   |
| `builtin_ai.session.sampling_mode_reported` | **Whether the session could describe its own sampling**           |
| `builtin_ai.session.sampling_mode`          | The mode, when it could                                           |

`download.real` is the one you cannot get any other way. `create()` fires the
monitor whether or not it downloads anything — on a browser that already has
the model, two events ending at `loaded: 1` within milliseconds — so "the
monitor fired" and "a download happened" are different facts, and only the
availability answer from _before_ the call separates them.

That answer is recorded from the page's own `availability()` calls, never
probed. Asking the platform again before every `create()` would make installing
telemetry add a call the application did not make. The cost is that a page which
never calls `availability()` leaves `download.real` off the span — which is the
honest answer rather than a guess.

`create.refusal` is classified rather than quoted, so it is recorded whether or
not payload capture is on. `sampling_incompatible` means speculative decoding
rejected the sampling options; pair it with `create.sampling_option` to see
which shape was tried. On Canary 154 the error names three remedies and accepts
one: `samplingMode: 'most-predictable'` works, `topK: 1` and `temperature: 0`
are refused by the same error that recommends them.

### `{method} {api}`

One per model call — `prompt LanguageModel`, `summarize Summarizer`,
`rewriteStreaming Rewriter`.

| Attribute                         | Meaning                                          |
| --------------------------------- | ------------------------------------------------ |
| `builtin_ai.streaming`            | Whether this was the streaming variant           |
| `builtin_ai.input.chars`          | Text input length, recorded without capturing it |
| `builtin_ai.input.parts`          | Multimodal input: how many parts                 |
| `builtin_ai.ms`                   | Non-streaming: total time                        |
| `builtin_ai.output.chars`         | Non-streaming: output length                     |
| `builtin_ai.stream.ttft_ms`       | **Time to first token**                          |
| `builtin_ai.stream.total_ms`      | Time to last token                               |
| `builtin_ai.stream.chunks`        | How many chunks arrived                          |
| `builtin_ai.stream.chars`         | How much text arrived                            |
| `builtin_ai.context.usage_before` | Tokens spent before the call                     |
| `builtin_ai.context.usage_after`  | Tokens spent after it                            |
| `builtin_ai.input` / `.output`    | The text, when payload capture is enabled        |
| `error.type`                      | The call rejected: the error's name              |

`ttft_ms` against `total_ms` is the number that changes what you build.
Measured on Gemma 4: 572 ms to first token, 963 ms to last. The first token is
most of the wait, and `create()` costing 1–3 ms means pre-creating a session
buys nothing — pre-_prompting_ one does.

Streaming is measured with a `TransformStream`, so the caller receives a
`ReadableStream` exactly as the platform returned it, chunk for chunk. A stream
nothing ever reads never closes, and neither does its span; a cancelled one
closes both.

Cloned sessions are instrumented too. `clone()` returns a fresh object with its
own methods, so a conversation forked per turn would otherwise fall silent
after its first fork.

### `builtin_ai.install`

Emitted once the patch is live, carrying `builtin_ai.installation.id` — stamped
on every span from that installation — and `builtin_ai.apis`, the globals it
covers. An installation naming fewer APIs than the page uses is the
"instrumented before the flags were on" case, which is otherwise
indistinguishable from an application that never called them.

## Options

```ts
instrumentBuiltInAI({
  capturePayloads: true, // opt in only when your data policy allows it
  maxPayloadLength: 512, // truncate captured payloads (default 2048)
  apis: ['LanguageModel', 'Summarizer'], // default: all of them
});
```

Payload capture is off by default. What people put into an on-device model is
frequently the reason they wanted it on-device. Sizes, timings, context
accounting, download reality and refusal kinds are all available without it.

## Two entry points

`autotel-builtin-ai` wires autotel-web's `span()` in for you, and reaches the
OpenTelemetry browser SDK through it. That needs a bundler, like any app
dependency.

`autotel-builtin-ai/core` is the same instrumentation with no telemetry
dependency at all. You pass `span` yourself. It imports nothing beyond itself,
so it loads straight into a browser with no build step.

```js
import { instrumentBuiltInAI } from 'autotel-builtin-ai/core';

instrumentBuiltInAI({ span: mySpanFactory });
```

`instrumentBuiltInAI()` returns `{ uninstall() }`, and does nothing when no
built-in AI globals are present — an unflagged Chrome, another browser, or
server rendering — so it is safe to call unconditionally. Repeated calls share
one installation and are reference-counted: each handle should be uninstalled
by its owner.

## Notes

Measured against Chrome Canary 154.0.8034.0 with Gemma 4, on macOS. Behaviour
is recorded from measurement rather than read from the specification: the
reproduction harness is [chrome-builtin-ai-probe](https://github.com/jagreehal/chrome-builtin-ai-probe),
which drives a real Canary so the measurements can be re-taken rather than
trusted.

`contextWindow` is 9216 on both Gemma 4 and Gemini Nano V3, so it cannot be
used to tell which model answered. **There is no API that reports the model** —
which is why no attribute here claims to.

Records facts, not judgements: no rules, no thresholds, no opinions about your
prompts. Analysis belongs in whatever consumes the spans.
