---
name: autotel-builtin-ai
description: >
  Use this skill when adding OpenTelemetry tracing to Chrome's built-in AI APIs — the on-device model a page runs through `LanguageModel`, `Summarizer`, `Writer`, `Rewriter`, `Translator` and friends. Covers availability, session creation and per-call spans, the download facts nothing else reports, streaming timings, opt-in payload capture, and the guard shape in Chrome's own docs that turns the feature off for users who have it.
---

# autotel-builtin-ai

OpenTelemetry instrumentation for [Chrome's built-in AI APIs](https://developer.chrome.com/docs/ai/built-in). It patches the globals and every session they hand back, so each availability check, session creation and model call becomes a span with no change to your calls.

Behaviour here is measured on Canary 154.0.8034.0 rather than read from the specification, because the two disagree in the places that matter.

**This is the on-device model.** For tools a page offers a browser agent, use `autotel-webmcp`. For server-side LLM calls, use `autotel-genai`.

## Setup

```bash
npm install autotel-builtin-ai autotel-web
```

```typescript
import { initFull } from 'autotel-web/full';
import { instrumentBuiltInAI } from 'autotel-builtin-ai';

initFull({ service: 'shop-web', endpoint: 'http://localhost:4318' });

instrumentBuiltInAI();
```

`autotel-web` is a peer dependency and the import is static, so `span()` stays synchronous. A dynamic import would turn every model call into a promise.

## Two entry points

`autotel-builtin-ai` fills in autotel-web's `span()` and reaches the OpenTelemetry browser SDK through it, so it needs a bundler like any app dependency.

`autotel-builtin-ai/core` is the same instrumentation with no telemetry dependency. You pass `span` yourself, it imports nothing beyond itself, and it loads straight into a browser with no build step.

```javascript
import { instrumentBuiltInAI } from 'autotel-builtin-ai/core';

instrumentBuiltInAI({ span: mySpanFactory });
```

## Core Patterns

### Call it before any session is created

```typescript
instrumentBuiltInAI();

const session = await LanguageModel.create({
  samplingMode: 'most-predictable',
});
const answer = await session.prompt('Summarise this basket');
```

The package patches the globals and each session it sees created, including sessions produced by `clone()`. A session created before the call keeps its original methods and produces no spans.

### It is safe to call unconditionally

With no built-in AI globals present — an unflagged Chrome, another browser, server rendering — it patches nothing and returns a no-op handle. No guard of your own is needed.

Narrow what it touches with `apis`:

```typescript
instrumentBuiltInAI({ apis: ['LanguageModel', 'Summarizer'] });
```

### Turn payload capture on for a session, not forever

```typescript
instrumentBuiltInAI({ capturePayloads: true, maxPayloadLength: 4096 });
```

Off by default. What people put into an on-device model is frequently the reason they wanted it on-device. With capture off you still get character counts, part counts, timings, context usage and a classified refusal reason, which answers most questions about a misbehaving call.

### Uninstall what you installed

```typescript
const handle = instrumentBuiltInAI();
handle.uninstall();
```

Repeated calls share one installation and are reference-counted. Each caller uninstalls its own handle, and the patch comes off after the last one.

## What the spans answer

| Span                      | One per                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `builtin_ai.availability` | `availability()` call                                       |
| `create_session {api}`    | `create()` call — `create_session LanguageModel`            |
| `{method} {api}`          | model call — `prompt LanguageModel`, `summarize Summarizer` |

Three facts are the reason the package exists.

### `builtin_ai.availability.options_supplied` — the guard trap

`availability()` answers for the **options you passed it**, not for model readiness. On Canary 154 with speculative decoding enabled and a working model:

```javascript
await LanguageModel.availability(); // 'unavailable'
await LanguageModel.availability({ samplingMode: 'most-predictable' }); // 'available'
await LanguageModel.create({ samplingMode: 'most-predictable' }); // succeeds
```

So `availability() !== 'available'` — the guard Chrome's own docs show — refuses on a browser where the call would have worked. **Pass the guard the same options as the `create()` it guards.** `guardWouldRefuse(bare, withOptions)` is exported so a page can check the disagreement itself; in telemetry, a bare guard followed by an optioned create is two spans sharing `builtin_ai.installation.id`.

### `builtin_ai.download.real` — was anything actually fetched

`create()` blocks for the whole model download: 190,163 ms measured, against 1–3 ms warm. `builtin_ai.create.blocked_on_download` says whether this call paid for it, and `builtin_ai.create.ms` says how long.

The monitor alone cannot tell you. It fires whether or not anything is downloaded — on a browser that already has the model, two events ending at `loaded: 1` within milliseconds — so a progress bar flashes 0→100 for returning visitors. Only the availability answer from _before_ the call separates the two, and that answer is read from the page's own `availability()` calls, keyed by API **and** the sampling options used. It is never probed: installing telemetry must not add a call the application did not make. A page that never calls `availability()` leaves `download.real` off the span, which is the honest answer rather than a guess.

### `builtin_ai.session.sampling_mode_reported` — can the session describe itself

`session.samplingMode` reads back `null` when `topK` or `temperature` was used, so a session created those ways cannot say how it samples. `builtin_ai.create.sampling_option` records what was actually passed (`samplingMode`, `topK`, `temperature`, `topK+temperature`, `none`).

Pair it with `builtin_ai.create.refusal`. `sampling_incompatible` means speculative decoding rejected the sampling options; on Canary 154 the error names three remedies and accepts one — `samplingMode: 'most-predictable'` works, `topK: 1` and `temperature: 0` are refused by the same error that recommends them.

## Streaming

`builtin_ai.stream.ttft_ms`, `.total_ms`, `.chunks`, `.chars`. Time to first token exists only while the stream is running, so nothing else can reconstruct it afterwards.

The span is emitted alongside the stream rather than around it: the caller is handed the stream immediately and the span closes when the stream does. A stream nothing ever reads never closes, which is the same shape as the request it measures. A failed source records `error.type`; a caller that walks away records `builtin_ai.stream.cancelled`.

## Attributes

| Attribute                                        | Notes                                                 |
| ------------------------------------------------ | ----------------------------------------------------- |
| `builtin_ai.api`                                 | Which global — `LanguageModel`, `Summarizer`, …       |
| `builtin_ai.installation.id`                     | The `instrumentBuiltInAI()` call this span belongs to |
| `builtin_ai.availability.answer`                 | What `availability()` said                            |
| `builtin_ai.availability.options_supplied`       | Whether the guard was passed any options              |
| `builtin_ai.availability.before`                 | The last answer this page saw, for these options      |
| `builtin_ai.create.ms`                           | How long `create()` blocked                           |
| `builtin_ai.create.sampling_option`              | Which sampling knob was used                          |
| `builtin_ai.create.refusal`                      | `sampling_incompatible` / `service_unavailable`       |
| `builtin_ai.create.blocked_on_download`          | This call paid for a real fetch                       |
| `builtin_ai.download.events` / `.observed`       | Progress events, and whether any arrived              |
| `builtin_ai.download.real`                       | A model was actually fetched                          |
| `builtin_ai.context.window` / `.usage_at_create` | Tokens available, and what the system prompt cost     |
| `builtin_ai.session.sampling_mode_reported`      | Whether the session could describe its sampling       |
| `builtin_ai.ms`                                  | One awaited model call                                |
| `builtin_ai.output.chars` / `input.chars`        | Sizes, recorded with capture off                      |
| `builtin_ai.output` / `builtin_ai.input`         | Content, only with capture on                         |
| `gen_ai.operation.name`                          | `create_session`, so GenAI dashboards find these      |

## Review checklist

- Guard with the **same options** as the `create()` it guards, or it refuses on working browsers.
- Do not read a fired download monitor as a download. Check `builtin_ai.download.real`.
- Do not trust `session.samplingMode` to report `topK` / `temperature`.
- Call `instrumentBuiltInAI()` before creating sessions; earlier sessions are untraced.
- Leave `capturePayloads` off unless the page has a reason and the user knows.
