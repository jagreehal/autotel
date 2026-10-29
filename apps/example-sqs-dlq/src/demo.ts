/**
 * `pnpm ministack:up && pnpm start`: an order fails until it is dead-lettered,
 * the DLQ is inspected, payments recover, the order is replayed, and the spans
 * are printed so you can see the links between them.
 */
import { flush, init } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import { createOrderFlow, createOrderQueues, type Order } from './orders';

const exporter = createMemoryExporter();
init({ service: 'orders', spanExporters: [exporter] });

let paymentsUp = false;
const queues = await createOrderQueues(`orders-${Date.now()}`);
const flow = createOrderFlow(queues, async (_order: Order) => {
  if (!paymentsUp) throw new Error('payment provider unavailable');
});

await flow.publishOrder({ id: 'o-1', total: 42 });

let deadLetters = await flow.inspectDeadLetters();
while (deadLetters.length === 0) {
  await flow.consumeOnce();
  deadLetters = await flow.inspectDeadLetters();
}
console.log('In the DLQ:');
console.table(deadLetters);

paymentsUp = true;
console.log(`Replayed ${await flow.replayDeadLetters()} message(s)\n`);
let replayed = false;
while (!replayed) {
  await flow.consumeOnce();
  await flush();
  replayed = exporter
    .findSpans(`process ${queues.name}`)
    .some((span) => span.attributes['messaging.replay']);
}

await flush();
const short = (id: string) => id.slice(0, 8);
console.table(
  exporter.spans().map((span) => ({
    span: `${span.name.replace(queues.name, 'orders')} ${short(span.spanId)}`,
    status: ['unset', 'ok', 'error'][span.status.code],
    retry: span.attributes['messaging.retry.count'],
    dlq: span.attributes['messaging.dlq.reason'],
    replay: span.attributes['messaging.replay'],
    links: span.links
      .map(
        (link) =>
          `${short(link.spanId)}${link.attributes['messaging.link.source'] === 'dlq_replay' ? ' (dlq)' : ''}`,
      )
      .join(', '),
  })),
);
