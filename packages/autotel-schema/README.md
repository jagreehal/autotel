# autotel-schema

> A typed, versioned contract for your telemetry surface. Declare the spans and attributes your service emits, validate live spans against the contract, and diff it across commits to catch breaking trace changes before release.

When the main reader of your telemetry is an **agent**, your span names and attribute keys are a **public API**. Rename `fast_path_hit` to `fast_path_taken` in a refactor and you break the prompts and alerts that mention it. No compiler catches the change, because to the compiler these are strings in a JSON blob.

`autotel-schema` makes that surface explicit, typed, and versionable. With [`autotel-pact`](../autotel-pact) it forms autotel's observability-contract pair. Both use telemetry to answer a contract question:

- **`autotel-schema`** (this package): the telemetry contract you emit (span names + attributes)
- [`autotel-pact`](../autotel-pact): evidence that contracted interactions actually ran

An optional adjacent package, [`autotel-message-contract`](../autotel-message-contract), extends the idea beyond telemetry to serialized payload compatibility. It runs at test time and needs no runtime observability.

The contract model is **dependency-free and side-effect-free**, so you can import it anywhere (browser, edge, CLI) without pulling in the OpenTelemetry SDK.

## Install

```bash
pnpm add autotel-schema
# autotel is an optional peer dependency
```

## 1. Declare the contract

```ts
import { defineContract } from 'autotel-schema';

export const contract = defineContract({
  service: 'checkout',
  version: '1.2.0', // semver of the *contract*, not the app
  commonAttributes: {
    'user.id': { type: 'string', highCardinality: true, description: 'Authenticated user' },
  },
  spans: {
    'checkout.charge': {
      description: 'Charge a payment method',
      attributes: {
        'payment.provider': { type: 'string', required: true, enum: ['stripe', 'paypal'] },
        'payment.amount_cents': { type: 'number', required: true },
      },
    },
  },
});
```

`defineContract()` validates structure (semver, attribute types, deprecations) when the module loads and freezes the result, so a malformed contract throws at startup rather than at runtime.

## 2. Validate live spans

Add the span processor to your OpenTelemetry setup. It validates each ending span against the contract with bounded, deduplicated warnings. It is **fail-open**: a bug in validation cannot break your export. In production it stays off unless you opt in.

```ts
import { createSchemaValidationProcessor } from 'autotel-schema/processor';
import { contract } from './telemetry.contract';

const processor = createSchemaValidationProcessor({
  contract,
  mode: 'warn', // 'warn' (default) | 'throw' (tests/CI) | 'silent' (collect via onViolation)
  strictSpanNames: true, // also flag spans not in the contract
});
// register `processor` with your TracerProvider
```

Or validate a span shape directly (e.g. in a unit test):

```ts
import { validateSpan, hasErrors, formatViolation } from 'autotel-schema';

const violations = validateSpan(
  { name: 'checkout.charge', attributes: { 'payment.provider': 'bitcoin' } },
  contract,
);
// → [missing_required payment.amount_cents, enum_violation payment.provider]
if (hasErrors(violations)) violations.forEach((v) => console.error(formatViolation(v)));
```

Violation codes: `missing_required`, `type_mismatch`, `enum_violation`, `unknown_attribute` (with a "did you mean?" suggestion via edit distance), and `unknown_span`.

## 3. Gate breaking changes in CI

Snapshot the contract, commit the baseline, and diff it on every PR. A removed span or a tightened type is **breaking**; a new span or attribute is **additive**.

```ts
import { contractToSnapshot, serializeSnapshot } from 'autotel-schema';
import { writeFileSync } from 'node:fs';
import { contract } from './telemetry.contract';

writeFileSync('telemetry.snapshot.json', serializeSnapshot(contractToSnapshot(contract)));
```

Then in CI, with the bundled `autotel-schema` CLI:

```bash
# regenerate the current snapshot, then:
autotel-schema check telemetry.baseline.json telemetry.current.json
# exits 1 with a markdown diff if any breaking change is found
autotel-schema diff  telemetry.baseline.json telemetry.current.json --json
```

Programmatically:

```ts
import { diffSnapshots, hasBreakingChanges, formatDiff } from 'autotel-schema/diff';

const diff = diffSnapshots(baseline, current);
if (hasBreakingChanges(diff)) throw new Error(formatDiff(diff));
```

## 4. Protect high-cardinality keys from redaction

The old "keep cardinality down" rule exists because dashboards have pixels. An agent reads the spans rather than scanning a graph, and a high-cardinality field like a user id or request id is often the one attribute that pins down a single failure. Mark those `highCardinality: true` and feed them to your redactor as a **protect list**:

```ts
import { init } from 'autotel';
import { highCardinalityKeys } from 'autotel-schema';
import { contract } from './telemetry.contract';

init({
  service: 'checkout',
  attributeRedactor: { allowKeys: highCardinalityKeys(contract), preset: 'strict' },
});
```

## What this is / isn't

- **Is**: a contract for your telemetry surface: span names, attribute keys, types, enums, stability, and breaking-vs-additive evolution.
- **Isn't**: a contract for application message payloads (use [`autotel-message-contract`](../autotel-message-contract)) or evidence that interactions ran (use [`autotel-pact`](../autotel-pact)). It does not require the OpenTelemetry SDK. The processor works against structural span types.

## License

MIT © Jag Reehal
