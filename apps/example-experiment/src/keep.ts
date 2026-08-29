/**
 * The trace you cannot afford to lose.
 *
 * Same checkout, but with production sampling on: a 10% baseline, errors kept.
 * A declined payment is not an error — the request succeeded and returned bad
 * news — so the sampler has no reason to keep it. `forceKeep()` does.
 */
import assert from 'node:assert/strict';
import { init, flush } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import { seeded } from './collector';
import { checkout, type Plan, type Region } from './checkout';

const RUNS = 600;

const collector = createMemoryExporter();

/** The checkout spans that survived export, as flat events to analyse. */
const checkoutEvents = () =>
  collector.findSpans('checkout').map((span) => span.attributes);

init({
  // 10% of traces, plus every error, plus anything slow. The tail decision is
  // made after the request finishes, which is the right time to make it, and
  // it governs every function the app wraps.
  service: 'checkout-api',
  sampling: 'production',
  spanExporters: [collector],
});

const plans: Plan[] = ['free', 'pro', 'enterprise'];
const regions: Region[] = ['uk', 'us', 'eu'];

async function main() {
  const random = seeded(7);
  let declined = 0;
  let paid = 0;

  for (let i = 0; i < RUNS; i++) {
    const result = await checkout({
      variant: i % 2 === 0 ? 'v1' : 'v2',
      cartItems: 1 + Math.floor(random() * 60),
      plan: plans[Math.floor(random() * plans.length)]!,
      region: regions[Math.floor(random() * regions.length)]!,
      roll: random(),
    });
    if (result.status === 'declined') declined++;
    else paid++;
  }

  await flush();

  const exported = checkoutEvents();
  const exportedDeclined = exported.filter(
    (e) => e['payment.status'] === 'declined',
  ).length;
  const exportedPaid = exported.length - exportedDeclined;

  console.log(`\n${RUNS} checkouts: ${paid} paid, ${declined} declined`);
  console.log(
    `Exported after sampling: ${exportedPaid} paid, ${exportedDeclined} declined\n`,
  );

  // Every declined payment survived, whatever the sampler concluded.
  assert.equal(
    exportedDeclined,
    declined,
    `forceKeep() should keep all ${declined} declined traces, kept ${exportedDeclined}`,
  );

  // The successful ones were sampled, which is what makes always-on affordable.
  assert.ok(
    exportedPaid < paid * 0.25,
    `expected the paid traces to be sampled down, kept ${exportedPaid} of ${paid}`,
  );

  console.log('Assertions passed: every decline kept, the rest sampled.');
}

await main();
