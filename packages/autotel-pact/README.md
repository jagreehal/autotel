# autotel-pact

> Evidence that your Pact contracts are alive. Audit which contracted interactions ran in the audit window, and which are stale confidence.

`autotel-pact` is the bridge between [Pact](https://docs.pact.io) and [autotel](https://github.com/jagreehal/autotel). It records, with every contract test run, which interactions were exercised, and produces an audit that answers a question Pact alone cannot:

> Of the contracts your test suite claims to verify, which ones were actually exercised in the last N days of test runs?

A green Pact suite is evidence of **compatibility**. An observed verified contract is evidence of **relevance**. Most teams have plenty of the former and little of the latter.

## Evidence quality

**We do not guess. We record evidence.**

Every feature states what was observed or verified. We never claim precision the data cannot support.

| Evidence | What it means | What you must configure |
|----------|---------------|-------------------------|
| **Seen in test** | Consumer exercised the interaction in CI (`source=test`, `role=consumer`) | `withPactInteraction` or `auto-wrap` |
| **Seen in production** | A span tagged with `pact.*` was recorded at runtime | `tagPactInteraction()` + `PactLedgerSpanProcessor` |
| **Provider verified** | Provider `verifyProvider()` succeeded and we enumerated interactions from the pact file | `withProviderVerification` |
| **Broker verified** | Latest broker verification for the consumer–provider **pact pair** succeeded | Broker URL/token at **audit** time |

> **Broker limitation:** Broker verification proves the latest pact between a consumer and provider passed. It does **not** prove autotel-pact observed each interaction.

## When to use it

You should reach for autotel-pact when:

- You use **Pact** (HTTP or Message) contracts and want evidence each interaction actually fires in your test suite.
- Your contract suite is large and you suspect some contracts are obsolete or unexercised, but you can't prove it.
- You want a CI gate that fails when a "verified" contract has not been exercised recently.

v0.2 supports **consumer** wrappers (message + HTTP), **provider** verification, optional **Pact Broker** enrichment at audit time, and **production** observation via a span processor.

## What this package does NOT do

- **Does not replace Pact.** Pact still owns matching and `can-i-deploy`. We add complementary evidence.
- **Does not infer interactions from routes.** Production observation requires explicit `pact.*` span tags.
- **Does not write or modify pact files.** We only record that interactions ran or were verified.
- **Does not claim per-interaction broker proof.** Broker results are pact-pair level (see warning above).
- **Does not record request/response bodies** in the ledger. Metadata only (consumer, provider, description, states, trace ids).

## Install

```bash
pnpm add -D autotel-pact
# autotel and @pact-foundation/pact are peer dependencies
```

## Run the demo

A working end-to-end example lives at [`apps/example-contract-testing`](../../apps/example-contract-testing). One `pnpm start` walks through every v0.2 evidence path (TEST_SEEN, STALE, SHADOW, PROVIDER_VERIFIED, PROD_SEEN) and asserts the resulting audit matrix:

```bash
pnpm --filter @jagreehal/example-contract-testing start
```

## The runtime wrapper

### Message Pact

Wrap your existing `MessageConsumerPact.verify()` call:

```ts
import { MessageConsumerPact } from '@pact-foundation/pact';
import { withPactInteraction } from 'autotel-pact';
import { orderHandler } from './handlers/order';

const pact = new MessageConsumerPact({
  consumer: 'OrderShipper',
  provider: 'OrderService',
  dir: './pacts',
});

pact
  .given('an order has been created')
  .expectsToReceive('an OrderCreated event')
  .withContent({ orderId: 'ord-123', total: 99.5 });

await withPactInteraction(pact, (message) => orderHandler(message.contents));
```

### HTTP Pact

Same idea, mirrored onto `PactV3.executeTest()`:

```ts
import { PactV3 } from '@pact-foundation/pact';
import { withHttpPactInteraction } from 'autotel-pact';
import { API } from './api';

const provider = new PactV3({
  consumer: 'Web',
  provider: 'Catalog',
  dir: './pacts',
});

it('gets all products', async () => {
  await withHttpPactInteraction(
    provider,
    {
      states: [{ description: 'products exist' }],
      uponReceiving: 'get all products',
      withRequest: { method: 'GET', path: '/products' },
      willRespondWith: { status: 200, body: [/* ... */] },
    },
    async (mockServer) => {
      const api = new API(mockServer.url);
      expect(await api.getAllProducts()).toEqual(/* ... */);
    },
  );
});
```

Both wrappers:

1. Open an autotel span named `pact.interaction` with `pact.consumer`, `pact.provider`, `pact.interaction.description`, `pact.interaction.states`, `pact.kind`, and `pact.outcome` attributes.
2. Run the underlying Pact verification (`verify()` / `executeTest()`).
3. Append a ledger entry recording that the interaction was exercised.

If the handler / test throws, the span outcome is `failed` and the ledger entry records the error.

### Stable interaction IDs (optional but recommended)

The audit keys on the `expectsToReceive` / `uponReceiving` text by default. Renaming that text creates a new audit row and leaves the old one STALE. Pass `interactionId` to give the interaction a name that survives prose changes:

```ts
await withPactInteraction(pact, handler, {
  interactionId: 'order.created.v1',
});
```

Convention: `domain.event.vN`. The audit matches on `interactionId` first, description second.

### Auto-wrap (zero-touch adoption)

If you don't want to edit every contract test, add a single line to your vitest / jest setup:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { setupFiles: ['autotel-pact/auto-wrap'] },
});
```

That import monkey-patches `MessageConsumerPact.prototype.verify` and `PactV3.prototype.executeTest` so every contract test in the project records a ledger entry. No code changes per test. Configure with `AUTOTEL_PACT_RUN_ID` and `AUTOTEL_PACT_LEDGER_DIR` env vars. Idempotent; safe no-op when Pact-JS isn't installed.

Trade-off: auto-wrap is global, so all your contract tests must share one ledger directory and one run id. If you need per-test customisation (custom `interactionId`, `contractFile`, `runId`), use the explicit wrappers above.

## The ledger

Each `withPactInteraction` call appends one line of JSON to a ledger file:

```text
.autotel-pact/ledger-${runId}.jsonl
```

Where `runId` comes from `AUTOTEL_PACT_RUN_ID` (set this in CI), falling back to a local timestamp. One file per run avoids append races when tests run in parallel. Upload the directory as a CI artifact for cross-run audits.

A ledger entry looks like:

```json
{
  "type": "interaction",
  "spec": "autotel-pact-ledger-entry/v0.2.0",
  "consumer": "OrderShipper",
  "provider": "OrderService",
  "interaction": "an OrderCreated event",
  "interaction_id": "order.created.v1",
  "states": ["an order has been created"],
  "kind": "message",
  "outcome": "passed",
  "source": "test",
  "role": "consumer",
  "duration_ms": 3.3,
  "observed_at": "2026-05-28T18:09:13.728Z",
  "trace_id": "abc...",
  "span_id": "def...",
  "run_id": "ci-build-1234",
  "git_sha": "..."
}
```

The full ledger and audit-matrix shapes are published as JSON Schema files under [`schemas/`](./schemas/). Pin to a specific schema version if you build dashboards or downstream tooling against the output. The `spec` field on every artifact is your gate against unknown major versions.

## Provider verification (v0.2)

```ts
import { Verifier } from '@pact-foundation/pact';
import { withProviderVerification } from 'autotel-pact/provider';

