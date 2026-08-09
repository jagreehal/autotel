# autotel-langfuse

**Langfuse is a destination, not an integration.**

Langfuse ingests plain OTLP and reads the canonical `gen_ai.*` semantic
conventions. So an autotel span tree already arrives as generations,
embeddings, agents, and tools, with model names, token usage, input and output
messages, and the right parent/child shape, from nothing but a `destinations`
entry:

```ts
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

That is the whole wiring. No `@langfuse/otel`, no `@opentelemetry/exporter-*`,
no span processor written by hand. **This package is not required for any of
it,** and it does not depend on a Langfuse package either.

## What this package adds

Langfuse keeps a handful of facts in dedicated columns and reads them from its
own attributes, because no OpenTelemetry convention covers them. This is a span
processor that fills those in from what your spans already carry:

```ts
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
| `trace_name`                           | the root span's name, or the `traceName` option                  |
| `tags`, `release`, `version`, `public` | options                                                          |
| `completion_start_time`                | `gen_ai.response.time_to_first_chunk` plus the span's start time |
| `prompt_name`, `prompt_version`        | `gen_ai.prompt.name` / `gen_ai.prompt.version`                   |

Use `spanEnrichers`, not `spanProcessors`. The latter replaces the pipeline
autotel builds, which would switch off the destinations you just configured.

### One attribute pair is moved, not copied

`gen_ai.prompt.name` and `gen_ai.prompt.version` are **removed** from the span
once they have been mapped, and an enricher runs once for the whole pipeline, so
they are gone from every destination rather than only from Langfuse.

That is deliberate and it is not tidiness. Langfuse reads anything under the
`gen_ai.prompt` prefix as the legacy prompt-content convention, and once it finds
one it takes input and output from that convention alone:

```
# with the canonical attributes left on the span
input:  {"name": "support-router", "version": 1}
output: {}
```

Both message attributes are discarded — the fields most people open Langfuse to
read. Verified against Langfuse Cloud; sending `langfuse.observation.prompt.*`
alone links the prompt _and_ keeps the messages, which is what this package
does.

## Masking and filtering are already yours

Neither needs a Langfuse-specific answer, and this package deliberately does not
ship one:

```ts
init({
  service: 'support-agent',
  destinations: [{ endpoint: `${baseUrl}/api/public/otel`, headers }],
  spanEnrichers: [langfuseCompatibility()],

  // Masks values before anything is exported, Langfuse included.
  attributeRedactor: 'default',

  // Send Langfuse the AI spans and nothing else.
  spanFilter: (span) =>
    Object.keys(span.attributes).some((key) => key.startsWith('gen_ai.')),
});
```

`attributeRedactor` takes a preset (`'default'`, `'strict'`, `'pci-dss'`), a
pattern config, or your own function. `spanFilter` runs before redaction, so it
can match on values that never leave the process.

One caveat worth knowing before you reach for `spanFilter`: it applies to the
whole pipeline, not to one destination. With several destinations configured,
filtering to `gen_ai.*` for Langfuse's benefit also stops your HTTP and database
spans reaching everything else.

## What you do not need this for

These already work, and are worth knowing so you do not go looking for a mapping
that is not needed:

| Langfuse field                                                | Already arrives from                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| observation type (`GENERATION`, `EMBEDDING`, `AGENT`, `TOOL`) | `gen_ai.operation.name`                                                      |
| model, token usage, model parameters                          | `gen_ai.request.*` / `gen_ai.usage.*`                                        |
| input / output                                                | `gen_ai.input.messages` / `gen_ai.output.messages`                           |
| cost                                                          | `gen_ai.usage.cost`, emitted by `autotel-genai`                              |
| `user_id`, `session_id`                                       | autotel's `setUser()` / `setSession()`, which write `user.id` / `session.id` |
| `environment`                                                 | `deployment.environment.name`                                                |
| `level`, `status_message`                                     | span status                                                                  |

## Options

```ts
langfuseCompatibility({
  traceName: 'support-chat', // or (span) => string | undefined
  tags: ['production', 'eu'],
  release: process.env.GIT_SHA,
  version: '2.1.0',
  public: false,
});
```

Every field is optional. The processor never overwrites an application-set
Langfuse attribute, so a span that already carries `langfuse.trace.name` keeps
it. The canonical prompt pair is the documented exception: it is moved to the
Langfuse names and removed from the span.

## Evaluation results as scores

Scores are the one thing OTLP cannot carry. Traces go to `/api/public/otel`,
scores go to `/api/public/scores`, and both take the same Basic auth, so this
bridge speaks that wire API directly rather than depending on
`@langfuse/client`:

```ts
import { init } from 'autotel';
import { langfuseScores } from 'autotel-langfuse';

init({
  service: 'support-agent',
  destinations: [{ endpoint: `${baseUrl}/api/public/otel`, headers }],
  subscribers: [langfuseScores({ baseUrl, publicKey, secretKey })],
});
```

Anything that records an evaluation then lands as a score against the run that
produced it, because autotel already stamps every event with its trace:

```ts
import { recordEvaluationResult } from 'autotel-genai/events';

recordEvaluationResult(ctx, { name: 'faithfulness', scoreValue: 0.92 });
```

A numeric value becomes a `NUMERIC` score and a label becomes `CATEGORICAL`.
Pass `scoreObservation: true` to attach the score to the span the evaluation ran
in rather than to the whole trace. A score that fails to post calls `onError`
and never throws into the operation that produced it.

## Images and audio as media, not base64

