/**
 * A live match feed on Kafka: goals, cards and substitutions published as
 * they happen, read by the scoreboard, push notifications and stats.
 *
 * Each scenario covers one behaviour an event-driven system has to handle,
 * and the spans autotel records for it.
 */
import { SpanStatusCode } from 'autotel';
import type { ConsumerContext } from 'autotel/messaging';
import type { Consumer } from 'kafkajs';
import {
  channelOf,
  consume,
  createTopics,
  headersOf,
  publish,
  valueOf,
  type Delivery,
} from './kafka';

export type MatchEvent = {
  eventId: string;
  matchId: string;
  /** Position of this event within its match. */
  seq: number;
  type: 'kickoff' | 'goal' | 'card' | 'sub' | 'full_time';
  minute: number;
};

const TYPES: MatchEvent['type'][] = ['kickoff', 'goal', 'card', 'sub', 'goal'];

export function matchEvents(matchId: string, count: number): MatchEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    eventId: `${matchId}-${index + 1}`,
    matchId,
    seq: index + 1,
    type: index === count - 1 ? 'full_time' : TYPES[index % TYPES.length]!,
    minute: Math.round(((index + 1) / count) * 90),
  }));
}

const keyed = (events: MatchEvent[]) =>
  events.map((event) => ({ key: event.matchId, value: event }));

