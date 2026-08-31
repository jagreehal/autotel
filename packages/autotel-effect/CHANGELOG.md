# autotel-effect

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