await withProviderVerification({
  provider: 'OrderService',
  providerBaseUrl: 'http://localhost:8080',
  pactUrls: ['./pacts/OrderShipper-OrderService.json'],
});
```

On **success**, one ledger row per interaction in the verified pact file (`role=provider`). On **failure**, a single `provider_verification_run` row, with no per-interaction `provider_verified` flags (we cannot prove which interaction failed).

### Skipping the Verifier (demos, smoke tests)

Pass `skipVerifier: true` to emit the same per-interaction rows without loading or calling the Pact Verifier:

```ts
await withProviderVerification(
  { provider: 'OrderService', providerBaseUrl: 'unused', pactUrls: [pactPath] },
  { skipVerifier: true },
);
```

The wrapper parses the pact files, fans out one ledger row per interaction with `role: 'provider'` and `outcome: 'passed'`, and skips the dynamic import of `@pact-foundation/pact`. Use for demos, audit-pipeline smoke tests, and example apps. Not for production CI: it marks every interaction in the pact file as verified without checking anything.

## Production observation (v0.2)

Tag business spans, then register the processor:

```ts
import { init } from 'autotel';
import { trace } from 'autotel';
import { createPactLedgerProcessor } from 'autotel-pact/processor';
import { tagPactInteraction } from 'autotel-pact/tag';

