# CLAUDE.md: autotel-schema

Your telemetry surface (span names + attributes) as a typed, versioned contract: declare it, validate live spans against it, diff it across commits for breaking changes, and protect high-cardinality keys from redaction.

> **Provenance:** this package's `src/` was recovered verbatim from its own committed `dist/` sourcemaps (it had been built but never committed). The implementation is original; packaging (configs, tests, docs) was added when completing it. If something looks unusually polished, that's why.

## Portfolio frame: "Autotel governs the observable contracts at each boundary"

Core observability-contract pair (both answer a contract question using telemetry):

| Package | What it contracts |
|---------|-------------------|
| **`autotel-schema`** (this) | the telemetry contract you emit (span names + attributes) |
| `autotel-pact` | evidence that contracted (Pact) interactions actually ran |

Optional adjacent (standalone, test-time, needs no runtime observability):

| Package | What it contracts |
|---------|-------------------|
| `autotel-message-contract` | serialized payload compatibility across versions |

## Design invariants

- **Dependency-free contract model.** `contract.ts` / `snapshot.ts` / `diff.ts` / `validate.ts` / `redaction.ts` import nothing but `node:*`. No `@opentelemetry/*` import anywhere. The processor uses structural `SpanProcessorLike` / `ReadableSpanLike` types so it works against any OTel SDK without depending on one. Keep it that way.
- **Fail-open processor.** `SchemaValidationSpanProcessor.onEnd` must never throw from validation itself (wrapped in try/catch); only `mode: 'throw'` propagates, and that path is outside the guard. Bounded + deduped warnings (`warnIntervalMs`). Disabled when `NODE_ENV==='production'` unless `enabledInProduction`.
- **Deterministic snapshots.** `contractToSnapshot` sorts all keys so two snapshots of the same logical contract are byte-identical, for clean git diffs and stable CI. `serializeSnapshot` ends with a trailing newline. `SNAPSHOT_SPEC = 'autotel-schema-snapshot/v1'`; `parseSnapshot` rejects other specs.
- **Breaking vs additive.** `diffSnapshots` classifies: removed span/attr, tightened type, narrowed enum, newly-required → `breaking`; added span/attr, widened enum → `additive`. CI gates on `hasBreakingChanges`.

## Source map (`src/`)

- `attrs.ts`: `SCHEMA_ATTRS` resource-attribute keys + `SNAPSHOT_SPEC`.
- `contract.ts`: `defineContract` (validates + freezes), `TelemetryContract`/`SpanSpec`/`AttributeSpec`, `resolveAttributeSpec`, `allowsAdditionalAttributes`.
- `validate.ts`: `validateSpan` → `SchemaViolation[]`, `hasErrors`, `formatViolation`. Levenshtein "did you mean?" for unknown attrs.
- `processor.ts`: `SchemaValidationSpanProcessor` / `createSchemaValidationProcessor` (runtime gate, structural OTel types).
- `snapshot.ts`: `contractToSnapshot`, `serializeSnapshot`, `parseSnapshot`.
- `diff.ts`: `diffSnapshots`, `hasBreakingChanges`, `formatDiff` (markdown).
- `redaction.ts`: `highCardinalityKeys` / `isHighCardinalityKey` → redactor protect-list.
- `cli.ts`: `autotel-schema diff|check <baseline> <current> [--json]`; `check` exits 1 on breaking. Binary auto-runs only when basename matches (so a repo path containing "autotel-schema" can't trigger it).

## Conventions (match the monorepo)

- `import path from 'node:path'` (default import). `Array#toSorted()` not `.sort()`.
- Build: tsdown via `tsupCompatOutExtensions`. Entries: `index`, `processor`, `diff`, `cli` (bin). Exports: `.`, `./processor`, `./diff`.
- `pnpm test` (vitest), `pnpm lint`, `pnpm type-check`, `pnpm build`.
