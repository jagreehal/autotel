# autotel-schema

## 1.0.0

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 0.2.0

### Minor Changes

- 4cd08bf: Add **`autotel-schema`**, a typed, versioned contract for your telemetry surface.
  With `autotel-pact` (evidence that contracted interactions actually ran) it forms
  autotel's core observability-contract pair. Both use telemetry to answer a
  contract question. `autotel-schema` is the telemetry contract you emit (span
  names + attributes).

  When the main reader of your telemetry is an agent, your span names and
  attribute keys are a public API. This package makes that surface explicit,
  typed, and versionable. The contract model is dependency-free, with no
  OpenTelemetry SDK required (the processor uses structural span types).
  - `defineContract({ service, version, spans, commonAttributes })`: declare the
    spans/attributes your service emits; validated and frozen at load.
  - `validateSpan(span, contract)` and `createSchemaValidationProcessor({ contract, mode })`:
    validate live spans (`missing_required`, `type_mismatch`, `enum_violation`,
    `unknown_attribute` with "did you mean?", `unknown_span`). Fail-open; bounded,
    deduped warnings; off in production unless opted in.
  - `contractToSnapshot`, `serializeSnapshot`, `diffSnapshots`, `hasBreakingChanges`,
    and the `autotel-schema` CLI (`diff` / `check`): gate breaking trace-surface
    changes in CI.
  - `highCardinalityKeys(contract)`: feed a redaction allow-list so the
    high-cardinality fields an agent reader needs survive.
