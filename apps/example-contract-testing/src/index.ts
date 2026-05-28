#!/usr/bin/env node
/**
 * autotel-pact demo — runtime evidence for Pact contracts (v0.2).
 *
 * A single `pnpm start` exercises every evidence path the v0.2 audit knows about:
 *
 *   ✅ TEST_SEEN          — consumer ran the interaction (withPactInteraction)
 *   ⚠️  STALE              — pact file lists the interaction, nothing exercised it
 *   👻 SHADOW             — interaction was exercised with no matching pact
 *   🛡 PROVIDER_VERIFIED  — provider re-verified the pact (withProviderVerification)
 *   🚦 PROD_SEEN          — pact-tagged span was recorded at runtime
 *
 * Pact Broker enrichment runs through the CLI:
 *     pnpm pact:audit:broker
 *
 * A green Pact suite proves compatibility. This audit proves relevance.
 */

import assert from 'node:assert/strict';
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { MessageConsumerPact } from '@pact-foundation/pact';
import { init, shutdown, trace } from 'autotel';
import {
  appendLedgerEntry,
  createPactLedgerProcessor,
  LEDGER_ENTRY_SPEC,
  runAudit,
  tagPactInteraction,
  withPactInteraction,
  withProviderVerification,
  type AuditMatrix,
  type InteractionLedgerEntry,
} from 'autotel-pact';
import { z } from 'zod';

const PACTS_DIR = resolve('./pacts');
const LEDGER_DIR = resolve('./.autotel-pact');
// In real deployments the processor writes from production while the wrappers
// run in CI; the two never share a process. The demo runs both, so route the
// processor to its own dir to avoid wrapper-span cross-talk, then copy the
// production rows into the main ledger before audit.
const PROD_LEDGER_DIR = resolve('./.autotel-pact-prod');
const RUN_ID = 'demo-run';

// ---------------------------------------------------------------------------
// ANSI colour helpers. Pact-JS rewrites the file's bytes when it formats a
// pact entry next to source, so storing literal ESC bytes here would be
// fragile (any editor that strips them silently breaks the colour output).
// `\x1b` is the portable form.
// ---------------------------------------------------------------------------

const ESC = '\x1b';
const COLOR = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  magenta: `${ESC}[35m`,
};