init({
  service: 'order-service',
  spanProcessors: [
    createPactLedgerProcessor({ dir: '.autotel-pact-prod' }),
  ],
});

trace('handleOrderCreated', (ctx) => {
  tagPactInteraction({
    consumer: 'OrderShipper',
    provider: 'OrderService',
    description: 'an OrderCreated event',
    states: [],
    kind: 'message',
    interactionId: 'order.created.v1',
  });
  // ...
});
```

**Safeguards:**

- Bounded queue (default 1024). When full, the processor drops the oldest queued entry so newest evidence survives. A throttled warning fires on each drop wave.
- Producer backpressure on direct `appendLedgerEntryAsync` callers. The internal write chain is capped at 4096 pending writes. Past that cap, callers await drainage before queueing, so memory cannot grow unbounded.
- Fail-open writes. A ledger I/O error never breaks the app: the error is reported via `onWriteError` and the span continues.
- Sampling caveat: if OTel sampling drops a span, the corresponding production observation is missed.

Use a **separate ledger directory** for production vs CI.

## Pact Broker at audit time (v0.2)

```bash
npx autotel-pact audit \
  --broker-url https://your-broker.example \
  --broker-token "$PACT_BROKER_TOKEN"
```

Works with self-hosted Pact Broker and PactFlow (same HTTP API; bearer token from PactFlow settings). Sets **Broker verified** on all contracted rows for a consumer–provider pair when the latest broker verification succeeded.

## The audit CLI

```bash
npx autotel-pact audit
```

Columns (human labels):

```text
STATUS  CONTRACTED  TEST_SEEN  PROD_SEEN  PROVIDER_VERIFIED  BROKER_VERIFIED  CONSUMER → PROVIDER  …
```

- **OK**: contracted and **seen in test**
- **STALE**: contracted but not **seen in test**
- **SHADOW**: seen (test or production) but not contracted

### Status meanings

| Status | Contracted in `pacts/` | In ledger window | Meaning                                       |
|--------|------------------------|------------------|-----------------------------------------------|
| OK     | yes                    | yes              | Trusted path, exercised this window           |
| STALE  | yes                    | no               | Pact exists but no test exercised it          |
| SHADOW | no                     | yes              | A wrapped call ran with no matching contract  |

### Flags

| Flag                | Default        | Description                                                                |
|---------------------|----------------|----------------------------------------------------------------------------|
| `--pacts <dir>`     | `./pacts`      | Directory containing pact files                                            |
| `--ledger <dir>`    | `.autotel-pact`| Directory containing ledger files                                          |
| `--window <days>`   | `14`           | Ledger lookback window                                                     |
| `--gate`            | off            | Exit 1 if any contracted interaction was not **seen in test**              |
| `--gate=strict`     | off            | Also exit 1 on observations with no matching contract                      |
| `--gate=broker`     | off            | Exit 1 if broker configured and any contracted row lacks broker proof      |
| `--broker-url`      | env            | Pact Broker base URL (`PACT_BROKER_BASE_URL`)                              |
| `--broker-token`    | env            | Bearer token (`PACT_BROKER_TOKEN`)                                         |
| `--json`            | off            | Machine-readable JSON (`test_seen`, `prod_seen`, …)                        |
| `--help`            |                | Show help                                                                  |

### CI gating

```yaml
# .github/workflows/test.yml
- run: pnpm test:pact
  env:
    AUTOTEL_PACT_RUN_ID: ${{ github.run_id }}
- uses: actions/upload-artifact@v4
  with:
    name: pact-ledger
    path: .autotel-pact/
