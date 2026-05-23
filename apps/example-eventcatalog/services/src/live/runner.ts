// Live runner: starts an HTTP+SSE server and fires synthetic checkouts on a
// realistic cadence so the dashboard at http://localhost:4000 shows live
// updates. After 30 seconds it introduces a new field into the recommendation
// payload to demonstrate drift appearing in real time.
//
// Run: pnpm services:live

import { init } from 'autotel';
import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';

import { placeOrder } from '../orders/index';
import { handleOrderPlaced, setStripeStub } from '../payments/index';
import { handlePaymentCaptured } from '../inventory/index';
import { generateRecommendation } from '../recommendations/index';
import type { PlaceOrderInput, OrderPlacedMessage } from '../shared/types';

import { LiveStreamSubscriber } from './stream';
import { startLiveServer } from './server';
import { attachRecorder, replay } from './replay';

const PORT = Number(process.env.PORT ?? 4000);
const CHECKOUT_INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 1200);
const FAILURE_RATE = Number(process.env.FAILURE_RATE ?? 0.18);
const DRIFT_INTRODUCE_AFTER_MS = Number(process.env.DRIFT_AFTER_MS ?? 25_000);
const RECORD_PATH = process.env.RECORD_PATH; // capture session to disk
const REPLAY_PATH = process.env.REPLAY_PATH; // play a recorded session back
const REPLAY_SPEED = Number(process.env.REPLAY_SPEED ?? 1);

const snapshot = new ArchitectureSnapshotSubscriber({ service: 'example-eventcatalog' });
const stream = new LiveStreamSubscriber();

init({
  service: 'example-eventcatalog',
  subscribers: [snapshot, stream],
});

let driftIntroduced = false;
let runId = 0;

function newOrder(): PlaceOrderInput {
  runId += 1;
  const total = 4999 + Math.floor(Math.random() * 9000);
  const itemCount = 1 + Math.floor(Math.random() * 3);
  const items = Array.from({ length: itemCount }, (_, i) => ({
    sku: `sku-${100 + i}`,
    quantity: 1,
    priceCents: Math.floor(total / itemCount),
  }));
  return {
    id: `order-live-${runId}`,
    customerId: `customer-${Math.floor(Math.random() * 200)}`,
    totalCents: total,
    currency: 'GBP',
    items,
    shipping: { addressId: `addr_${Math.floor(Math.random() * 100)}` },
    metadata: { source: Math.random() < 0.6 ? 'web' : 'mobile' },
  };
}

function configurePayments(): void {
  // Replace the stripe stub so a configurable share of captures fail.
  setStripeStub({
    charges: {
      create: async () => {
        if (Math.random() < FAILURE_RATE) {
          return {
            status: 'declined',
            declineCode: pickDeclineCode(),
            soft: Math.random() < 0.6,
          } as const;
        }
        return {
          status: 'succeeded',
          pspTransactionId: 'ch_' + Math.random().toString(36).slice(2, 10),
        } as const;
      },
    },
  });
}

function pickDeclineCode(): string {
  const codes = ['insufficient_funds', 'card_declined', 'expired_card', 'fraud_suspected'];
  return codes[Math.floor(Math.random() * codes.length)];
}

function maybeIntroduceDrift(startedAt: number): void {
  if (driftIntroduced) return;
  if (Date.now() - startedAt < DRIFT_INTRODUCE_AFTER_MS) return;
  driftIntroduced = true;
  process.stdout.write(
    '\n[runner] introducing a new field `_drift_demo_field` into recommendation payloads — drift should appear on the dashboard within a few seconds\n\n',
  );
  patchRecommendationToIntroduceDrift();
}

function patchRecommendationToIntroduceDrift(): void {
  // The recommendation service module is already loaded; we monkey-patch its
  // internal openai stub via a module-level export. For a demo this is enough:
  // the next track('recommendation.generated', ...) call will include the new
  // field, and the drift report will surface it.
  globalThis.__autotel_demo_extra_recommendation_field__ = true;
}

