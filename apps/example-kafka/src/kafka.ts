/**
 * KafkaJS with autotel: one PRODUCER span per published event, one CONSUMER
 * span per processed event, linked through the `traceparent` header.
 */
import { track } from 'autotel';
import type { EventAttributes } from 'autotel/event-subscriber';
import {
  traceConsumer,
  traceProducer,
  type ConsumerContext,
  type OrderingConfig,
} from 'autotel/messaging';
import { instrumentConsumerEvents } from 'autotel-kafka';
import { Kafka, logLevel, type Consumer, type KafkaMessage } from 'kafkajs';

export const kafka = new Kafka({
  clientId: 'match-feed',
  brokers: [process.env.KAFKA_BROKER ?? 'localhost:9092'],
  logLevel: logLevel.NOTHING,
});

export const PARTITIONS = 3;

/** The service that publishes the feed, as the snapshot and catalog name it. */
export const SERVICE = 'match-feed';

/** The event every publish records, named as the catalog names it. */
export const EVENT = 'match.event_recorded';

/**
 * The channel a topic belongs to. Each scenario writes to its own topic,
 * `match-events-<run>` or `match-events-<run>.retry`, and every run's copy is
 * the one channel `match-events` or `match-events.retry`.
 */
export const channelOf = (topic: string) =>
  topic.replace(/-\d+-[a-z0-9]+(?=\.|$)/, '');

/** One message as the consumer sees it, with its partition's end offset. */
export interface Delivery {
  topic: string;
  partition: number;
  message: KafkaMessage;
  highWatermark: string;
}

export interface Published {
  key?: string;
  value: EventAttributes;
  headers?: Record<string, string>;
}

export async function createTopics(...topics: string[]) {
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({
    topics: topics.map((topic) => ({ topic, numPartitions: PARTITIONS })),
    waitForLeaders: true,
  });
  await admin.disconnect();
}

export function headersOf(message: KafkaMessage) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(message.headers ?? {})) {
    if (value !== undefined) headers[key] = value.toString();
  }
  return headers;
}

export function valueOf<T>(delivery: Delivery): T {
  // SAFETY: every producer in this example writes JSON from `publish`.
  return JSON.parse(delivery.message.value!.toString()) as T;
}

const producer = kafka.producer({ idempotent: true });
let connected: Promise<void> | undefined;

/**
 * Publish events to a topic, each under its own PRODUCER span. Each one is
 * tracked inside that span, so the architecture snapshot can match every
 * consumer that reads it to this exact message.
 */
export async function publish(topic: string, events: Published[]) {
  connected ??= producer.connect();
  await connected;
  const channel = channelOf(topic);
  const send = traceProducer({ system: 'kafka', destination: topic })(
    (ctx) => async (event: Published) => {
      ctx.setAttribute('messaging.destination.template', channel);
      if (event.key) ctx.setAttribute('messaging.kafka.message.key', event.key);
      track(EVENT, {
        ...event.value,
        _autotel: { producer: SERVICE, channel },
      });
      const [result] = await producer.send({
        topic,
        messages: [
          {
            key: event.key,
            value: JSON.stringify(event.value),
            // The event's own headers, then this span's trace context.
            headers: { ...event.headers, ...ctx.getAllPropagationHeaders() },
          },
        ],
      });
      ctx.setAttribute(
        'messaging.destination.partition.id',
        String(result!.partition),
      );
    },
  );
  for (const event of events) await send(event);
}

export async function disconnectProducer() {
  if (connected) await producer.disconnect();
  connected = undefined;
}

export interface ConsumeOptions {
  groupId: string;
  topic: string;
  handle: (ctx: ConsumerContext, delivery: Delivery) => Promise<void>;
  ordering?: OrderingConfig<Delivery>;
  /** Record group joins and rebalances as spans. */
  traceGroupEvents?: boolean;
  /** Called with the number of partitions this member holds after each join. */
  onGroupJoin?: (assignedPartitions: number) => void;
}

/**
 * Run a consumer that commits an offset only after its handler succeeds. A
 * handler that throws leaves the offset where it was, so KafkaJS delivers the
 * message again: at-least-once.
 */
export async function consume(options: ConsumeOptions): Promise<Consumer> {
  const consumer = kafka.consumer({
    groupId: options.groupId,
    retry: { initialRetryTime: 100, retries: 5 },
  });
  if (options.traceGroupEvents) {
    instrumentConsumerEvents(consumer, { mode: 'spans' });
  }
  const { onGroupJoin } = options;
  if (onGroupJoin) {
    consumer.on(consumer.events.GROUP_JOIN, ({ payload }) =>
      onGroupJoin(Object.values(payload.memberAssignment).flat().length),
    );
  }
  const process = traceConsumer<Delivery>({
    system: 'kafka',
    destination: options.topic,
    consumerGroup: options.groupId,
    headersFrom: (delivery) => headersOf(delivery.message),
    lagMetrics: {
      getPartition: (delivery) => delivery.partition,
      getCurrentOffset: (delivery) => Number(delivery.message.offset),
      // Lag: messages in this partition still waiting after this one.
      getEndOffset: (delivery) => Number(delivery.highWatermark),
    },
    ordering: options.ordering,
  })((ctx) => (delivery: Delivery) => {
    ctx.setAttribute(
      'messaging.destination.template',
      channelOf(options.topic),
    );
    return options.handle(ctx, delivery);
  });

  await consumer.connect();
  await consumer.subscribe({ topic: options.topic, fromBeginning: true });
  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning }) => {
      for (const message of batch.messages) {
        if (!isRunning()) return;
        await process({
          topic: batch.topic,
          partition: batch.partition,
          message,
          highWatermark: batch.highWatermark,
        });
        resolveOffset(message.offset);
        await heartbeat();
      }
    },
  });
  return consumer;
}