An image in a prompt arrives on the span as a `data:` URI inside
`gen_ai.input.messages`. Langfuse can process that server-side as a fallback,
but it first puts megabytes of base64 through the OTLP pipeline. Langfuse
recommends extracting and uploading media in the client instead.

Langfuse's answer is a media reference: upload the bytes once, put a short token
where the payload was. That is three calls over the same public wire API the
rest of this package speaks, so there is still no Langfuse SDK here:

```ts
import { langfuseMedia } from 'autotel-langfuse';

const media = langfuseMedia({ baseUrl, publicKey, secretKey });

const messages = await media.replaceDataUris(JSON.stringify(input), {
  traceId,
  field: 'input',
});
span.setAttribute('gen_ai.input.messages', messages);
```

`replaceDataUris` works on the serialised messages directly, because a `data:`
URI survives `JSON.stringify` unchanged: there is no message tree to walk and
nothing to keep in step when the message shape changes. It uploads each distinct
payload once, leaves a string holding no media untouched, and `upload()` is
there for the case where you already have the bytes.

**This cannot be a span processor, and that is a property of the problem rather
than a shortcut.** A processor's `onEnd` is synchronous and the span exports
immediately after it, so there is nowhere to await an upload that has to finish
before the attribute is written. The `mediaId` is assigned by Langfuse, not
derivable from the content, so it cannot be filled in optimistically either. The
replacement belongs in application code, before the attribute is set.

## Staying in step with Langfuse

Every line of this package is a bet about names: which attributes Langfuse reads
on the way in, and which fields it stores on the way out. Unit tests cannot
check that bet, because they only prove we emit what we meant to emit, which is
worth nothing if the name changed upstream.

So the package ships a contract test that asks a real Langfuse:

```bash
docker compose -f docker/langfuse.yml up -d
pnpm --filter autotel-langfuse test:contract
```

It sends spans through the processor into `/api/public/otel`, posts a score
through the bridge, uploads a media payload, and reads all three back through
**public API surfaces only**, never through ClickHouse:

- `GET /api/public/v2/metrics` names every field this package maps as a
  queryable dimension, and **rejects a query naming a dimension it does not
  have**. A rename or removal upstream fails the suite by name, rather than
  quietly emptying a column that nobody notices for months.
- `GET /api/public/v3/scores` returns the score the bridge posted.
- `GET /api/public/media/{id}` returns the uploaded payload, which is the only
  proof the presigned `PUT` actually landed.
- Where the entity endpoints exist, `GET /api/public/observations` returns the
  observation body, so the suite can assert that input and output survived a
  span that also named its prompt. That one is skipped by name on `events_only`
  deployments rather than passing quietly.

It runs against Langfuse Cloud too:

```bash
LANGFUSE_BASE_URL=https://cloud.langfuse.com \
LANGFUSE_PUBLIC_KEY=pk-lf-... LANGFUSE_SECRET_KEY=sk-lf-... \
pnpm --filter autotel-langfuse test:contract
```

Nightly CI runs it against the self-hosted stack
(`.github/workflows/langfuse-contract.yml`), and on pull requests that touch the
mapping. It is not part of the main CI gate yet: it needs six containers and a
couple of minutes to boot them, and a young suite that blocks every pull request
teaches people to re-run a red build rather than read it.

That is the whole anti-drift mechanism, and it is why the dependency list is
what it is. A wire contract a test can hold to is a smaller thing to keep in
step than an SDK's release cadence, which is also why the scores bridge speaks
HTTP rather than importing `@langfuse/client`.

`pnpm test` skips the contract suite, so the normal unit run needs no Docker.
Set `LANGFUSE_BASE_URL` (or `LANGFUSE_BASEURL`), `LANGFUSE_PUBLIC_KEY`, and
`LANGFUSE_SECRET_KEY` to point it at Langfuse Cloud instead.

## Verified against

Langfuse v4 self-hosted (`docker/langfuse.yml` in this repo) **and Langfuse
Cloud**, by running the contract suite against both. The repo's
[`example-langfuse`](../../apps/example-langfuse) app is the end-to-end case:
four traces, typed observations, user and session scoping, tags, prompt linking,
and time to first token, with no Langfuse package installed.

The two deployments do not offer the same read surface, which matters more than
it sounds when a test or a dashboard comes back empty:

|                                                  | v4 self-hosted           | Langfuse Cloud                 |
| ------------------------------------------------ | ------------------------ | ------------------------------ |
| `/api/public/traces`, `/api/public/observations` | 404 (`events_only` mode) | served, 15 requests/minute     |
| `GET /api/public/v2/metrics`                     | the only read surface    | served, **100 requests a day** |
| `/api/public/v3/scores`                          | served                   | served                         |
| OTLP ingest, scores, media                       | identical                | identical                      |

Everything this package _writes_ behaves the same on both. Three further things
worth knowing, all found by running against the real thing:

- High-cardinality dimensions such as `userId` require `config.row_limit` and an
  `orderBy` on a measure, or the metrics query 400s. The contract test sends both.
- Prompt linking resolves by name **and** version. Naming a version the project
  does not have leaves `promptName` null, which looks exactly like a broken
  mapping and is not one.
- Cloud's rate limits are low enough that a naive polling loop exhausts the daily
  metrics quota in one run, and then reports the 429 as a missing row. The
  contract suite reads back once and waits out a 429 rather than racing it.

## Install

```bash
npm install autotel-langfuse
```

Peer: `@opentelemetry/sdk-trace-base >= 2`. Runtime dependency:
`@opentelemetry/api`. That is the entire dependency list, on purpose.
