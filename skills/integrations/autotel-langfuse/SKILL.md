---
name: autotel-langfuse
description: >
  Use this skill when sending autotel traces to Langfuse — the `langfuseCompatibility()` span enricher for the fields Langfuse keeps in its own columns, `langfuseScores()` for evaluation results, and `langfuseMedia()` for images and audio. Also covers the larger point that Langfuse ingests plain OTLP, so most of what people reach for this package to do needs no package at all.
---

# autotel-langfuse

**Langfuse is a destination before it is an integration.** It ingests plain OTLP and reads the canonical `gen_ai.*` conventions, so an autotel span tree already arrives as generations, embeddings, agents and tools, with model names, token usage, messages and the right parent/child shape, from a `destinations` entry alone.

Reach for this package only for the handful of fields Langfuse keeps in dedicated columns that no OpenTelemetry convention covers. It depends on no Langfuse package.

## Setup

Wiring Langfuse needs no package:

```typescript
import { init } from 'autotel';

init({
  service: 'support-agent',
  destinations: [
    {
      endpoint: `${process.env.LANGFUSE_BASEURL}/api/public/otel`,
      headers: {
        Authorization: `Basic ${base64(`${publicKey}:${secretKey}`)}`,
      },
      signals: ['traces'],
    },
  ],
});
```

No `@langfuse/otel`, no `@opentelemetry/exporter-*`, no hand-written span processor.

```bash
npm install autotel autotel-langfuse
```

## What you do NOT need this package for

Check this table before writing a mapping. These already arrive:

| Langfuse field                                                | Comes from                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Observation type (`GENERATION`, `EMBEDDING`, `AGENT`, `TOOL`) | `gen_ai.operation.name`                                                      |
| Model, token usage, model parameters                          | `gen_ai.request.*` / `gen_ai.usage.*`                                        |
| Input / output                                                | `gen_ai.input.messages` / `gen_ai.output.messages`                           |
| Cost                                                          | `gen_ai.usage.cost`, emitted by `autotel-genai`                              |
| `user_id`, `session_id`                                       | autotel's `setUser()` / `setSession()`, which write `user.id` / `session.id` |
| `environment`                                                 | `deployment.environment.name`                                                |
| `level`, `status_message`                                     | Span status                                                                  |

## Core Patterns

### Fill in the Langfuse-only fields

```typescript
import { init } from 'autotel';
import { langfuseCompatibility } from 'autotel-langfuse';

init({
  service: 'support-agent',
  destinations: [{ endpoint: `${baseUrl}/api/public/otel`, headers }],
  spanEnrichers: [
    langfuseCompatibility({ tags: ['production'], release: gitSha }),
  ],
});
```

| Langfuse field                         | Where it comes from                                              |
| -------------------------------------- | ---------------------------------------------------------------- |
| `trace_name`                           | The root span's name, or the `traceName` option                  |
| `tags`, `release`, `version`, `public` | Options                                                          |
| `completion_start_time`                | `gen_ai.response.time_to_first_chunk` plus the span's start time |
| `prompt_name`, `prompt_version`        | `gen_ai.prompt.name` / `gen_ai.prompt.version`                   |

Options are all optional, and the processor never overwrites a Langfuse attribute the application already set.

### Use `spanEnrichers`, never `spanProcessors`

`spanProcessors` replaces the pipeline autotel builds, which switches off the destinations you just configured. This is the most common way to wire Langfuse and see nothing arrive.

### Know that one attribute pair moves

`gen_ai.prompt.name` and `gen_ai.prompt.version` are **removed** from the span once mapped, and an enricher runs once for the whole pipeline, so they are gone from every destination rather than only from Langfuse.

Langfuse reads anything under the `gen_ai.prompt` prefix as the legacy prompt-content convention, and once it finds one it takes input and output from that convention alone. Leaving the canonical pair on the span costs you both message attributes:

```text
input:  {"name": "support-router", "version": 1}
output: {}
```

Those are the fields most people open Langfuse to read. If a downstream consumer depends on `gen_ai.prompt.name` surviving, this package is the wrong tool for that pipeline.

### Post evaluation results as scores

Scores are the one thing OTLP cannot carry. Traces go to `/api/public/otel`, scores to `/api/public/scores`, and both take the same Basic auth.

```typescript
import { langfuseScores } from 'autotel-langfuse';

init({
  service: 'support-agent',
  destinations: [{ endpoint: `${baseUrl}/api/public/otel`, headers }],
  subscribers: [langfuseScores({ baseUrl, publicKey, secretKey })],
});
```

```typescript
import { recordEvaluationResult } from 'autotel-genai/events';

recordEvaluationResult(ctx, { name: 'faithfulness', scoreValue: 0.92 });
```

A numeric value becomes `NUMERIC` and a label becomes `CATEGORICAL`. `scoreObservation: true` attaches the score to the span the evaluation ran in rather than to the whole trace. A score that fails to post calls `onError` and never throws into the operation that produced it.

### Upload media instead of sending base64

An image in a prompt reaches the span as a `data:` URI inside `gen_ai.input.messages`, which puts megabytes of base64 through the OTLP pipeline.

```typescript
import { langfuseMedia } from 'autotel-langfuse';

const media = langfuseMedia({ baseUrl, publicKey, secretKey });

const messages = await media.replaceDataUris(JSON.stringify(input), {
  traceId,
  field: 'input',
});
span.setAttribute('gen_ai.input.messages', messages);
```

This belongs in application code, before the attribute is set. It cannot be a span processor: `onEnd` is synchronous and the span exports straight after, so there is nowhere to await an upload, and Langfuse assigns the `mediaId`, so it cannot be filled in optimistically either.

### Mask and filter with what autotel already has

```typescript
init({
  service: 'support-agent',
  destinations: [{ endpoint: `${baseUrl}/api/public/otel`, headers }],
  spanEnrichers: [langfuseCompatibility()],
  attributeRedactor: 'default',
  spanFilter: (span) =>
    Object.keys(span.attributes).some((key) => key.startsWith('gen_ai.')),
});
```

`attributeRedactor` takes a preset (`'default'`, `'strict'`, `'pci-dss'`), a pattern config, or your own function. `spanFilter` runs before redaction, so it can match values that never leave the process.

`spanFilter` applies to the whole pipeline rather than to one destination. With several destinations configured, filtering to `gen_ai.*` for Langfuse also stops HTTP and database spans reaching everything else.

## Review Checklist

- Langfuse wired through `destinations`, with the package added only for the fields in the mapping table
- `spanEnrichers`, not `spanProcessors`
- Nothing downstream depends on `gen_ai.prompt.name` or `gen_ai.prompt.version` surviving the pipeline
- `spanFilter` narrowed for Langfuse is not starving the other destinations
- Media replaced in application code before the attribute is set, not in a processor

## Staying in step

Every line of this package bets on names Langfuse reads and stores, which unit tests cannot check. The package ships a contract test that asks a real Langfuse:

```bash
docker compose -f docker/langfuse.yml up -d
pnpm --filter autotel-langfuse test:contract
```

It reads everything back through public API surfaces only, so a rename upstream fails the test rather than silently emptying a column.
