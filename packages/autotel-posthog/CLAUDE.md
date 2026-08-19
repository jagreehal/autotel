# autotel-posthog (PostHog join)

PostHog is both a destination and a browser SDK, and the useful thing is the join between them: a trace that knows which recorded session it happened in, and a PostHog event that knows which trace explains it.

## Your Role

You are working on the PostHog join package. You understand PostHog's browser API surface (`get_session_id`, `get_distinct_id`, `get_session_replay_url`, `getFeatureFlag`, `before_send`), OpenTelemetry span processor composition, and the three states a page's PostHog instance can be in.

## Tech Stack

- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsdown
- **Testing**: vitest
- **Key Dependencies**:
  - `@opentelemetry/api` — the only runtime dependency
  - `@opentelemetry/sdk-trace-base` >= 2 — peer dependency

**`posthog-js` is a required peer dependency and the source of the types.** `src/posthog-like.ts` derives its surface with `Partial<Pick<PostHog, ...>>` from `posthog-js` itself, so a renamed method or changed signature is a compile error here rather than an `undefined` read in someone's browser. `src/contract.test.ts` holds it to that at runtime too, against the pinned dev copy.

Peer, not a bundled dependency: two copies of `posthog-js` on one page means two `sessionManager`s and two different answers to `get_session_id()`, which would break the very thing this package exists to join. `posthog-node` is an optional peer, needed only by the subscriber entry.

`Partial` is the deliberate loosening — the type is what PostHog says it is, the optionality is about _when_ it is. A page is in one of three states and only the last answers questions: no posthog, the loader snippet's array stub, or the loaded library (which still returns an empty session id until it finishes initializing).

## Layout

- `src/` — the browser join. Zero runtime deps beyond `@opentelemetry/api`, so a bundler pulls nothing else in.
- `src/subscriber/` — `PostHogSubscriber`, exported as `autotel-posthog/subscriber`. Node-side; extends `EventSubscriber` from `autotel-subscribers` and uses `slow-redact` and `posthog-node`. Kept behind its own entry point so the browser build never sees it.

## Key Concepts

- **`joinPostHog(posthog, options)`** — the canonical entry. Wires the `before_send` half via `set_config` and returns the enricher, so one call covers both directions. Appends to any existing chain and is idempotent.
- **`posthogCompatibility(options)`** — span enricher. Identity (`session.id`, `user.id`, named `feature_flag.*`) is stamped in **`onStart`**, because it is a fact about when the operation ran — sessions rotate and `identify()` lands mid-request. `onEnd` decides only `session.replay.url`, since only the end knows the span failed, and withholds it if the session rotated in between.
- **Enricher, not processor.** It belongs in `initFull({ spanEnrichers })`. `spanProcessor` _replaces_ the pipeline, so passing it there silently switches off the export.
- **`autotelBeforeSend()`** — PostHog `before_send` hook adding `$trace_id` / `$span_id`. Property names match what `autotel-subscribers`' PostHog subscriber writes server-side, so one set of names covers both sides.
- **`posthogSessionId`** — for the minimal `autotel-web` build, which has no processor pipeline. Plugs into `init({ session: { id } })`.
- **`joinPostHog(posthog)`** — wires the `before_send` half via `set_config` and returns the enricher, so one call covers both directions. Appends to any existing chain, and is idempotent: framework code runs more than once and a chain that grows per render stamps properties repeatedly.
- **`PostHogSubscriber`** (`autotel-posthog/subscriber`) — server-side product events, writing the same `$trace_id` / `$span_id` names the browser hook does.

## Boundaries

- ✅ **Always do**: guard every PostHog call (`typeof fn === 'function'` plus try/catch), treat an empty-string session id as absent, keep the structural type optional-by-default
- ⚠️ **Ask first**: adding attributes outside `session.*`, `user.*` and `feature_flag.*`; changing which attributes overwrite versus fill
- 🚫 **Never do**: import `posthog-js` _values_ (types only — a bundled copy breaks the session join), let the subscriber entry leak into the browser entry, harvest all feature flags, put a replay URL on healthy spans or on a session with no recording, revive a `before_send` event that arrived as `null`

## Recording detection

`sessionRecordingStarted()` is the public contract and the thing to read. The `sessionRecording.started` property is a pre-method fallback and is **not** in PostHog's public type — read it defensively, never prefer it.

## Precedence

`session.id` is **assigned** — PostHog's id outranks the one autotel-web mints, because it is the one the replay and person profile are keyed on. Everything else is **filled** — never overwritten, because a span that set an attribute knows something this package does not.
