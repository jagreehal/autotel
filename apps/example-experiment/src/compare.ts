/**
 * Mark, change, compare.
 *
 * Runs both arms of a pricing experiment, then asks `compareCohorts` what is
 * different about the slow checkouts. The run plants one cause: `v2` sends a
 * large cart through the old FX service. The assertion at the end is the point
 * of the example — the analysis has to find that cause without being told.
 *
 * AUTOTEL_DEVTOOLS=1 also ships the spans to a local devtools, where Compare
 * offers the same two cohorts as arms of `checkout-pricing`.
 */
import assert from 'node:assert/strict';
import { init, flush } from 'autotel';
import { compareCohorts, type CohortDifference } from 'autotel/analysis';
import { createMemoryExporter } from 'autotel/testing';
import { seeded } from './collector';
import { checkout, type Plan, type Region } from './checkout';

const RUNS = 800;
const SLOW_MS = 400;

const collector = createMemoryExporter();

/** The checkout spans that survived export, as flat events to analyse. */
const checkoutEvents = () =>
  collector.findSpans('checkout').map((span) => span.attributes);

init({
  service: 'checkout-api',
  // Every trace, because this run is the analysis. keep.ts turns sampling on.
  sampling: 'development',
  spanExporters: [collector],
  devtools: process.env.AUTOTEL_DEVTOOLS === '1',
});

const plans: Plan[] = ['free', 'pro', 'enterprise'];
const regions: Region[] = ['uk', 'us', 'eu'];

async function main() {
  const random = seeded(42);

  for (let i = 0; i < RUNS; i++) {
    await checkout({
      // Both arms get the same traffic, which is what makes them comparable.
      variant: i % 2 === 0 ? 'v1' : 'v2',
      cartItems: 1 + Math.floor(random() * 60),
      plan: plans[Math.floor(random() * plans.length)]!,
      region: regions[Math.floor(random() * regions.length)]!,
      roll: random(),
    });
  }

  await flush();

  const events = checkoutEvents();
  const slow = events.filter((e) => Number(e['checkout.latency_ms']) > SLOW_MS);
  const normal = events.filter(
    (e) => Number(e['checkout.latency_ms']) <= SLOW_MS,
  );

  const differences = compareCohorts({
    outlier: slow,
    baseline: normal,
    // The latency fields define the two cohorts, so they separate them
    // perfectly and say nothing about why. devtools leaves the experiment
    // fields out of an arm comparison for the same reason.
    ignoreFields: ['checkout.latency', 'checkout.latency_ms'],
  });

  console.log(
    `\n${events.length} checkouts, ${slow.length} slower than ${SLOW_MS}ms\n`,
  );
  console.log('What is different about the slow ones:\n');
  for (const d of differences.slice(0, 6)) {
    console.log(
      `  ${`${d.field}=${d.value}`.padEnd(38)} ` +
        `${pct(d.outlierFraction)} of slow, ${pct(d.baselineFraction)} of normal`,
    );
  }
  console.log('\nA hypothesis, to be confirmed against individual traces.\n');

  // The analysis found the planted cause.
  const top = differences.slice(0, 3).map(key);
  assert.ok(
    top.includes('fx.provider=legacy-fx'),
    `expected fx.provider=legacy-fx in the top 3, got ${top.join(', ')}`,
  );
  assert.ok(
    top.includes('experiment.variant=v2'),
    `expected experiment.variant=v2 in the top 3, got ${top.join(', ')}`,
  );

  // And skipped the raw count, which is why bucket() exists: a value that
  // never repeats cannot describe a group.
  assert.ok(
    !differences.some(
      (d) => d.field === 'checkout.latency_ms' || d.field === 'cart.items',
    ),
    'raw numeric fields should be skipped, not ranked',
  );
  assert.ok(
    differences.some((d) => d.field === 'cart.size'),
    'the bucketed cart size should be rankable',
  );

  console.log(
    'Assertions passed: the planted cause ranked, the raw counts did not.',
  );
}

const key = (d: CohortDifference) => `${d.field}=${d.value}`;
const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;

await main();
