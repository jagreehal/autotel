import { withTracing } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
import { compareCohorts } from 'autotel/analysis';

// Checkout latency rose at 14:05. Nobody knows which requests are affected.
// Record the dimensions you might want to split by, then let the loop rank them.
const collector = createTraceCollector();

const observeCheckout = withTracing({ name: 'checkout.observe' })(
  (ctx) =>
    (attributes: {
      provider: string;
      region: string;
      tier: string;
      durationMs: number;
    }) => {
      ctx.setAttributes({
        'payment.provider': attributes.provider,
        'cloud.region': attributes.region,
        'customer.tier': attributes.tier,
        'checkout.duration_ms': attributes.durationMs,
      });
    },
);

// Normal traffic spread across providers, regions, and tiers.
for (let i = 0; i < 60; i++) {
  observeCheckout({
    provider: i % 3 === 0 ? 'bank-beta' : 'bank-alpha',
    region: i % 2 === 0 ? 'eu-west-1' : 'us-east-1',
    tier: i % 4 === 0 ? 'enterprise' : 'standard',
    durationMs: 280 + (i % 5) * 20,
  });
}

// The regression: every slow request went through bank-beta.
for (let i = 0; i < 20; i++) {
  observeCheckout({
    provider: 'bank-beta',
    region: i % 2 === 0 ? 'eu-west-1' : 'us-east-1',
    tier: i % 4 === 0 ? 'enterprise' : 'standard',
    durationMs: 1_100 + (i % 4) * 90,
  });
}

// Step 1: split the population on the user-visible symptom.
const events = collector
  .getSpans()
  .map((span) => span.attributes as Record<string, unknown>);
const isSlow = (event: Record<string, unknown>) =>
  Number(event['checkout.duration_ms']) >= 800;

const slow = events.filter(isSlow);
const normal = events.filter((event) => !isSlow(event));

// Step 2: ask which recorded field separates the two groups.
const ranked = compareCohorts({ outlier: slow, baseline: normal });
const [top] = ranked;

if (top?.field !== 'payment.provider' || top.value !== 'bank-beta') {
  throw new Error('The analysis loop did not surface the payment provider');
}

console.log('OE 8: start wide, split on the symptom, rank the differences');
for (const difference of ranked.slice(0, 3)) {
  const outlier = (difference.outlierFraction * 100).toFixed(0);
  const baseline = (difference.baselineFraction * 100).toFixed(0);
  console.log(
    `  ${difference.field}=${difference.value}: ${outlier}% of slow vs ${baseline}% of normal`,
  );
}
console.log('  hypothesis: bank-beta accounts for the latency regression');
console.log('  next: open two traces from that cohort before assigning cause');
