/**
 * `pnpm kafka:up && pnpm start`: runs each scenario, prints what its spans
 * say, and writes the architecture snapshot to `.autotel/snapshot.json`.
 */
import { flush } from 'autotel';
import { disconnectProducer } from './kafka';
import {
  fanOut,
  hotPartition,
  idleConsumer,
  ordering,
  redelivery,
  retryThenDeadLetter,
} from './match-feed';
import { SNAPSHOT_FILE, startTelemetry } from './telemetry';

const { exporter, snapshot } = startTelemetry();

const short = (id: string) => id.slice(0, 8);

async function show(title: string, run: () => Promise<{ topic: string }>) {
  exporter.reset();
  const { topic } = await run();
  await flush();
  console.log(`\n${title}`);
  console.table(
    exporter
      .spans()
      .filter((span) => span.name.includes(topic))
      .map((span) => {
        const a = span.attributes;
        return {
          span: `${span.name.replace(topic, 'match-events')} ${short(span.spanId)}`,
          group: a['messaging.consumer.group.name'],
          partition: a['messaging.destination.partition.id'],
          lag: a['messaging.kafka.consumer_lag'],
          status: ['', 'ok', 'error'][span.status.code],
          flags: [
            a['messaging.ordering.out_of_order'] && 'out of order',
            a['messaging.ordering.gap_count'] && 'gap',
            a['messaging.ordering.duplicate'] && 'duplicate',
            a['messaging.retry.count'] && `retry ${a['messaging.retry.count']}`,
            a['messaging.dlq.reason'] &&
              `dlq (${a['messaging.dlq.reason_category']}): ${a['messaging.dlq.reason']}`,
          ]
            .filter(Boolean)
            .join(', '),
          links: span.links.map((link) => short(link.spanId)).join(', '),
        };
      }),
  );
}

await show('1. One goal, three consumer groups', fanOut);
await show('2a. Keyed by match: in order', () => ordering({ withKey: true }));
await show('2b. No key: the 4th event lands before the 2nd', () =>
  ordering({ withKey: false }),
);
await show('3. Retry topic, then DLQ', retryThenDeadLetter);
await show('4. Crash before commit: the goal arrives twice', redelivery);
exporter.reset();
const hot = await hotPartition();
await flush();
const backlog = new Map<unknown, { events: number; maxLag: number }>();
for (const span of exporter.findSpans(`process ${hot.topic}`)) {
  const partition = span.attributes['messaging.destination.partition.id'];
  const row = backlog.get(partition) ?? { events: 0, maxLag: 0 };
  row.events++;
  row.maxLag = Math.max(
    row.maxLag,
    Number(span.attributes['messaging.kafka.consumer_lag']),
  );
  backlog.set(partition, row);
}
console.log('\n5. The final floods one partition');
console.table(
  [...backlog]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([partition, row]) => ({ partition, ...row })),
);

exporter.reset();
const { assignments } = await idleConsumer();
console.log(
  `\n6. Four consumers, three partitions: partitions per member ${JSON.stringify(assignments)}`,
);

await disconnectProducer();
await flush();
await snapshot.writeToFile(SNAPSHOT_FILE, {
  freezeTimestamps: '2026-01-01T00:00:00.000Z',
});
console.log(`\nWrote ${SNAPSHOT_FILE}`);