const runId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function until(done: () => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('scenario timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const stopAll = (consumers: Consumer[]) =>
  Promise.all(consumers.map((consumer) => consumer.disconnect()));

/**
 * Fan-out. One goal, three consumer groups. Each group's CONSUMER span links
 * to the same PRODUCER span, so the producer's trace shows everyone who read
 * the event.
 */
export async function fanOut() {
  const topic = `match-events-${runId()}`;
  await createTopics(topic);
  await publish(topic, keyed([matchEvents('ARG-FRA', 2)[1]!]));

  const groups = ['scoreboard', 'notifications', 'stats'];
  const read = new Set<string>();
  const consumers = await Promise.all(
    groups.map((groupId) =>
      consume({
        groupId,
        topic,
        handle: async () => {
          read.add(groupId);
        },
      }),
    ),
  );
  await until(() => read.size === groups.length);
  await stopAll(consumers);
  return { topic, groups };
}

/**
 * Ordering. Kafka orders messages within a partition. Key by match and a
 * match's events share a partition; publish without a key and they spread
 * across partitions, so the scoreboard can apply the 4th event before the 2nd.
 * autotel tracks each match's sequence and flags the span that broke it.
 */
export async function ordering({ withKey }: { withKey: boolean }) {
  const topic = `match-events-${runId()}`;
  await createTopics(topic);
  const events = matchEvents('BRA-GER', 6);
  await publish(
    topic,
    events.map((event) => ({
      key: withKey ? event.matchId : undefined,
      value: event,
    })),
  );

  const applied: number[] = [];
  const consumer = await consume({
    groupId: 'scoreboard',
    topic,
    ordering: {
      sequenceFrom: (delivery) => valueOf<MatchEvent>(delivery).seq,
      partitionKeyFrom: (delivery) => valueOf<MatchEvent>(delivery).matchId,
      detectOutOfOrder: true,
    },
    handle: async (_ctx, delivery) => {
      applied.push(valueOf<MatchEvent>(delivery).seq);
    },
  });
  await until(() => applied.length === events.length);
  await stopAll([consumer]);
  return { topic, applied };
}

export const MAX_ATTEMPTS = 3;

/**
 * Retry topic, then DLQ. The push provider is down. The notifications
 * consumer moves a failed event to a retry topic and keeps the main topic
 * flowing; the retry consumer tries again with backoff and, after
 * MAX_ATTEMPTS, sends it to the DLQ. A malformed event goes straight to the
 * DLQ: retrying it can never succeed.
 *
 * Every hop records why on its span (`recordRetry`, `recordDLQ`), and every
 * republished message carries the trace context of the attempt that sent it.
 */
export async function retryThenDeadLetter() {
  const topic = `match-events-${runId()}`;
  const retryTopic = `${topic}.retry`;
  const dlqTopic = `${topic}.dlq`;
  await createTopics(topic, retryTopic, dlqTopic);

  const goal = matchEvents('ESP-ITA', 2)[1]!;
  const malformed = { ...goal, eventId: 'ESP-ITA-x', type: 'gaol' };
  await publish(topic, [
    { key: goal.matchId, value: goal },
    { key: goal.matchId, value: malformed },
  ]);

  const sendPush = async (event: MatchEvent) => {
    if (!['kickoff', 'goal', 'card', 'sub', 'full_time'].includes(event.type)) {
      throw new TypeError(`unknown event type '${event.type}'`);
    }
    throw new Error('push provider unavailable');
  };

  const deadLetter = (
    delivery: Delivery,
    reason: string,
    headers: Record<string, string>,
  ) =>
    publish(dlqTopic, [
      {
        key: delivery.message.key?.toString(),
        value: valueOf(delivery),
        headers: { ...headers, 'dlq.reason': reason },
      },
    ]);

  const handleAttempt = async (
    ctx: ConsumerContext,
    delivery: Delivery,
    attempt: number,
  ) => {
    const event = valueOf<MatchEvent>(delivery);
    ctx.setAttribute('match.id', event.matchId);
    try {
      await sendPush(event);
    } catch (error) {
      // SAFETY: sendPush only throws Error instances.
      const cause = error as Error;
      if (cause instanceof TypeError) {
        ctx.recordDLQ(cause.message, channelOf(dlqTopic), {
          reasonCategory: 'validation',
          attemptCount: attempt,
          originalError: cause,
        });
        await deadLetter(delivery, cause.message, {
          'retry.attempt': `${attempt}`,
        });
      } else if (attempt < MAX_ATTEMPTS) {
        ctx.recordRetry(attempt, MAX_ATTEMPTS);
        await publish(retryTopic, [
          {
            key: delivery.message.key?.toString(),
            value: event,
            headers: { 'retry.attempt': `${attempt + 1}` },
          },
        ]);
      } else {
        ctx.recordDLQ(cause.message, channelOf(dlqTopic), {
          reasonCategory: 'processing',
          attemptCount: attempt,
          originalError: cause,
        });
        await deadLetter(delivery, cause.message, {
          'retry.attempt': `${attempt}`,
        });
      }
      ctx.setStatus({ code: SpanStatusCode.ERROR, message: cause.message });
    }
  };

  const deadLetters: { eventId: string; reason: string; attempts: number }[] =
    [];
  const consumers = await Promise.all([
    consume({
      groupId: 'notifications',
      topic,
      handle: (ctx, delivery) => handleAttempt(ctx, delivery, 1),
    }),
    consume({
      groupId: 'notifications-retry',
      topic: retryTopic,
      handle: async (ctx, delivery) => {
        const attempt = Number(headersOf(delivery.message)['retry.attempt']);
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        await handleAttempt(ctx, delivery, attempt);
      },
    }),
    consume({
      groupId: 'dlq-inspector',
      topic: dlqTopic,
      handle: async (_ctx, delivery) => {
        const headers = headersOf(delivery.message);
        deadLetters.push({
          eventId: valueOf<MatchEvent>(delivery).eventId,
          reason: headers['dlq.reason']!,
          attempts: Number(headers['retry.attempt']),
        });
      },
    }),
  ]);
  await until(() => deadLetters.length === 2);
  await stopAll(consumers);
  return { topic, retryTopic, dlqTopic, deadLetters };
}

/**
 * Redelivery. The scoreboard applies a goal, then crashes before Kafka
 * commits the offset, so Kafka delivers the goal again: at-least-once. autotel
 * marks the second delivery as a duplicate; the scoreboard skips events it
 * has already applied, so the score counts the goal once.
 */
export async function redelivery() {
  const topic = `match-events-${runId()}`;
  await createTopics(topic);
  const goal = matchEvents('NED-POR', 2)[1]!;
  await publish(topic, keyed([goal]));

  const applied = new Set<string>();
  let goals = 0;
  let deliveries = 0;
  const consumer = await consume({
    groupId: 'scoreboard',
    topic,
    ordering: {
      messageIdFrom: (delivery) => valueOf<MatchEvent>(delivery).eventId,
      detectDuplicates: true,
    },
    handle: async (ctx, delivery) => {
      deliveries++;
      const event = valueOf<MatchEvent>(delivery);
      // Stands in for a unique constraint on eventId in the scoreboard's store.
      if (applied.has(event.eventId)) {
        ctx.setAttribute('scoreboard.already_applied', true);
        return;
      }
      applied.add(event.eventId);
      goals++;
      if (deliveries === 1) throw new Error('crashed before offset commit');
    },
  });
  await until(() => deliveries === 2);
  await stopAll([consumer]);
  return { topic, goals, deliveries };
}

/**
 * Hot partition. The final draws 30 events while five group games draw one
 * each. Keyed by match, the final's events all land on one partition, and the
 * consumer lag on each span shows that partition's backlog.
 */
export async function hotPartition() {
  const topic = `match-events-${runId()}`;
  await createTopics(topic);
  const final = matchEvents('FINAL', 30);
  const groupGames = ['A1', 'B1', 'C1', 'D1', 'E1'].flatMap((matchId) =>
    matchEvents(matchId, 1),
  );
  await publish(topic, keyed([...final, ...groupGames]));

  let processed = 0;
  const consumer = await consume({
    groupId: 'stats',
    topic,
    handle: async () => {
      processed++;
    },
  });
  await until(() => processed === final.length + groupGames.length);
  await stopAll([consumer]);
  return { topic };
}

/**
 * More consumers than partitions. Four scoreboard instances join a group on
 * a three-partition topic. Kafka gives each partition to one member, so one
 * instance sits idle; the group join spans show each member's assignment.
 */
export async function idleConsumer() {
  const topic = `match-events-${runId()}`;
  await createTopics(topic);
  const groupId = 'scoreboard';

  const assignments = new Map<number, number>();
  const consumers: Consumer[] = [];
  for (let instance = 0; instance < 4; instance++) {
    consumers.push(
      await consume({
        groupId,
        topic,
        traceGroupEvents: true,
        onGroupJoin: (assigned) => assignments.set(instance, assigned),
        handle: async () => {},
      }),
    );
  }
  const total = () => [...assignments.values()].reduce((a, b) => a + b, 0);
  // Settled when all four have joined the same generation.
  await until(() => assignments.size === 4 && total() === 3, 60_000);
  // Read before stopping: each member that leaves triggers another rebalance.
  const settled = [...assignments.values()];
  await stopAll(consumers);
  return { topic, groupId, assignments: settled };
}
