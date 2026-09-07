# autotel-effect

## 4.0.0

### Major Changes

- 3926832: Draw the event catalog by what the runtime actually did, and bridge Effect logs.

  **`autotel-eventcatalog`** gains a `map` command that renders the catalog topology as one self-contained HTML file, with every edge labelled by the evidence behind it:

  ```bash
  autotel-eventcatalog map --snapshot snap.json --catalog ./catalog --output map.html
  ```

  - **observed** — a real `track()` call crossed it, stroke weight scaled to volume
  - **declared, never seen** — the catalog says it happens and this run never saw it
  - **ran, not in the catalog** — it happened and nobody wrote it down
  - **consumer asserted** — the event fired; its delivery is a claim from the catalog

  Three modes: `static` (commit it and read it in a PR), `replay` (markers move at a rate drawn from observed counts), and `live` (`--live-url`, and a marker crosses an edge the moment that event fires). Motion is reserved for evidence, so a declared-but-never-seen edge stays still in every mode.

  The map and the drift report pair a rename together as one finding, while still listing both sides. `buildLiveMap()` and `renderLiveMapHtml()` are exported for building your own view, and `normaliseEventId()` is now public so callers can match dotted `track()` names to PascalCase catalog ids the same way the drift report does. The live page is covered by browser tests (`pnpm test:browser`) driving the real artifact in Chromium.

  **`autotel-subscribers`**: `ArchitectureSnapshotSubscriber` now records `sources` on each observation — one entry per distinct `(producer, channel)` pair, with that pair's own count and first/last-seen — so two services publishing the same event name each keep their own traffic. Additive and sorted, so existing readers are unaffected and a committed snapshot stays byte-stable.

  **`autotel-effect`**: `layer()` now bridges logs as well as spans, from the same single call.

  ```typescript
  const AutotelEffect = layer({ serviceName: 'my-api' }); // spans + logs
  ```

  `Effect.log*` is emitted as an OpenTelemetry log record — reaching any OTLP log backend, autotel-devtools included — plus a trace-correlated structured line on stdout, so a log written inside `Effect.withSpan` carries that span's trace and span ids. `Effect.annotateLogs` values become attributes, and an `Error` or `Cause` is reported as `err` with its stack.

  **Breaking:** `Effect.log*` previously went to Effect's console logger and stayed there. Pass `logs: false` to keep `layer()` bridging spans only, or an options object (`level`, `pretty`, `mergeWithExisting`, `console`) to configure the logger. `loggerLayer()` is exported for the case where something else owns the tracer.

## 3.0.0

### Patch Changes

- Updated dependencies [10c3f93]
  - autotel@7.6.0

## 2.0.0

### Patch Changes

- Updated dependencies [a271e71]
  - autotel@7.5.0

## 1.0.0

### Minor Changes

- 29546bf: New package: bridge autotel and Effect v4.

  `layer({ serviceName })` provides Effect's `Tracer` from the global
  OpenTelemetry provider that `autotel.init()` registers, so `Effect.withSpan`
  spans export through autotel and nest under its HTTP and fetch spans. Wraps
  `@effect/opentelemetry`'s `OtelTracer.layerGlobal` with the `Resource` it
  requires — the wiring every Effect app was otherwise copying, including the v4
  subpath imports and the `--import` init ordering.

  Effect v4 only; autotel owns export, `@effect/opentelemetry` owns the tracer.

### Patch Changes

- Updated dependencies [29546bf]
  - autotel@7.4.0