async function walkHappyPath(order: PlaceOrderInput): Promise<void> {
  await placeOrder(order);
  const msg: OrderPlacedMessage = { type: 'OrderPlaced', ...order };
  await Promise.all([handleOrderPlaced(msg), generateRecommendation(msg)]);
  await handlePaymentCaptured({ orderId: order.id, items: order.items });
}

async function tick(): Promise<void> {
  const order = newOrder();
  try {
    await walkHappyPath(order);
  } catch (err) {
    process.stderr.write(`[runner] tick failed: ${(err as Error).message}\n`);
  }
}

async function main() {
  configurePayments();

  const controls = {
    triggerDrift: () => {
      driftIntroduced = true;
      patchRecommendationToIntroduceDrift();
      process.stdout.write('\n[runner] demo control: drift triggered\n');
    },
    clearDrift: async () => {
      driftIntroduced = false;
      (globalThis as { __autotel_demo_extra_recommendation_field__?: boolean })
        .__autotel_demo_extra_recommendation_field__ = false;
      snapshot.reset();
      process.stdout.write('\n[runner] demo control: drift cleared, snapshot reset\n');
    },
    burst: async () => {
      process.stdout.write('\n[runner] demo control: bursting 8 checkouts\n');
      const orders = Array.from({ length: 8 }, () => newOrder());
      // Parallel fire so the dashboard sees particles overlap.
      await Promise.allSettled(orders.map(walkHappyPath));
    },
  };

  // Optional file recorder — every event the live stream emits also appends
  // to a JSONL file, so a session can be replayed deterministically later.
  let stopRecorder: (() => Promise<void>) | undefined;
  if (RECORD_PATH) {
    stopRecorder = await attachRecorder(stream, RECORD_PATH);
    process.stdout.write(`[runner] recording events to ${RECORD_PATH}\n`);
  }

  const stopServer = await startLiveServer({ port: PORT, snapshot, stream, controls });

  const startedAt = Date.now();
  process.stdout.write(
    [
      '',
      '  autotel commerce — live runner',
      `  ────────────────────────────────────────────────────`,
      `  dashboard:        http://localhost:${PORT}`,
      `  snapshot.json:    http://localhost:${PORT}/snapshot.json`,
      `  drift.json:       http://localhost:${PORT}/drift.json`,
      `  drift.md:         http://localhost:${PORT}/drift.md`,
      '',
      REPLAY_PATH
        ? `  REPLAY MODE — looping ${REPLAY_PATH} at ${REPLAY_SPEED}x speed`
        : `  firing one checkout every ${CHECKOUT_INTERVAL_MS}ms`,
      REPLAY_PATH
        ? '  (live ticker disabled; events come from the recorded session)'
        : `  payment failure rate: ${(FAILURE_RATE * 100).toFixed(0)}%`,
      REPLAY_PATH
        ? ''
        : `  schema drift will be introduced after ${(DRIFT_INTRODUCE_AFTER_MS / 1000).toFixed(0)}s`,
      '',
      '  Ctrl+C to stop. The dashboard will keep its last state.',
      '',
    ].join('\n'),
  );

  let ticker: NodeJS.Timeout | undefined;
  if (REPLAY_PATH) {
    // Replay loop runs detached; errors are surfaced to stderr but don't
    // crash the server.
    void replay(REPLAY_PATH, snapshot, stream, {
      loop: true,
      speed: REPLAY_SPEED,
    }).catch((err) => {
      process.stderr.write(`[runner] replay failed: ${(err as Error).message}\n`);
    });
  } else {
    ticker = setInterval(() => {
      maybeIntroduceDrift(startedAt);
      void tick();
    }, CHECKOUT_INTERVAL_MS);
  }

  const shutdown = async () => {
    if (ticker) clearInterval(ticker);
    if (stopRecorder) await stopRecorder();
    await stopServer();
    process.stdout.write('\n[runner] stopped\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[runner] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
