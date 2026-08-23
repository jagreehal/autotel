# autotel-posthog

## 1.1.0

### Minor Changes

- 4c859aa: Join PostHog sessions to traces in both directions, and make the join work in a
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

### Patch Changes

- Updated dependencies [4c859aa]
  - autotel-web@1.13.1
  - autotel@7.0.1
  - autotel-subscribers@50.0.1

## 1.0.0

### Minor Changes

- d303348: ## `trace` wraps, `trace.run` runs

  Reaching the span from inside a traced function is back, and nothing about the
  existing `trace()` forms changed to make room for it.

  Every `trace(...)` form returns a **wrapper** and executes nothing, exactly as
  before. `trace.run(...)` is the new immediate form:

  | Call                        | Returns                | Use for                          |
  | --------------------------- | ---------------------- | -------------------------------- |
  | `trace(fn)`                 | wrapper, name inferred | a reusable function              |
  | `trace(name, fn)`           | wrapper, name explicit | a reusable function, stable name |
  | `trace(name)(fn)`           | wrapper, curried       | one config applied to many fns   |
  | `trace.run(name, ctx => r)` | the operation's result | one operation, run right here    |

  ```ts
  // unchanged
  export const createUser = trace('user.create', async (data: NewUser) => {
    return db.users.create(data);
  });

  // new
  const user = await trace.run('user.create', async (ctx) => {
    ctx.setAttribute('user.id', input.id);
    return db.users.create(input);
  });
  ```

  **This is additive. No `trace()` call changes meaning, so there is nothing to
  migrate.** An earlier draft of this change overloaded `trace(name, fn)` to run
  immediately, which would have turned every existing wrapper into a call that
  fires once at import with `data` bound to a `TraceContext` - a break that
  compiles clean and surfaces far from its cause. Keeping the immediate form
  under its own name avoids it entirely.

  Two names also means no call shape is ambiguous, so nothing inspects a
  callback's parameter name to decide what to do. That heuristic is what
  [#166](https://github.com/jagreehal/autotel/issues/166) removed after esbuild
  renamed `ctx` to a single letter, `trace()` fell into the wrong mode, and
  deployed Lambdas crashed handing the runtime a function to serialise. The
  `markAsImmediate()` escape hatch it needed is gone with it.

  `trace(name)` with a single argument returns a wrapper factory, for applying
  one configuration to several functions. `instrument({ key, fn })` remains the
  options form, and `withTracing({ name })(ctx => fn)` the reusable context
  factory. An explicit `ctx.setStatus()` is no longer overwritten by the
  automatic OK, and core `autotel` exposes its baggage helpers on the context.

  `autotel-edge` carries the identical shape, so a call means the same thing on
  both runtimes. Both packages pin it with a regression test asserting that no
  `trace(...)` form runs its function, whatever the parameter is called.

  ### Reaching the span: prefer the ambient `ctx`

  `trace.run`'s context parameter is for when an explicit binding reads better -
  it is not the only way in, and usually not the best one:

  ```ts
  import { trace, ctx } from 'autotel';

  export const createUser = trace('user.create', async (data: NewUser) => {
    ctx.setAttribute('user.id', data.id);
    return db.users.create(data);
  });
  ```

  The ambient `ctx` resolves to the active span at any depth, so a helper several
  frames inside a traced body sees the same span without being handed anything -
  which a context parameter cannot do without being threaded through every call.

  ## Telemetry surfaces carry their own types

  **Breaking:** several public types stop being open dictionaries and name what
  they actually hold.

  - `EventAttributes` values are `EventAttributeValue` - a JSON-serializable
    value - instead of `unknown`. The type always documented this; now it says so.
  - `autotel-schema`'s `SpanShape` is `EmittedSpan`, with attributes typed as
    `Record<string, EmittedAttributeValue>`. `EmittedAttributeValue` is exported
    alongside it: a string, number, boolean, null, or an array of those.
  - Attribute bags across `autotel` - the builders, `mergeAttrs`,
    `safeSetAttributes`, `validateAttribute`, `autoRedactPII` - are OTel's own
    `Attributes` rather than `Record<string, unknown>`.
  - `SentryLinkable`'s event processor is typed against a named `SentryEvent`,
    and `contexts.trace` against `SentryTraceContext`.
  - `traceConsumer` is generic over the message it consumes, so the extractors
    you give it receive your own type instead of `unknown`. `subscribeChannel`
    and `subscribeTracingChannel` are likewise generic in their message.
  - `autotel-cloudflare`'s `instrumentBindings` takes and returns `WorkerEnv`
    (`Record<string, unknown>`) rather than `Record<string, any>`. Reading a
    binding off the result now needs a narrowing step that `any` used to skip.
    `ActorConstructor`'s `env` parameter is `Record<string, unknown>` rather than
    `unknown`, and the type now also carries the class `name` the instrumentation
    reads.
  - `autotel-audit`'s `SUSPICIOUS_REQUEST_PATTERNS` is the shape of the object it
    actually is, not `Record<string, RegExp>`, so its keys are known. Indexing it
    with an arbitrary string no longer type-checks.
  - New exported names for shapes that were previously anonymous:
    `FlatAttributes`, `FlatMetadata`, `CorrelatedAttributes`, `BaggageFieldValue`,
    `YamlValue` / `YamlMapping`, `InstrumentationSwitches`, `TraceDecorator`,
    `WithTraceContext`, and `ImagesLike` in `autotel-cloudflare`.

  **Breaking:** `autotel-edge`'s `toAttributeValue` drops non-finite numbers
  instead of emitting them. OTLP cannot encode `NaN` or `Infinity`, and
  `JSON.stringify` renders both as the string `"null"` - an attribute claiming to
  hold null. The key is now omitted, and one `NaN` likewise stops an array being
  sent as numbers.

  ## PostHog is one package

  **Breaking:** `PostHogSubscriber` moves out of `autotel-subscribers` into
  `autotel-posthog`, which is now the join between autotel traces and PostHog in
  both directions. `autotel-subscribers/posthog` and the root re-export are gone.

  ## Also
  - `session.id` propagation and exception fingerprinting across `autotel`,
    `autotel-web`, `autotel-mcp`, `autotel-cli` and `autotel-devtools`.
  - `TelemetryOptions` accepts an `outbox`, so a tool can queue pending runs
    somewhere other than a file under the telemetry directory, and a test can
    watch what a run appended without mocking the module. Exported as `OutboxLike`.

### Patch Changes

- Updated dependencies [d303348]
  - autotel@7.0.0
  - autotel-subscribers@50.0.0
