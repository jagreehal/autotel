// Chapter 5 builds a tracer out of log lines. A log records that something
// happened. Add the fields you care about and it becomes the working record of
// one request. Add a trace ID, a span ID, and a parent span ID and it becomes a
// span, because now it knows what it ran inside of. Autotel hands you the third
// rung. This runs all three so you can see which field does the work at each
// step.

import { span, withTracing } from 'autotel';
import { createTraceCollector } from 'autotel/testing';

const collector = createTraceCollector();

const checkout = withTracing({ name: 'checkout.submit' })(
  (ctx) => async (order: { id: string; tenant: string; items: number }) => {
    // Rung 2: the record widens while the request runs. Each stage adds what
    // it knows, and the whole thing lands as one event instead of six lines.
    ctx.setAttributes({
      'order.id': order.id,
      'tenant.id': order.tenant,
      'cart.item_count': order.items,
    });

    // Rung 3: the nested call inherits the trace without being handed it.
    await span('payment.authorize', () => Promise.resolve('approved'));
  },
);

await checkout({ id: 'ord_9f3', tenant: 'north', items: 3 });

const root = collector.expectSpan('checkout.submit');
const [payment] = collector.getDescendants(root.spanId);

if (payment?.traceId !== root.traceId || payment.parentSpanId !== root.spanId) {
  throw new Error('payment.authorize did not join the checkout trace');
}

// Rung 1, for contrast: the same moment as a log line, carrying nothing that
// connects it to the rest of the request.
const business = ['order.id', 'tenant.id', 'cart.item_count'].map(
  (key) => `${key}=${root.attributes[key]}`,
);

console.log('OE 5: one checkout, told three ways');
console.log(`  log:   ${JSON.stringify({ msg: 'checkout complete' })}`);
console.log(`  event: ${business.join(' ')}`);
console.log(`  span:  ${payment.name} runs inside ${root.name}, same trace`);
console.log(
  '  only the third one answers "what else ran slowly in this request?"',
);
