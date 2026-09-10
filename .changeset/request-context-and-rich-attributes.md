---
'autotel': minor
'autotel-web': minor
'autotel-genai': minor
---

Instrument a request from anywhere in it, with values as rich as the data.

- **`requestCtx`** is the ambient `ctx` aimed at the **request** span, for
  context that describes the whole request — the authenticated user, the tenant,
  the plan — set from a shared middleware. `ctx` keeps pointing at the span the
  code is in, so both are available at once. Outside a request it falls back to
  the active span, and with nothing active the methods no-op, so the same call
  runs under `vitest` and under a plain `node server.js`.

  ```typescript
  app.use((req, _res, next) => {
    requestCtx.setAttributes({ user: req.user }); // on GET /users/:id
    ctx.setAttribute('auth.cache_hit', cached); // on the middleware's own span
    next();
  });
  ```

- **Attribute values may be objects, `Map`s, `Set`s and `Date`s.**
  `ctx.setAttribute('user', user)` records `user.id`, `user.plan`, … — the
  dot-notation rule the request logger and structured errors already follow, so
  nothing needs flattening by hand. Conversion is total: a value that cannot be
  represented is recorded as a marker rather than raised at the call site.

- **Express layer spans are ignored by default**
  (`ignoreLayersType: ['middleware', 'request_handler']`), so `ctx` inside a
  middleware already means the request and a pile of noise spans goes away with
  it. `express: { ignoreLayersType: [] }` asks for per-middleware timing back.

- **`autoInstrumentations` takes per-instrumentation options**, and expands short
  names to package names, so `{ express: { ignoreLayersType: [] } }` reaches the
  instrumentation's own constructor.

- **`autotel-web` never traces or propagates to the configured OTLP paths**, so
  reading the telemetry never becomes telemetry. `collectorOwnsOrigin: true`
  extends that to the collector's whole origin, for one that serves its UI and
  query API beside `/v1/traces`.

- **`autotel-genai` records `gen_ai.system_instructions` from the AI SDK's
  standardized prompt**, in each shape `instructions` allows, through both the
  `Telemetry` integration and the tracing channel, under the existing
  content-capture gate.

- **`registerModelPricing()`** registers prices process-wide, for models the
  built-in table cannot know, and `gen_ai.usage.cost.unpriced_model` names a
  model whose cost could not be priced.
