# autotel-langfuse (Langfuse compatibility)

Langfuse is a **destination, not an integration**. It ingests plain OTLP and reads the canonical `gen_ai.*` semantic conventions, so an autotel span tree already arrives as generations, embeddings, agents and tools from nothing but a `destinations` entry. This package fills in the handful of facts Langfuse keeps in dedicated columns and reads from its own `langfuse.*` attributes, which no OpenTelemetry convention covers.

## Your Role

You are working on the Langfuse compatibility package. You understand the OpenTelemetry GenAI semantic conventions, Langfuse's OTLP attribute contract, span processor composition (`onEnd` ordering, the enricher-vs-processor distinction in autotel's `init()`), and Langfuse's public wire APIs for scores and media.

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsdown
- **Testing**: vitest
- **Key Dependencies**:
  - `@opentelemetry/api` — the only runtime dependency
  - `@opentelemetry/sdk-trace-base` >= 2 — peer dependency

**No Langfuse package is a dependency, and that is the point.** A wire contract a test can hold to is a smaller thing to keep in step than an SDK's release cadence. Adding `@langfuse/tracing`, `@langfuse/otel` or `@langfuse/client` would undo the main claim this package makes.

## Key Concepts

- **`langfuseCompatibility(options)`** — a span processor that adds Langfuse-only attributes on the way out: trace name, tags, release, version, public, completion start time, prompt link.
- **Enricher, not processor.** It belongs in `init({ spanEnrichers })`. `spanProcessors` _replaces_ the pipeline autotel builds, so passing it there silently switches off the destinations that were just configured.
- **Prompt attributes are moved, not copied.** Langfuse reads anything under the `gen_ai.prompt` prefix as the legacy prompt-content convention, and once it finds one it takes input and output from that convention alone — so the observation's input becomes `{"name": ..., "version": ...}` and its output becomes `{}`. `gen_ai.input.messages` and `gen_ai.output.messages` are discarded entirely. The processor therefore deletes `gen_ai.prompt.name` / `gen_ai.prompt.version` after mapping them, which means they are gone from _every_ destination, not just Langfuse.
- **`langfuseScores(options)`** — an autotel event subscriber that turns `gen_ai.evaluation.result` into a Langfuse score over `POST /api/public/scores`. Scores are the one thing OTLP cannot carry. A failed score never throws into the operation that produced it.
- **`langfuseMedia(options)`** — uploads base64 payloads and returns the media reference token that stands in for them. Cannot be a span processor: `onEnd` is synchronous, the span exports immediately after it, and the `mediaId` is assigned by Langfuse rather than derivable from the content.
- **Masking and filtering are autotel's, not this package's.** `init({ attributeRedactor })` masks values before export; `init({ spanFilter })` drops spans. Neither needs a Langfuse-specific equivalent.

## Entry Points

Single entry point with tree-shakeable exports:

- `autotel-langfuse`: `langfuseCompatibility`, `LANGFUSE`, `langfuseScores`, `toScorePayload`, `GEN_AI_EVALUATION_RESULT`, `langfuseMedia`, `mediaToken`

## Commands

```bash
# In packages/autotel-langfuse directory
pnpm test               # Unit tests (37 tests; the contract suite skips)
pnpm test:contract      # Contract suite against a real Langfuse
pnpm build              # Build package
pnpm lint               # Lint package
pnpm type-check         # TypeScript type checking
```

The contract suite needs a Langfuse. Self-hosted:

```bash
docker compose -f docker/langfuse.yml up -d   # keys are pre-provisioned
pnpm --filter autotel-langfuse test:contract
```

Or Langfuse Cloud, via `LANGFUSE_BASE_URL` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`.

## File Structure

```
src/
├── index.ts           — langfuseCompatibility, the LANGFUSE attribute names, re-exports
├── index.test.ts      — 15 tests
├── scores.ts          — langfuseScores subscriber, toScorePayload
├── scores.test.ts     — 13 tests
├── media.ts           — langfuseMedia upload and data-URI replacement
├── media.test.ts      — 7 tests
└── contract.test.ts   — 6 tests against a real Langfuse, gated on LANGFUSE_CONTRACT=1
```

## Code Patterns

### Filling a field only when the span has not answered it (index.ts)

Options are process-wide defaults. A span that set the attribute itself knows something the configuration does not:

```typescript
const fill = (key: string, value: unknown): void => {
  if (value !== undefined && attributes[key] === undefined) {
    attributes[key] = value;
  }
};
```

### Speaking the wire API rather than an SDK (scores.ts, media.ts)

Basic auth built from the key pair, `fetch` injectable for tests, and no Langfuse import:

```typescript
const authorization = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;
const doFetch = options.fetch ?? globalThis.fetch;
```

### Error posture differs by call site

`langfuseScores` swallows and reports: a score must never take down the run that produced it. `langfuseMedia` rejects: the caller awaits it and needs the token to build the attribute, so a silent failure would return a reference to nothing.

## Boundaries

- Always do: verify a mapping against a real Langfuse before claiming it, keep the dependency list at `@opentelemetry/api`, add a contract-test assertion for every new field this package maps, spell out canonical attribute names as string constants rather than importing them from `autotel-genai`
- Ask first: deleting or rewriting any attribute other than the `gen_ai.prompt.*` pair (an enricher is global, so a deletion reaches every destination), adding new exports
- Never do: depend on a `@langfuse/*` package, read ClickHouse in tests, register a TracerProvider, document `spanProcessors` as the way to install the enricher

## Testing

- **Unit tests**: `index.test.ts` (processor behaviour, including the regression that the `gen_ai.prompt.*` pair is removed so input and output survive), `scores.test.ts` (payload mapping, error posture), `media.test.ts` (the three-call upload dance against a fake Langfuse, data-URI replacement, dedupe)
- **Contract tests**: `contract.test.ts`, gated on `LANGFUSE_CONTRACT=1`. Asserts through public API surfaces only, never ClickHouse.
- Inject `fetch` rather than mocking the module; assert on the recorded calls, because the wire sequence is the part this package does not own

## Deployment Differences That Break Tests

Both were found by running against the real thing, and both look like bugs in the mapping when they are not:

|                                                  | v4 self-hosted           | Langfuse Cloud                 |
| ------------------------------------------------ | ------------------------ | ------------------------------ |
| `/api/public/traces`, `/api/public/observations` | 404 (`events_only` mode) | served, 15 requests/minute     |
| `GET /api/public/v2/metrics`                     | the only read surface    | served, **100 requests a day** |
| `/api/public/v3/scores`                          | served                   | served                         |

The contract suite reads through the entity endpoints where they exist and metrics where they do not, waits out a 429 rather than racing it, and reads back once in `beforeAll` rather than polling per test. A polling loop against Cloud spends the daily metrics quota in a single run and then reports the 429 as a missing row.

Prompt linking resolves by name **and version**: naming a version that does not exist in the project leaves `promptName` null, which looks identical to a broken mapping. The contract suite creates the managed prompt it references.

## References

- [Langfuse OpenTelemetry docs](https://langfuse.com/integrations/native/opentelemetry): the attribute contract this package targets
- [Langfuse API reference](https://api.reference.langfuse.com/): scores, media and metrics endpoints
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/): the `gen_ai.*` names everything here is built on
