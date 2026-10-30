/**
 * Runs against Kafka (`pnpm kafka:up`). Skipped unless KAFKA_BROKER is set,
 * so `pnpm test:integration` across the monorepo needs no Docker.
 */
import { SpanStatusCode, flush } from 'autotel';
import type { RecordedSpan } from 'autotel/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { EVENT, disconnectProducer } from './kafka';
import {
  MAX_ATTEMPTS,
  fanOut,
  hotPartition,
  idleConsumer,
  ordering,
  redelivery,
  retryThenDeadLetter,
} from './match-feed';
import { startTelemetry } from './telemetry';

let exporter: ReturnType<typeof startTelemetry>['exporter'];
let snapshot: ReturnType<typeof startTelemetry>['snapshot'];

async function spans(name: string): Promise<RecordedSpan[]> {
  await flush();
  return exporter.findSpans(name);
}

describe.skipIf(!process.env.KAFKA_BROKER)(
  'match feed on Kafka',
  () => {
    ({ exporter, snapshot } = startTelemetry());
    afterAll(() => disconnectProducer());

    it('links every consumer group to the one event they read', async () => {
      const { topic, groups } = await fanOut();

      const [publish] = await spans(`publish ${topic}`);
      const reads = await spans(`process ${topic}`);
      expect(
        reads
          .map((span) => span.attributes['messaging.consumer.group.name'])
          .sort(),
      ).toEqual([...groups].sort());
      for (const read of reads) {
        expect(read.links).toEqual([
          expect.objectContaining({
            traceId: publish!.traceId,
            spanId: publish!.spanId,
          }),
        ]);
      }
    });

    it('keeps a match in order when keyed by match', async () => {
      const { topic, applied } = await ordering({ withKey: true });

      expect(applied).toEqual([1, 2, 3, 4, 5, 6]);
      for (const span of await spans(`process ${topic}`)) {
        expect(
          span.attributes['messaging.ordering.out_of_order'],
        ).toBeUndefined();
      }
    });

    it('flags the event that broke a match’s order when published without a key', async () => {
      const { topic, applied } = await ordering({ withKey: false });

      const partitions = new Set(
        (await spans(`publish ${topic}`)).map(
          (span) => span.attributes['messaging.destination.partition.id'],
        ),
      );
      expect(partitions.size).toBeGreaterThan(1);
      expect(applied).not.toEqual([1, 2, 3, 4, 5, 6]);
      const flagged = (await spans(`process ${topic}`)).filter(
        (span) => span.attributes['messaging.ordering.out_of_order'],
      );
      expect(flagged.length).toBeGreaterThan(0);
      expect(flagged[0]!.attributes['messaging.message.partition_key']).toBe(
        'BRA-GER',
      );
    });

    it('records each retry and why each event reached the DLQ', async () => {
      const { topic, retryTopic, dlqTopic, deadLetters } =
        await retryThenDeadLetter();

      expect(deadLetters).toEqual(
        expect.arrayContaining([
          {
            eventId: 'ESP-ITA-x',
            reason: "unknown event type 'gaol'",
            attempts: 1,
          },
          {
            eventId: 'ESP-ITA-2',
            reason: 'push provider unavailable',
            attempts: MAX_ATTEMPTS,
          },
        ]),
      );

      const first = await spans(`process ${topic}`);
      expect(
        first.find((span) => span.attributes['messaging.retry.count'] === 1),
      ).toBeDefined();
      expect(
        first.find(
          (span) =>
            span.attributes['messaging.dlq.reason_category'] === 'validation',
        )?.attributes,
      ).toMatchObject({
        'messaging.dlq.name': 'match-events.dlq',
        'messaging.dlq.error.type': 'TypeError',
      });

      const retries = await spans(`process ${retryTopic}`);
      expect(
        retries.map((span) => span.attributes['messaging.retry.count']),
      ).toContain(2);
      const gaveUp = retries.find(
        (span) =>
          span.attributes['messaging.dlq.reason_category'] === 'processing',
      )!;
      expect(gaveUp.attributes).toMatchObject({
        'messaging.dlq.attempt_count': MAX_ATTEMPTS,
        'messaging.dlq.reason': 'push provider unavailable',
      });
      expect(gaveUp.status.code).toBe(SpanStatusCode.ERROR);

      // The dead letter carries the trace of the attempt that gave up.
      const dlqPublishes = (await spans(`publish ${dlqTopic}`)).filter(
        (span) => span.traceId === gaveUp.traceId,
      );
      expect(dlqPublishes).toHaveLength(1);
      const inspected = await spans(`process ${dlqTopic}`);
      expect(
        inspected.some((span) =>
          span.links.some((link) => link.spanId === dlqPublishes[0]!.spanId),
        ),
      ).toBe(true);
    });

    it('marks a redelivered goal as a duplicate and counts it once', async () => {
      const { topic, goals, deliveries } = await redelivery();

      expect({ goals, deliveries }).toEqual({ goals: 1, deliveries: 2 });
      const [crashed, redelivered] = await spans(`process ${topic}`);
      expect(crashed!.status.code).toBe(SpanStatusCode.ERROR);
      expect(
        crashed!.attributes['messaging.ordering.duplicate'],
      ).toBeUndefined();
      expect(redelivered!.attributes).toMatchObject({
        'messaging.ordering.duplicate': true,
        'scoreboard.already_applied': true,
      });
    });

    it('shows the backlog on the partition a big match lands on', async () => {
      const { topic } = await hotPartition();

      const hot = (await spans(`publish ${topic}`)).find(
        (span) => span.attributes['messaging.kafka.message.key'] === 'FINAL',
      )!.attributes['messaging.destination.partition.id'];
      const maxLag = new Map<unknown, number>();
      for (const span of await spans(`process ${topic}`)) {
        const partition = span.attributes['messaging.destination.partition.id'];
        const lag = Number(span.attributes['messaging.kafka.consumer_lag']);
        maxLag.set(partition, Math.max(maxLag.get(partition) ?? 0, lag));
      }
      expect(maxLag.get(hot)).toBeGreaterThanOrEqual(29);
      for (const [partition, lag] of maxLag) {
        if (partition !== hot) expect(lag).toBeLessThanOrEqual(4);
      }
    });

    it('records in the snapshot who read each event and what happened to it', async () => {
      await flush();
      const event = snapshot.toSnapshot().events[EVENT]!;
      const consumer = (name: string, channel = 'match-events') =>
        event.observedConsumers?.find(
          (entry) => entry.consumer === name && entry.channel === channel,
        );

      expect(event.sources?.map((source) => source.channel)).toEqual([
        'match-events',
        'match-events.dlq',
        'match-events.retry',
      ]);
      expect(consumer('stats')).toBeDefined();
      expect(consumer('notifications')).toMatchObject({
        failed: 2,
        retried: 1,
        deadLettered: 1,
        deadLetterReasons: [
          {
            reason: "unknown event type 'gaol'",
            category: 'validation',
            queue: 'match-events.dlq',
            count: 1,
          },
        ],
      });
      expect(
        consumer('notifications-retry', 'match-events.retry'),
      ).toMatchObject({
        failed: MAX_ATTEMPTS - 1,
        retried: MAX_ATTEMPTS - 2,
        deadLettered: 1,
        deadLetterReasons: [
          {
            reason: 'push provider unavailable',
            category: 'processing',
            queue: 'match-events.dlq',
            count: 1,
          },
        ],
      });
      expect(consumer('dlq-inspector', 'match-events.dlq')?.count).toBe(2);
    });

    it('shows the group member left without a partition', async () => {
      const { assignments } = await idleConsumer();

      expect(assignments.sort()).toEqual([0, 1, 1, 1]);
      const joins = await spans('kafka.consumer.consumer.group_join');
      expect(
        joins.some(
          (span) =>
            span.attributes['messaging.kafka.consumer.assignment_count'] === 0,
        ),
      ).toBe(true);
    });
  },
  120_000,
);
