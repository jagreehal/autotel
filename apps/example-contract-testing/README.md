# example-contract-testing

End-to-end demo of [`autotel-pact`](../../packages/autotel-pact/README.md) v0.2. One `pnpm start` exercises every evidence path the v0.2 audit knows about and prints the matrix.

```text
autotel-pact demo — runtime evidence for Pact contracts (v0.2)
================================================================================================

  ▶ Running 2 contracted interactions through withPactInteraction()
  ▶ Injecting a stale pact entry (contract exists, nothing exercised it)
  ▶ Recording a SHADOW observation (runtime fires, no contract)
  ▶ Running provider verification (skipVerifier: true)
  ▶ Simulating a production span carrying pact.* tags

  ▶ Running audit...

Window: last 14 day(s)
────────────────────────────────────────────────────────────────────────────────────────────────
  STATUS    TEST  PROD  PROVIDER  BROKER   CONSUMER → PROVIDER             INTERACTION
────────────────────────────────────────────────────────────────────────────────────────────────
  👻 SHADOW   yes    no    no       no     OrderShipper → InventoryService  an InventoryReserved event
  ✅ OK       yes   yes   yes       no     OrderShipper → OrderService      an OrderCreated event
  ⚠️  STALE    no    no   yes       no     OrderShipper → OrderService      an OrderRefunded event
  ✅ OK       yes    no   yes       no     OrderShipper → OrderService      an OrderShipped event
────────────────────────────────────────────────────────────────────────────────────────────────
Summary
  Contracted:                  3
  Seen in test:                3
  Seen in production:          1
  Provider verified:           3
  Contracted AND seen in test: 2
  Contracted, NOT seen in test:1  ← stale confidence
  Seen, NOT contracted:        1  ← ungoverned flow
```

## What it shows

Each row demonstrates a different combination of v0.2 evidence sources.

| Row               | Status | TEST_SEEN | PROD_SEEN | PROVIDER_VERIFIED | What set it up                                                                                                                                  |
| ----------------- | ------ | --------- | --------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| OrderCreated      | OK     | yes       | yes       | yes               | `withPactInteraction` with a Zod schema at the message boundary, `tagPactInteraction` inside a `trace()`, plus provider verify (`skipVerifier`) |
| OrderShipped      | OK     | yes       | no        | yes               | `withPactInteraction` with a Zod schema at the message boundary, plus provider verify (`skipVerifier`)                                          |
| OrderRefunded     | STALE  | no        | no        | yes               | Hand-injected into the pact file; covered by `skipVerifier` provider verify but never exercised by a consumer test                              |
| InventoryReserved | SHADOW | yes       | no        | no                | Hand-written `appendLedgerEntry`, no matching pact                                                                                              |

The STALE row is the headline. A green Pact suite would tell you all three contracts are verified. The audit tells you only two were actually exercised this run, even though all three got the provider stamp.

The matrix above is the demo script's compact printer. `pnpm pact:audit` prints a wider table that also includes a CONTRACTED column and a KIND column (`message` or `http`), useful when you diff the two. The BROKER column stays `no` for every row until you run `pnpm pact:audit:broker` with `PACT_BROKER_BASE_URL` and a token set.

## Run it

```bash
pnpm install   # from repo root
pnpm --filter @jagreehal/example-contract-testing start
```

Inspect the artifacts the demo wrote:

```bash
cat pacts/OrderShipper-OrderService.json     # 3 messages
ls .autotel-pact/                             # consumer + provider rows
ls .autotel-pact-prod/                        # production rows from the span processor
```

The demo uses two ledger directories on purpose. In real deployments the `PactLedgerSpanProcessor` runs in production while `withPactInteraction` runs in CI, so they never share a process. The demo runs both inside one Node process, so routing the processor to `.autotel-pact-prod` and copying it into `.autotel-pact` before the audit avoids cross-talk between the wrapper's own spans and the explicit production tag.

## CLI scripts

```bash
pnpm pact:audit            # print the v0.2 matrix
pnpm pact:audit:gate       # exit 1 if any contracted interaction was not seen in test
pnpm pact:audit:broker     # exit 1 if a Pact Broker is configured and any contracted row lacks proof
```

`pact:audit:broker` requires `PACT_BROKER_BASE_URL` and `PACT_BROKER_TOKEN` (or `--broker-url` / `--broker-token`). Without them the script exits non-zero because no contracted row has broker proof; that is the gate doing its job.

## What the demo's source code shows

[`src/index.ts`](./src/index.ts) is a single self-contained script. Each slice maps to one v0.2 evidence path.

1. **`exerciseOrderCreated` / `exerciseOrderShipped`** — the canonical consumer-side pattern. `new MessageConsumerPact(...)`, fluent `.given().expectsToReceive().withContent()`, then `withPactInteraction(pact, handler, { interactionId })`. The handler parses `message.contents` (Pact-JS types it as `unknown`) through a Zod schema before calling the business handler, which makes the type boundary explicit and surfaces drift between the pact file and the consumer code as a clear validation error. `interactionId` keeps audit rows stable across rewrites of the `expectsToReceive` text.
2. **`injectStalePactFile`** — appends a message to the pact file by hand to simulate a contract that some other test no longer runs.
3. **`recordShadowObservation`** — `appendLedgerEntry` with a consumer the pact files do not mention.
4. **`runProviderVerification`** — `withProviderVerification` with `skipVerifier: true`. The wrapper parses the pact file and fans out one ledger row per interaction with `role: 'provider'` without loading or calling the real Verifier. In production drop the option and `@pact-foundation/pact` runs against a real provider service.
5. **`simulateProductionObservation`** — `trace('handleOrderCreated', () => { tagPactInteraction({...}); handler(); })`. The `PactLedgerSpanProcessor` registered at `init()` time catches the span and writes a `source: production` row.

In a real codebase the consumer-side pattern is the one you write per test. The other four are demo plumbing that simulates failure modes the audit catches.

After printing the matrix, `assertMatrix(matrix)` checks every row and every count against the expected story so the README's documented output cannot drift silently. If you change the demo and the matrix changes shape, the assertions fail loud.

## Environment

```bash
OTLP_ENDPOINT=http://localhost:4318    # default
DEBUG=true                             # autotel debug logging
AUTOTEL_PACT_RUN_ID=ci-build-1234      # tag ledger entries with a run id

# Optional broker integration
PACT_BROKER_BASE_URL=https://pact-broker.example
PACT_BROKER_TOKEN=...
# or: PACT_BROKER_USERNAME / PACT_BROKER_PASSWORD
```

If there is no local OTLP collector the demo still works; spans just have nowhere to go.

## Related

- [`autotel-pact`](../../packages/autotel-pact/README.md) — the package this demo uses
- [Pact documentation](https://docs.pact.io)
- [Pact-Message overview](https://docs.pact.io/getting_started/how_pact_works#message-pact)
