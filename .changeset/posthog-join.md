---
'autotel-posthog': minor
'autotel-web': patch
'autotel-genai': patch
'autotel': patch
---

Join PostHog sessions to traces in both directions, and make the join work in a
real browser.

`joinPostHog()` wires PostHog's `before_send` half and returns the span enricher,
so one call covers both directions: spans carry `session.id`, `user.id` and a
timestamped `session.replay.url`; PostHog events carry `$trace_id`, `$span_id`
and `$trace_url`; and the session id rides W3C baggage to the server span.

Verified end to end against a live project — which is how the rest of this list
was found. `apps/example-posthog` now runs against a real PostHog when
`POSTHOG_KEY` is set, with a smoke test wired into CI.

**autotel-posthog**

- Events captured after an `await` now carry the trace. The browser has no
  `AsyncLocalStorage`, so the active context is gone by the time a fetch
  resolves — which is exactly when the events worth joining fire. The processor
  falls back to the spans it has seen start and not end, bounded so leaked spans
  cannot accumulate, and refuses when more than one trace is in flight rather
  than naming an unrelated request.
- `traceProperties()` spreads the current ids onto a capture for the case the
  fallback cannot resolve. Caller-set ids win, and still earn their
  `$trace_url`.
- `debug` explains every quiet exit — no usable PostHog, a rotated session,
  replay not recording — once per reason. On by default in development, silent
  in production.
- `session.id` reaches baggage during `joinPostHog()`, not on the first span, so
  the page's first request carries it too.
- Repeated calls (strict mode, HMR) no longer break the fallback or accumulate
  state.
- `autotel-web` is a required peer of the root entry, which imports
  `autotel-web/baggage`.

**autotel-web** — full-mode baggage now honours `privacy` (`blockedOrigins`,
`respectDoNotTrack`, `respectGPC`), matching lean mode; previously only the
destination allowlist applied. It also survives `fetch(request, init)` when
`init.headers` is set, which used to discard the injected header.

**autotel** — `init({ baggage: '' })` is a prefix ("copy baggage on, unprefixed"),
not an off switch. The guard was truthiness, so the empty string silently
disabled the processor and `session.id` never landed on server spans.

**autotel-genai** — `autotelTelemetry()` covers `generateObject`/`streamObject`
and live embedding duration, and stamps `user.id` / `gen_ai.conversation.id` from
`runtimeContext`. Structured output now honours the per-call `recordOutputs`,
which only the language-model and tool handlers checked. Abandoned embedding
attempts are reported as errors instead of healthy spans — the SDK announces an
attempt that succeeded and says nothing about one that threw. For `embed()`, and
for any retry that reuses an attempt id, the failed attempt is closed when its
replacement starts; under `embedMany()` the events carry no batch identity, so
its duration is an honest upper bound rather than a guess that would truncate a
concurrent batch.
