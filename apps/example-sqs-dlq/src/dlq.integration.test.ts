/**
 * Runs against MiniStack (`pnpm ministack:up`). Skipped unless SQS_ENDPOINT is
 * set, so `pnpm test:integration` across the monorepo needs no Docker.
 */
import { flush, init } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import {
  GetQueueAttributesCommand,
  SendMessageBatchCommand,
} from '@aws-sdk/client-sqs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createOrderFlow,
  createOrderQueues,
  MAX_ATTEMPTS,
  sqs,
  type Order,
} from './orders';

const exporter = createMemoryExporter();

describe.skipIf(!process.env.SQS_ENDPOINT)('SQS DLQ replay', () => {
  beforeAll(() => {
    init({ service: 'orders', spanExporters: [exporter] });
  });

  it('records why a message was dead-lettered and links the replay to it', async () => {
    let paymentsUp = false;
    const queues = await createOrderQueues(`orders-${Date.now()}`);
    const flow = createOrderFlow(queues, async (_order: Order) => {
      if (!paymentsUp) throw new Error('payment provider unavailable');
    });

    await flow.publishOrder({ id: 'o-1', total: 42 });
    await flush();
    const publish = exporter.findSpan(`publish ${queues.name}`)!;

    // Payments are down: every attempt fails and the last one dead-letters.
    await expect
      .poll(
        async () => {
          await flow.consumeOnce();
          return flow.inspectDeadLetters();
        },
        { timeout: 20_000, interval: 500 },
      )
      .toEqual([
        {
          orderId: 'o-1',
          reason: 'payment provider unavailable',
          attempts: MAX_ATTEMPTS,
          traceId: publish.traceId,
        },
      ]);

    await flush();
    const attempts = exporter.findSpans(`process ${queues.name}`);
    expect(attempts).toHaveLength(MAX_ATTEMPTS);
    for (const span of attempts) {
      expect(span.status.code).toBe(2); // ERROR
      expect(span.links[0]).toMatchObject({
        traceId: publish.traceId,
        spanId: publish.spanId,
      });
    }
    const gaveUp = attempts.at(-1)!;
    expect(gaveUp.attributes).toMatchObject({
      'messaging.dlq.name': queues.dlqName,
      'messaging.dlq.reason': 'payment provider unavailable',
      'messaging.dlq.reason_category': 'processing',
      'messaging.dlq.attempt_count': MAX_ATTEMPTS,
      'messaging.dlq.error.type': 'Error',
      'messaging.dlq.producer_trace_id': publish.traceId,
    });

    // Payments recover; replay the dead letter.
    paymentsUp = true;
    expect(await flow.replayDeadLetters()).toBe(1);
    exporter.reset();
    await expect
      .poll(
        async () => {
          await flow.consumeOnce();
          await flush();
          return exporter.findSpan(`process ${queues.name}`);
        },
        { timeout: 10_000, interval: 500 },
      )
      .toBeDefined();

    const replay = exporter.findSpan(`process ${queues.name}`)!;
    expect(replay.status.code).not.toBe(2);
    expect(replay.attributes).toMatchObject({
      'messaging.replay': true,
      'messaging.replay.attempt': 1,
    });
    expect(replay.attributes['messaging.replay.dwell_time_ms']).toBeGreaterThan(
      0,
    );
    // Still linked to the original producer, and now to the span that gave up.
    expect(replay.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          traceId: publish.traceId,
          spanId: publish.spanId,
        }),
        expect.objectContaining({
          traceId: gaveUp.traceId,
          spanId: gaveUp.spanId,
          attributes: { 'messaging.link.source': 'dlq_replay' },
        }),
      ]),
    );
    expect(await flow.inspectDeadLetters()).toEqual([]);
  }, 60_000);

  it('replays more dead letters than one receive returns', async () => {
    const queues = await createOrderQueues(`orders-${Date.now()}`);
    const flow = createOrderFlow(queues, async () => {});
    const ids = Array.from({ length: 11 }, (_, index) => `o-${index}`);
    for (const batch of [ids.slice(0, 10), ids.slice(10)]) {
      await sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: queues.dlqUrl,
          Entries: batch.map((id) => ({
            Id: id,
            MessageBody: JSON.stringify({ id, total: 1 }),
          })),
        }),
      );
    }

    expect(await flow.replayDeadLetters()).toBe(11);

    const { Attributes } = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queues.queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    expect(Attributes?.ApproximateNumberOfMessages).toBe('11');
    expect(await flow.inspectDeadLetters()).toEqual([]);
  }, 30_000);
});
