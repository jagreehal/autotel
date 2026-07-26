import { withTracing } from 'autotel';
import { createTraceCollector } from 'autotel/testing';

type Checkout = {
  tenant: string;
  provider: 'bank-alpha' | 'bank-beta';
  itemCount: number;
  failed: boolean;
};

const collector = createTraceCollector();
const checkout = withTracing({ name: 'checkout.submit' })(
  (ctx) => (request: Checkout) => {
    ctx.setAttributes({
      'tenant.id': request.tenant,
      'payment.provider': request.provider,
      'cart.item_count': request.itemCount,
      'checkout.failed': request.failed,
    });
  },
);

const requests: Checkout[] = [
  { tenant: 'north', provider: 'bank-alpha', itemCount: 2, failed: false },
  { tenant: 'south', provider: 'bank-beta', itemCount: 24, failed: true },
  { tenant: 'west', provider: 'bank-beta', itemCount: 31, failed: true },
  { tenant: 'east', provider: 'bank-alpha', itemCount: 4, failed: false },
];

requests.forEach(checkout);

const failures = collector
  .getSpansByAttributes({ 'checkout.failed': true })
  .map((span) => span.attributes['payment.provider']);

if (failures.length !== 2 || failures.some((value) => value !== 'bank-beta')) {
  throw new Error('Expected the failed cohort to use bank-beta');
}

console.log('OE 1: grouped an unplanned failure question by payment.provider');
console.log(`  failed requests: ${failures.length}, provider: bank-beta`);
