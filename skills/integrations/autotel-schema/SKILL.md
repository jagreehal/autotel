---
name: autotel-schema
description: >
  Use this skill when treating a service's telemetry surface as a typed, versioned contract — defineContract() to declare span names and attributes, createSchemaValidationProcessor() to validate live spans, or the autotel-schema diff CLI to catch breaking trace changes across commits before release.
---

# autotel-schema

When an **agent** is the main reader of your telemetry, your span names and attribute keys are a public API. Rename `fast_path_hit` to `fast_path_taken` and you break the prompts and alerts that mention it, with no compiler to catch it. `autotel-schema` makes that surface explicit, typed, and versionable.

The contract model is dependency-free and side-effect-free, so you can import it in the browser, edge, or a CLI without pulling in the OpenTelemetry SDK.

## When to use

- Declare the spans and attributes a service is allowed to emit.
- Warn (or throw in CI) when a live span violates the declared contract.
- Diff the contract across commits to catch breaking trace changes before they ship.

## Core patterns

### 1. Declare the contract

```ts
import { defineContract } from 'autotel-schema';

export const contract = defineContract({
  service: 'checkout',
  version: '1.2.0', // semver of the contract, not the app
  commonAttributes: {
    'user.id': {
      type: 'string',
      highCardinality: true,
      description: 'Authenticated user',
    },
  },
  spans: {
    'checkout.charge': {
      description: 'Charge a payment method',
      attributes: {
        'payment.provider': {
          type: 'string',
          required: true,
          enum: ['stripe', 'paypal'],
        },
        'payment.amount_cents': { type: 'number', required: true },
      },
    },
  },
});
```

`defineContract()` validates structure and freezes the result at module load, so a malformed contract throws at startup rather than at runtime.

### 2. Validate live spans

```ts
import { createSchemaValidationProcessor } from 'autotel-schema/processor';
import { contract } from './telemetry.contract';

const processor = createSchemaValidationProcessor({
  contract,
  mode: 'warn', // 'warn' (default) | 'throw' (tests/CI) | 'silent' (collect via onViolation)
  strictSpanNames: true, // flag spans not in the contract
});
// register `processor` with your TracerProvider
```

The processor is **fail-open**: a validation bug cannot break your export. In production it stays off unless you opt in.

### 3. Diff the surface across commits

```bash
npx autotel-schema diff old.contract.json new.contract.json
```

Use it as a CI gate: a removed span or a tightened attribute is a breaking change to the telemetry API.

## Common mistakes

### HIGH: Running `mode: 'throw'` in production

`throw` is for tests and CI. In production use `warn` or `silent` so a contract violation reports without dropping the span.

### MEDIUM: Bumping the app version instead of the contract version

`version` is the semver of the telemetry contract. Bump it when span names or attributes change, independent of the application release.

## Related

- `autotel-pact` — evidence that contracted interactions actually ran.
- `autotel-message-contract` — the same idea for serialized payload compatibility.

## Version

`autotel` is an optional peer dependency; the contract model imports standalone.