// Reproducible demo: nuke any previous run's artifacts so the matrix is
// deterministic each time you `pnpm start`. Must run before init() touches
// the processor, otherwise the processor mkdir's the dir back into existence.
function resetDemoArtifacts(): void {
  for (const dir of [PACTS_DIR, LEDGER_DIR, PROD_LEDGER_DIR]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(PACTS_DIR, { recursive: true });
  mkdirSync(LEDGER_DIR, { recursive: true });
  mkdirSync(PROD_LEDGER_DIR, { recursive: true });
}

resetDemoArtifacts();

// Register the pact ledger processor at init time. Every span tagged with
// `pact.*` attributes (via tagPactInteraction) gets written to the ledger
// as a `source: production` row.
const pactProcessor = createPactLedgerProcessor({
  dir: PROD_LEDGER_DIR,
  runId: RUN_ID,
});

init({
  service: 'example-contract-testing',
  endpoint: process.env.OTLP_ENDPOINT ?? 'http://localhost:4318',
  debug: process.env.DEBUG === 'true',
  spanProcessors: [pactProcessor],
});

// ---------------------------------------------------------------------------
// The system under test.
//
// Pact's reified `message.contents` is typed as `unknown`. A production
// consumer cannot trust it: the provider could ship a breaking change, or
// the pact file could be hand-edited (we do exactly that below to simulate
// the STALE case). Zod schemas at the boundary turn `unknown` into a typed
// value or a clear error before business code runs.
// ---------------------------------------------------------------------------

const OrderCreatedMessage = z.object({
  orderId: z.string().min(1),
  total: z.number().positive(),
});
type OrderCreatedMessage = z.infer<typeof OrderCreatedMessage>;

const OrderShippedMessage = z.object({
  orderId: z.string().min(1),
  carrier: z.string().min(1),
});
type OrderShippedMessage = z.infer<typeof OrderShippedMessage>;

function handleOrderCreated(message: OrderCreatedMessage): { processed: string } {
  return { processed: message.orderId };
}

function handleOrderShipped(message: OrderShippedMessage): { dispatched: string } {
  return { dispatched: `${message.orderId} via ${message.carrier}` };
}

// ---------------------------------------------------------------------------
// 1. OK / TEST_SEEN — interaction exercised via the wrapper.
// ---------------------------------------------------------------------------

async function exerciseOrderCreated(): Promise<void> {
  const pact = new MessageConsumerPact({
    consumer: 'OrderShipper',
    provider: 'OrderService',
    dir: PACTS_DIR,
    logLevel: 'warn',
  });
  pact
    .given('an order has been created')
    .expectsToReceive('an OrderCreated event')
    .withContent({ orderId: 'ord-1', total: 99.5 });

  await withPactInteraction(
    pact,
    (message) => handleOrderCreated(OrderCreatedMessage.parse(message.contents)),
    {
      dir: LEDGER_DIR,
      runId: RUN_ID,
      // Stable identity that survives renames of the `expectsToReceive` text.
      interactionId: 'order.created.v1',
    },
  );
}

async function exerciseOrderShipped(): Promise<void> {
  const pact = new MessageConsumerPact({
    consumer: 'OrderShipper',
    provider: 'OrderService',
    dir: PACTS_DIR,
    logLevel: 'warn',
  });
  pact
    .given('an order has been packed')
    .expectsToReceive('an OrderShipped event')
    .withContent({ orderId: 'ord-2', carrier: 'royal-mail' });

  await withPactInteraction(
    pact,
    (message) => handleOrderShipped(OrderShippedMessage.parse(message.contents)),
    {
      dir: LEDGER_DIR,
      runId: RUN_ID,
      interactionId: 'order.shipped.v1',
    },
  );
}

// ---------------------------------------------------------------------------
// 2. STALE — pact file lists an interaction, but nothing exercised it.
// ---------------------------------------------------------------------------

function injectStalePactFile(): void {
  // Append "OrderRefunded" onto the OrderShipper-OrderService pact file
  // that the wrapper has already written, simulating a contract that was
  // generated by some other test that no longer runs.
  const path = join(PACTS_DIR, 'OrderShipper-OrderService.json');
  const existing = JSON.parse(readFileSync(path, 'utf8')) as {
    messages?: Array<Record<string, unknown>>;
  };
  existing.messages = existing.messages ?? [];
  existing.messages.push({
    description: 'an OrderRefunded event',
    providerStates: [{ name: 'an order has been refunded' }],
    contents: { orderId: 'ord-3', reason: 'customer-request' },
    metadata: { 'content-type': 'application/json' },
  });
  writeFileSync(path, JSON.stringify(existing, null, 2));
}

// ---------------------------------------------------------------------------
// 3. SHADOW — observation with no matching pact contract.
// ---------------------------------------------------------------------------

function recordShadowObservation(): void {
  const entry: InteractionLedgerEntry = {
    type: 'interaction',
    spec: LEDGER_ENTRY_SPEC,
    consumer: 'OrderShipper',
    provider: 'InventoryService',
    interaction: 'an InventoryReserved event',
    states: [],
    kind: 'message',
    source: 'test',
    role: 'consumer',
    outcome: 'passed',
    duration_ms: 0.4,
    observed_at: new Date().toISOString(),
    run_id: RUN_ID,
  };
  appendLedgerEntry(entry, { dir: LEDGER_DIR, runId: RUN_ID });
}

// ---------------------------------------------------------------------------
// 4. PROVIDER_VERIFIED — provider re-runs the contract against its own code.
//
// The real `withProviderVerification` boots a Pact Verifier and points it at
// a running provider HTTP server. The demo passes `skipVerifier: true`, which
// tells the wrapper to fan out one ledger row per interaction in each pact
// file (role: 'provider') without loading or calling the Verifier. In a real
// provider build, drop the option and `@pact-foundation/pact` runs for real.
// ---------------------------------------------------------------------------

async function runProviderVerification(): Promise<void> {
  await withProviderVerification(
    {
      provider: 'OrderService',
      providerBaseUrl: 'http://localhost:0', // unused when skipVerifier is true
      pactUrls: [join(PACTS_DIR, 'OrderShipper-OrderService.json')],
    },
    {
      dir: LEDGER_DIR,
      runId: RUN_ID,
      skipVerifier: true,
    },
  );
}

// ---------------------------------------------------------------------------
// 5. PROD_SEEN — production span carries `pact.*` attributes.
//
// Anywhere a real handler runs in production, wrap the work in `trace()` and
// call `tagPactInteraction()` once. The processor we registered at init time
// catches the span on close and writes a `source: production` ledger row.
// ---------------------------------------------------------------------------

async function simulateProductionObservation(): Promise<void> {
  await trace('handleOrderCreated', () => {
    tagPactInteraction({
      consumer: 'OrderShipper',
      provider: 'OrderService',
      description: 'an OrderCreated event',
      states: [],
      kind: 'message',
      interactionId: 'order.created.v1',
    });
    // The demo calls the typed handler directly because the producer is
    // synthetic. A real production path validates inbound messages at the
    // ingress edge (HTTP route, queue consumer, event bus subscriber); reuse
    // the same `OrderCreatedMessage` schema as the consumer test so the pact
    // and the runtime both go through the same shape.
    handleOrderCreated({ orderId: 'prod-1', total: 12.5 });
  });
  // The processor writes asynchronously off the span's end event. Force it
  // to drain so the audit below sees the production row.
  await pactProcessor.forceFlush();

  // Merge the production ledger into the main one for the audit. In a real
  // deployment the audit would read a directory containing CI-uploaded test
  // ledgers plus a separately-uploaded production ledger.
  mergeProdLedger();
}

function mergeProdLedger(): void {
  if (!existsSync(PROD_LEDGER_DIR)) return;
  const prodFile = join(PROD_LEDGER_DIR, `ledger-${RUN_ID}.jsonl`);
  if (!existsSync(prodFile)) return;
  const dest = join(LEDGER_DIR, `ledger-${RUN_ID}-prod.jsonl`);
  writeFileSync(dest, readFileSync(prodFile, 'utf8'));
}

// ---------------------------------------------------------------------------
// Pretty-printer for the audit matrix.
// ---------------------------------------------------------------------------

function statusBadge(row: AuditMatrix['rows'][number]): string {
  if (row.contracted && row.test_seen) return `${COLOR.green}✅ OK    ${COLOR.reset}`;
  if (row.contracted && !row.test_seen) return `${COLOR.yellow}⚠️  STALE ${COLOR.reset}`;
  return `${COLOR.magenta}👻 SHADOW${COLOR.reset}`;
}

function yesno(value: boolean): string {
  return value ? `${COLOR.green}yes${COLOR.reset}` : `${COLOR.dim} no${COLOR.reset}`;
}

function printMatrix(matrix: AuditMatrix): void {
  console.log(`\nWindow: last ${matrix.window_days} day(s)`);
  console.log('─'.repeat(96));
  console.log(
    '  STATUS    TEST  PROD  PROVIDER  BROKER   CONSUMER → PROVIDER             INTERACTION',
  );
  console.log('─'.repeat(96));

  for (const row of matrix.rows) {
    const pair = `${row.consumer} → ${row.provider}`.padEnd(30);
    console.log(
      `  ${statusBadge(row)}   ${yesno(row.test_seen)}   ${yesno(row.prod_seen)}    ${yesno(row.provider_verified)}     ${yesno(row.broker_verified)}    ${pair}  ${row.interaction}`,
    );
  }

  console.log('─'.repeat(96));
  console.log('Summary');
  console.log(`  Contracted:                  ${matrix.counts.contracted}`);
  console.log(`  Seen in test:                ${matrix.counts.test_seen}`);
  console.log(`  Seen in production:          ${matrix.counts.prod_seen}`);
  console.log(`  Provider verified:           ${matrix.counts.provider_verified}`);
  console.log(`  Contracted AND seen in test: ${matrix.counts.contracted_and_test_seen}`);
  console.log(
    `  Contracted, NOT seen in test:${COLOR.yellow}${matrix.counts.contracted_not_test_seen}${COLOR.reset}  ← stale confidence`,
  );
  console.log(
    `  Seen, NOT contracted:        ${COLOR.magenta}${matrix.counts.test_or_prod_seen_not_contracted}${COLOR.reset}  ← ungoverned flow`,
  );
}

// ---------------------------------------------------------------------------
// Regression assertions. The demo's value is its evidence story; if the
// story changes silently, callers reading the README would see different
// rows than they expect. These assertions fail loudly on any drift.
// ---------------------------------------------------------------------------

function assertMatrix(matrix: AuditMatrix): void {
  const byKey = new Map(matrix.rows.map((r) => [r.interaction, r]));

  function row(name: string): AuditMatrix['rows'][number] {
    const found = byKey.get(name);
    assert.ok(found, `expected row for "${name}"`);
    return found;
  }

  const created = row('an OrderCreated event');
  assert.equal(created.contracted, true, 'OrderCreated should be contracted');
  assert.equal(created.test_seen, true, 'OrderCreated should be test_seen');
  assert.equal(created.prod_seen, true, 'OrderCreated should be prod_seen');
  assert.equal(created.provider_verified, true, 'OrderCreated should be provider_verified');

  const shipped = row('an OrderShipped event');
  assert.equal(shipped.test_seen, true);
  assert.equal(shipped.prod_seen, false, 'OrderShipped was not tagged in production');
  assert.equal(shipped.provider_verified, true);

  const refunded = row('an OrderRefunded event');
  assert.equal(refunded.contracted, true, 'OrderRefunded comes from the injected pact entry');
  assert.equal(refunded.test_seen, false, 'OrderRefunded is the STALE row');
  assert.equal(refunded.provider_verified, true, 'stub provider verify covers all interactions');

  const shadow = row('an InventoryReserved event');
  assert.equal(shadow.contracted, false, 'InventoryReserved has no pact entry');
  assert.equal(shadow.test_seen, true);

  assert.equal(matrix.counts.contracted, 3);
  assert.equal(matrix.counts.test_seen, 3);
  assert.equal(matrix.counts.prod_seen, 1);
  assert.equal(matrix.counts.provider_verified, 3);
  assert.equal(matrix.counts.contracted_and_test_seen, 2);
  assert.equal(matrix.counts.contracted_not_test_seen, 1);
  assert.equal(matrix.counts.test_or_prod_seen_not_contracted, 1);
}

// ---------------------------------------------------------------------------
// Demo orchestration.
// ---------------------------------------------------------------------------

async function runDemo(): Promise<void> {
  console.log('autotel-pact demo — runtime evidence for Pact contracts (v0.2)');
  console.log('='.repeat(96));

  console.log('\n  ▶ Running 2 contracted interactions through withPactInteraction()');
  await exerciseOrderCreated();
  await exerciseOrderShipped();

  console.log('  ▶ Injecting a stale pact entry (contract exists, nothing exercised it)');
  injectStalePactFile();

  console.log('  ▶ Recording a SHADOW observation (runtime fires, no contract)');
  recordShadowObservation();

  console.log('  ▶ Running provider verification (skipVerifier: true)');
  await runProviderVerification();

  console.log('  ▶ Simulating a production span carrying pact.* tags');
  await simulateProductionObservation();

  console.log('\n  ▶ Running audit...');
  const matrix = await runAudit({ pactsDir: PACTS_DIR, dir: LEDGER_DIR });
  printMatrix(matrix);

  assertMatrix(matrix);
  console.log('\n  ▶ Matrix assertions passed.');

  console.log(
    '\nBroker: every row shows BROKER=no until you run `pnpm pact:audit:broker`',
  );
  console.log(
    '        with PACT_BROKER_BASE_URL and a token (or username/password) set.',
  );

  console.log('\nEquivalent CLI:');
  console.log('  pnpm pact:audit             # show the matrix');
  console.log('  pnpm pact:audit:gate        # fail CI if any interaction is STALE');
  console.log('  pnpm pact:audit:broker      # also require Pact Broker proof');

  await shutdown();
}

runDemo().catch((error) => {
  console.error('\nDemo failed:', error);
  process.exitCode = 1;
});