- run: npx autotel-pact audit --gate
```

## Operating guide

A few things to know before you turn `--gate` on for the whole org.

### STALE means "not seen in test"

A STALE row does **not** mean "never fires in production". It means no consumer test exercised this interaction in the window. Check **PROD_SEEN** for production evidence (requires explicit span tags + processor).

Honest one-liner: *"verified by Pact, exercised by our tests, observed in production only when we tag spans."*

### Coverage equals wrapped tests

The audit only sees interactions that went through `withPactInteraction`. If half your Pact-Message suite still calls `pact.verify()`, those interactions won't reach the ledger and you'll get **false STALE** rows.

Migration checklist for an existing Pact suite:

1. Roll the wrapper out in one team first; don't `--gate` until coverage is high.
2. Add a lint rule or grep-based CI check (`! grep -r 'pact.verify(' --include='*.ts' src/`) to prevent regressions.
3. When `pnpm autotel-pact audit` reports 0 SHADOW rows from your real tests (only from injected demo rows), coverage is complete enough to turn the gate on.

### Pick the audit window to match your test cadence

The `--window` flag defaults to 14 days. If important interactions only run in nightly or weekly jobs, set the window wide enough to cover them, or `--gate` will flake. A safe rule: `--window` should be at least 2× the slowest test cadence that contributes to coverage.

### Interaction renames create new audit rows

Interactions are keyed by `(consumer, provider, kind, description)`. The `description` is the literal string passed to `expectsToReceive()`. If you rename `"an OrderCreated event"` to `"OrderCreated"`, the audit sees a **new** row (and the old description goes STALE until the pact file is regenerated).

This is intentional: descriptions are the only stable identity Pact-JS exposes. Plan renames as two-step migrations: rename in code and delete the old pact entry, in one PR if possible. A future version may offer stable interaction IDs via metadata.

### STALE vs intentionally-disabled

A contract that should not run anymore is a contract you should delete, not gate around. STALE is a prompt to **investigate**, not a permanent state to tolerate.

## Attribute schema

| Attribute                       | Type     | Description                                       |
|---------------------------------|----------|---------------------------------------------------|
| `pact.consumer`                 | string   | Consumer name from Pact config                    |
| `pact.provider`                 | string   | Provider name from Pact config                    |
| `pact.kind`                     | string   | `"message"` (v1) or `"http"` (v2)                 |
| `pact.interaction.description`  | string   | The `expectsToReceive` or `uponReceiving` text    |
| `pact.interaction.states`       | string[] | Provider state names from `.given()`              |
| `pact.contract.file`            | string?  | Path to the pact file (when supplied)             |
| `pact.outcome`                  | string   | `"passed"` or `"failed"`                          |

The `pact.*` namespace is currently unclaimed in OTel semantic conventions; we plan to propose it upstream once the package has traction. Pin to a specific `autotel-pact` version if you build dashboards against these attributes.

## How this is different from…

- **Pact's own `--enable-otel`** flags emit telemetry about the *Pact tooling itself* (broker calls, verifier execution). `autotel-pact` operates at the **interaction wrapper layer in your code**, capturing whether the contract interactions ran.
- **Tracetest** lets you write tests that assert against traces. `autotel-pact` does not change how you write tests. It audits which of your existing Pact contracts have evidence of being exercised.
- **Pact Broker / PactFlow `can-i-deploy`** verifies version compatibility. `autotel-pact` adds the orthogonal question: have these verified contracts run recently?

## Related packages

- [`autotel`](../autotel): OpenTelemetry instrumentation for Node.js.
  The substrate every span and ledger entry is built on top of.

## Roadmap

- **v0.1**: consumer wrappers, ledger, audit CLI, auto-wrap, interaction IDs, JSON schemas.
- **v0.2** (current): provider verification, broker enrichment at audit, production span processor, evidence columns (TEST_SEEN / PROD_SEEN / PROVIDER_VERIFIED / BROKER_VERIFIED).
- **v0.3+**: PactV4 interaction comments, per-interaction broker hooks if the API allows, publishing verification results to broker from autotel-pact.

## License

MIT
