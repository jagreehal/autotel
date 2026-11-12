---
name: autotel-builtin-ai
description: >
  Use this skill when adding OpenTelemetry tracing to Chrome's built-in AI APIs: the on-device model a page runs through `LanguageModel`, `Summarizer`, `Writer`, `Rewriter`, `Translator`, `Proofreader`, `LanguageDetector` and `SemanticEmbedder`. Covers availability, session and per-call spans, tool exchanges (`invoke_agent` / `execute_tool`), download facts, context accounting, streaming timings, refusal kinds, metrics and opt-in payload capture.
---

# autotel-builtin-ai

OpenTelemetry instrumentation for [Chrome's built-in AI APIs](https://developer.chrome.com/docs/ai/built-in). It patches the globals and every session they hand back, so each availability check, session creation and model call becomes a span, and your calls stay as they are.

Behaviour here comes from measurement on Chrome Canary 154 and 159, which in places differs from the specification.

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

Spans go to the global tracer provider that `initFull()` registers, and metrics to the global meter. Pass your own to send them elsewhere:

```typescript
instrumentBuiltInAI({ tracer: provider.getTracer('builtin-ai') });
```

`@opentelemetry/api` is the one peer dependency.

## Core Patterns

### Call it before any session is created

```typescript
instrumentBuiltInAI();

const session = await LanguageModel.create({
  samplingMode: 'most-predictable',
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
});
const answer = await session.prompt('Summarise this basket');
```

The package patches the globals and each session it sees created, clones included. A session created before the call keeps its original methods and produces no spans. Give `LanguageModel` an output language in `expectedOutputs`: Chrome warns that a session without one has degraded quality and safety attestation, and supports `de, en, es, fr, ja`.

### It is safe to call unconditionally

With no built-in AI globals present (an unflagged Chrome, another browser, server rendering), it patches nothing and returns a handle that does nothing. Narrow what it touches with `apis`:

```typescript
instrumentBuiltInAI({ apis: ['LanguageModel', 'Summarizer'] });
```

### Turn payload capture on for a session, not forever

```typescript
instrumentBuiltInAI({ capturePayloads: true, maxPayloadLength: 8192 });
```

Off by default. What people put into an on-device model is often why they wanted it on-device. With capture off you still get sizes, timings, context usage, tool names and refusal kinds. With it on, messages follow the GenAI convention's shapes, media parts appear by modality only, and every attribute stays valid JSON within `maxPayloadLength`.

### Uninstall what you installed

```typescript
const handle = instrumentBuiltInAI();
handle.uninstall();
```

Repeated calls share one installation and count references. Each caller uninstalls its own handle, and the patch comes off after the last one.

### Tell a tool turn from a text turn

A `LanguageModel` session with `tools` resolves `prompt()` to content parts, tool calls and plain answers alike. `readTurn` splits them:

```typescript
import { readTurn } from 'autotel-builtin-ai';

const turn = readTurn(await session.prompt('What is the weather in Kyoto?'));
for (const call of turn.toolCalls) {
  // call.id, call.name, call.arguments
}
```

## What the spans answer

| Span                                        | One per                                                    |
| ------------------------------------------- | ---------------------------------------------------------- |
| `builtin_ai.availability`                   | `availability()` call                                      |
| `create_session {api}`                      | `create()` call: `create_session LanguageModel`            |
| `{method} {api}`                            | model call: `prompt LanguageModel`, `summarize Summarizer` |
| `clone {api}`, `destroy {api}`              | session forked or torn down                                |
| `append {api}`, `measureContextUsage {api}` | context added, or priced before a prompt                   |
| `invoke_agent LanguageModel`                | question on a session with tools: the root of its trace    |
| `execute_tool {name}`                       | tool the page ran, matched to the call by `callId`         |

Only GenAI operations (model calls, `create_session`, `invoke_agent`, `execute_tool`) carry `gen_ai.provider.name`, so GenAI views count model calls and nothing else. The provider is `google.chrome`, or `microsoft.edge` on Edge.

### `builtin_ai.download.real`: did Chrome fetch a model

`create()` blocks for the whole model download: 190,163 ms measured, against 11–26 ms warm. `builtin_ai.create.blocked_on_download` says whether this call paid for it, and `builtin_ai.create.ms` how long.

The download monitor fires on a browser that already has the model, so it cannot tell you alone. A fractional progress event proves a real fetch. Otherwise the availability answer from _before_ the call decides, taken from the page's own `availability()` calls and matched on the core create options (`initialPrompts` and `sharedContext` do not count). Telemetry adds no calls of its own; a page that never asks gets no `download.real`.

### `builtin_ai.create.refusal`: why `create()` threw

| Kind                       | Cause                                                      |
| -------------------------- | ---------------------------------------------------------- |
| `user_activation_required` | The model had to download and the page had no user gesture |
| `feature_disabled`         | Flags or policy switched model execution off               |
| `service_unavailable`      | The on-device model service is not running                 |
| `sampling_incompatible`    | Speculative decoding rejected the sampling options         |
| `download_failed`          | The model download failed (`NetworkError`)                 |

Chrome downloads a model only inside a user gesture. Create the session from a click, and read `builtin_ai.create.user_activation` next to the refusal.

### `builtin_ai.availability.options_supplied`: the guard

On Canary 154, behind a speculative-decoding flag, a bare `availability()` said `unavailable` while the same call with `samplingMode: 'most-predictable'` said `available`, and the documented guard turned the feature off. Canary 159 gives one answer either way. Pass the guard the same options as the `create()` it guards, and `guardWouldRefuse(bare, withOptions)` checks a disagreement if one returns.

## Context, streaming and tools

- **Context:** `builtin_ai.context.usage_before` / `_after`, `_delta`, `remaining`, `utilization`. A `contextoverflow` event, or usage that drops, adds a `builtin_ai.context.overflow` event and marks later calls `builtin_ai.context.compacted`. `measureContextUsage()` spans add `builtin_ai.context.would_overflow`.
- **Streaming:** `gen_ai.response.time_to_first_chunk`, `builtin_ai.stream.chunks` / `.chars`. The span closes with the stream; cancelling it records `builtin_ai.stream.cancelled` and stops the model. A generation that reaches the output limit records finish reason `length`.
- **Tools:** turns and tool runs are siblings under `invoke_agent`, and `execute_tool` spans the gap between the turn that asked and the turn that answered. A clone shares the open exchange, so the page can answer on either session. A question the page never answers closes as `builtin_ai.exchange.abandoned`.
- **Embeddings:** `SemanticEmbedder` spans carry the embedding space (`embeddinggemma-300m` on Canary 159) as `gen_ai.request.model`.
- **Device:** every span carries `builtin_ai.runtime.device_memory_gib`, `.cpu_performance_tier` and `.logical_cores`.

## Metrics

`gen_ai.client.operation.duration` and `gen_ai.client.operation.time_to_first_chunk` per call, and `builtin_ai.create.duration` split by `builtin_ai.download.real`, so model downloads stay out of call latency.

## Review checklist

- Create sessions from a user gesture, or a new visitor's first `create()` refuses.
- Give `LanguageModel` an output language in `expectedOutputs`.
- Guard with the same options as the `create()` it guards.
- Read `builtin_ai.download.real`, not a fired download monitor.
- Call `instrumentBuiltInAI()` before creating sessions; earlier sessions stay untraced.
- Leave `capturePayloads` off unless the page has a reason and the user knows.
