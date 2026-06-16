# CLAUDE.md: autotel-message-contract

Brokerless **message** contract testing: pin the serialized shape of application messages and prove cross-version compatibility, as ordinary unit tests.

## What it is / isn't

- **Is**: a test-time, dev-dependency library. Snapshot a message's serialized output (committed `.approved.txt` file beside the test) + verify backward/forward deserialization compatibility across versioned readers.
- **Isn't**: a runtime tracing concern. It does NOT depend on the OTel SDK at runtime (autotel is an *optional* peer). It does not replace Pact/`autotel-pact` (which prove interactions *fired*) or `autotel-schema` (which pins the *telemetry* surface). It is single-purpose: message serialization only (API-surface pinning was dropped to keep the pitch clean).

## Portfolio frame: optional adjacent to the observability-contract pair

This is an **optional, standalone, test-time** package. Unlike the core
observability-contract pair it needs no runtime observability to be useful (it's
a dev dependency; `autotel` is an optional peer). It extends the "govern the
observable contracts at each boundary" idea *beyond* telemetry, to serialized
payloads. Keep it positioned as adjacent, not co-equal, with schema + pact.

| Package | What it contracts | Role |
|---------|-------------------|------|
| `autotel-schema` | the telemetry contract you emit (span names + attributes) | core pair |
| `autotel-pact` | evidence that contracted (Pact) interactions actually ran | core pair |
| **`autotel-message-contract`** (this) | serialized payload compatibility across versions | optional adjacent |

The name states the unit on purpose: "contract" alone is overloaded by `autotel-pact` and `autotel-schema`'s `TelemetryContract`.

## Design invariants

- **Use the app's serializer.** `MessageSerializer = { name, serialize, deserialize }`. Default `jsonSerializer()` sorts keys deeply (snapshots reflect fields, not construction order). A snapshot is only meaningful if it's the bytes the consumer sees.
- **Readers, not classes.** TS types are erased; compatibility uses a Standard Schema (`~standard`) or a parse function, not a class/reflection. See `src/reader.ts`.
- **Snapshots are committed files.** First run writes + passes; later runs compare. Update via `AUTOTEL_CONTRACT_UPDATE=1` (also `UPDATE_CONTRACTS`/`UPDATE_SNAPSHOTS`) or `{ update: true }`.
- **No throws across the reader seam.** `read()` converts thrown parse errors / schema issues into `{ ok, issues }` so failures format as one legible message.

## Source map (`src/`)

- `contract.ts`: the `messageContract()` fluent DSL (Given → When → Snapshot/Compatibility steps) + `ContractViolationError`.
- `serializer.ts`: `MessageSerializer` interface, `jsonSerializer`, `defaultSerializer`, deep key sort.
- `reader.ts`: `Reader` (Standard Schema | parse fn), `read()`.
- `snapshot-storage.ts`: approved-file read/write, update-mode detection, caller-relative `__contracts__/` resolution.
- `diff.ts`: minimal LCS line diff for failure messages.

## Conventions (match the monorepo)

- `import path from 'node:path'` (default import, unicorn rule). `Array#toSorted()` not `.sort()`.
- Build: tsdown via `tsupCompatOutExtensions` (ESM `.js`/`.d.ts`, CJS `.cjs`/`.d.cts`). Entries: `index`, `serializer`.
- `pnpm test` (vitest), `pnpm lint`, `pnpm type-check`, `pnpm build`.
