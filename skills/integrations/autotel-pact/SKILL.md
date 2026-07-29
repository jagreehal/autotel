---
name: autotel-pact
description: >
  Use this skill when you run Pact contracts and want evidence each interaction actually fired — withPactInteraction/auto-wrap to record consumer test runs, withProviderVerification for provider evidence, tagPactInteraction() + PactLedgerSpanProcessor for production observation, or the autotel-pact CLI to audit "contracted but never exercised" and gate CI.
---

# autotel-pact

The bridge between [Pact](https://docs.pact.io) and `autotel`. A green Pact suite proves **compatibility**. `autotel-pact` records which contracted interactions were actually **exercised**, and audits the question Pact alone cannot answer: of the contracts your suite claims to verify, which ones ran in the last N days?

**We record evidence, we do not guess.** Every result states what was observed or verified, at the level the data supports.

## When to use

- You use Pact (HTTP or Message) and want proof each interaction fires in CI.
- Your contract suite is large and you suspect some contracts are stale.
- You want a CI gate that fails when a "verified" contract went unexercised recently.

## Evidence levels

| Evidence           | Means                                          | Configure                                          |
| ------------------ | ---------------------------------------------- | -------------------------------------------------- |
| Seen in test       | Consumer exercised the interaction in CI       | `withPactInteraction` or `auto-wrap`               |
| Seen in production | A span tagged `pact.*` was recorded at runtime | `tagPactInteraction()` + `PactLedgerSpanProcessor` |
| Provider verified  | `verifyProvider()` succeeded                   | `withProviderVerification`                         |
| Broker verified    | Latest broker verification for the pact pair   | Broker URL/token at audit time                     |

Broker verification is pact-pair level: it proves the latest pact passed, not that autotel-pact observed each interaction.

## Core patterns

### Record consumer interactions in tests

```ts
import { withPactInteraction } from 'autotel-pact';

await withPactInteraction(
  { consumer: 'web', provider: 'orders', description: 'get order by id' },
  async () => runTheInteraction(),
);
```

### Observe interactions in production

```ts
import { tagPactInteraction } from 'autotel-pact';
import { PactLedgerSpanProcessor } from 'autotel-pact/processor';

// register PactLedgerSpanProcessor with your TracerProvider, then tag spans:
tagPactInteraction({
  consumer: 'web',
  provider: 'orders',
  description: 'get order by id',
});
```

### Audit and gate CI

```bash
npx autotel-pact audit --window 7d --fail-on-stale
```

## Common mistakes

### HIGH: Expecting production interactions to be inferred from routes

Production observation requires explicit `pact.*` span tags. The package never infers interactions from URLs.

### MEDIUM: Reading broker "verified" as per-interaction proof

Broker results are pact-pair level. For per-interaction evidence, rely on `Seen in test` or `Seen in production`.

## Related

- `autotel-schema` — your telemetry surface as a contract.
- Pact still owns matching and `can-i-deploy`; this package adds evidence, it does not replace Pact.

## Version

v0.2 supports consumer wrappers (message + HTTP), provider verification, optional broker enrichment at audit time, and production observation.
