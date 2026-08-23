# autotel-posthog — improvement log

Findings from verifying the package end to end against a real PostHog project
(`apps/example-posthog`, project 571771). Fixed items are here for the reasoning;
open items are ranked by how much DX they cost.

## Fixed

### `$trace_id` never reached events captured after an `await`

The browser has no `AsyncLocalStorage`. `context.active()` is back to root by
the time a fetch resolves, and that is where analytics events actually fire.
`autotelBeforeSend` found no span and returned the event untouched — silently,
which is the worst version: the wiring looks correct and the join produces
nothing. Verified in PostHog: `checkout_failed` at 21:49 had `$trace_id` null;
after the fix, 21:57 carried the full trace, span and URL.

`joinPostHog` now keeps the spans it has seen start and not end, and
`autotelBeforeSend` takes a `fallbackSpanContext`. Bounded at 128 so spans that
never end (SPA navigating away mid-span) cannot accumulate.

### `init({ baggage: '' })` was a no-op — in `autotel`, not here

Documented as "copy baggage onto spans with no prefix", guarded on truthiness,
so the empty string disabled the processor. The inner ternary already handled
`''`, unreachable. This is why `session.id` never landed on server spans even
though the `baggage` header arrived correctly.

### Silence when the join cannot work

Every failure mode was quiet: PostHog not loaded, the session rotated mid-span,
replay not recording. Right for production, and indistinguishable from success
in the five minutes someone spends wiring it up — which is how both bugs above
survived a green test suite.

`debug: true` on `joinPostHog()` / `posthogCompatibility()` now explains each
exit once per reason, naming what to check. This also covers the old item 2:
"no replay link" now distinguishes no-posthog, session-rotated and
not-recording instead of all three being an absent attribute.

### Bot filtering blocks end-to-end tests

`posthog-js` drops headless Chrome **before** `before_send` runs, so an
automated browser sees no events and no stamping, with no error. Now documented
with a recipe in the package README, the docs callouts and the example README.
Note PostHog still classifies that traffic as a bot server-side (`$virt_is_bot`),
so keep it out of production analysis.

### Wrong-trace attribution when two actions overlap

The `await` fallback picked the most recent live span. The note said the worst
case was a wrong span in the same trace — that was wrong. `span()` with no
active parent starts a **root** span, so two overlapping user actions are two
different traces, and the fallback could name an unrelated request.

Fixed without Zone.js by refusing to guess: the fallback answers only while
every live span shares one trace. Nesting (a parent and its child fetch span)
is unaffected because they share a trace; genuinely concurrent actions get no
property rather than a wrong one, and `debug` says why. Callers who need it
anyway can read the ids while the span is active and pass them on the capture —
a property the caller set is never overwritten.

Anything better needs context propagation across `await`, which in a browser
means patching the promise chain. That is Zone.js by another name, so it stays
out.

### No regression guard

Both original bugs shipped green because the example used a PostHog stub and
the unit suites used hand-written doubles that agreed with each other — and in
Node, an `AsyncLocalStorageContextManager` that keeps the active span alive
across `await`, hiding the exact failure the browser has.

Two layers now:

- `src/browser-integration.test.ts` — a real `posthog-js`, a real tracer and
  `StackContextManager`, exercising capture-after-await. No secrets, no
  network, runs on every CI run. Verified to fail when the fallback is removed.
- `apps/example-posthog/smoke.mjs` (`pnpm --filter … smoke`) — the full live
  round trip against a real project: `$trace_id` on the event, `session.id` on
  the server span via baggage, a replay link that deep-links to the failure.
  Skips green without `POSTHOG_KEY`. Wired into `.github/workflows/posthog-smoke.yml`,
  nightly plus path-scoped on pull requests.

### The DX of the case it refuses

Refusing to guess is correct but was only half a design: the developer found
out from an opt-in flag they had no reason to switch on, and the fix was a
paragraph about OpenTelemetry context. Three changes:

- `debug` defaults on in development, off in production — the React/Redux
  convention. A diagnostic nobody switches on is a diagnostic nobody reads.
- `traceProperties()` makes the fix a spread rather than an explanation.
- The warning names `traceProperties()`, so the console says what to do.

Explicit ids now also earn their `$trace_url`, so taking the escape hatch costs
nothing.

## Open

Nothing outstanding. Two things to keep in mind rather than fix:

- **Overlapping actions still get no automatic `$trace_id`.** That is the
  deliberate trade, and it is now self-announcing with a one-line fix. If it
  turns out to be common in a real app, the answer is `traceProperties()` at
  the call site, not loosening the rule.
- **The smoke test writes real events.** Point `POSTHOG_KEY` at a throwaway
  project, not production analytics.
