# Kafka match feed

A live match feed on Kafka. The producer publishes goals, cards and
substitutions as they happen, and three consumer groups read them: the
scoreboard, push notifications and stats. Six scenarios each cover one Kafka
behaviour that event-driven systems have to handle. For each one, the spans
autotel records answer the question you'd ask while debugging it.

```bash
pnpm install
pnpm kafka:up      # apache/kafka:4.4.0 on localhost:9092
pnpm start
```

The code is in [`src/match-feed.ts`](./src/match-feed.ts), with the KafkaJS
wiring in [`src/kafka.ts`](./src/kafka.ts).

| Scenario                 | Kafka behaviour                       | What the spans show                                                                                |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1. Fan-out               | Each consumer group reads every event | All three groups' CONSUMER spans link to the one PRODUCER span                                     |
| 2. Ordering              | Order holds within a partition only   | `messaging.ordering.out_of_order` on each event that arrived after a later one, with its match key |
| 3. Retry topic, then DLQ | Kafka has no consumer retries         | `messaging.retry.count` per attempt; `messaging.dlq.*` with reason, category and attempts          |
| 4. Redelivery            | At-least-once delivery                | `messaging.ordering.duplicate` on the second delivery                                              |
| 5. Hot partition         | One key, one partition                | `messaging.kafka.consumer_lag` per partition                                                       |
| 6. Idle consumer         | One consumer per partition in a group | Group join spans with each member's `assignment_count`                                             |

## How the spans follow the Kafka conventions

The spans use the OpenTelemetry
[Kafka semantic conventions](https://opentelemetry.io/docs/specs/semconv/messaging/kafka/):

- A PRODUCER span `publish <topic>` per event, with
  `messaging.destination.name`, `messaging.destination.partition.id` and
  `messaging.kafka.message.key`.
- A CONSUMER span `process <topic>` per event, with
  `messaging.consumer.group.name`, `messaging.destination.partition.id` and
  `messaging.kafka.offset`, plus `error.type` when processing fails.
- The CONSUMER span starts its own trace and links to the PRODUCER span. The
  conventions moved to links because a consumer doesn't run inside the
  send: the send finishes long before, and one send can feed any number of
  consumer groups.

## 1. One goal, three consumer groups

The producer publishes one goal. The scoreboard, notifications and stats
groups each read it. autotel links every CONSUMER span to the PRODUCER span
through the `traceparent` header, so you can open the goal's trace and see
which groups read it.

```text
publish match-events 5e4d9f0e
process match-events 14364c8c  scoreboard     → 5e4d9f0e
process match-events c52fdb77  stats          → 5e4d9f0e
process match-events 3e9d8a1c  notifications  → 5e4d9f0e
```

## 2. Ordering is per partition

Kafka keeps order within a partition. Keyed by match, all six events of
BRA-GER land on one partition and the scoreboard applies them 1 to 6. Published
without a key, the events spread across three partitions and the scoreboard
applies them partition by partition.

The consumer tells autotel each event's position in its match:

```ts
ordering: {
  sequenceFrom: (delivery) => valueOf<MatchEvent>(delivery).seq,
  partitionKeyFrom: (delivery) => valueOf<MatchEvent>(delivery).matchId,
  detectOutOfOrder: true,
},
```

autotel tracks the highest position it has seen for each match. An event
below it arrived after a later one: autotel sets
`messaging.ordering.out_of_order` on its span and records the expected and
actual positions. An event that skips ahead sets
`messaging.ordering.gap_count`. Here the scoreboard read partition 1 first,
so event 6 arrived before 1, 2, 4 and 5:

```text
process match-events 3538a851  partition 1
process match-events d74da2ca  partition 1  gap
process match-events 90d43d6b  partition 2  out of order
process match-events 517425b3  partition 2  out of order
process match-events 3597a8b9  partition 0  out of order
process match-events c41eb178  partition 0  out of order
```

## 3. Retry topic, then DLQ

The push provider is down. The notifications consumer sends a failed event to
`match-events.retry` and moves on, so the main topic keeps flowing. The retry
consumer tries again with backoff and, after three attempts, publishes the
event to `match-events.dlq`. A malformed event (`type: 'gaol'`) goes straight
to the DLQ, since a retry can never fix it.

```text
process match-events        notifications        retry 1
process match-events        notifications        dlq (validation): unknown event type 'gaol'
process match-events.retry  notifications-retry  retry 2
process match-events.retry  notifications-retry  dlq (processing): push provider unavailable
process match-events.dlq    dlq-inspector        → the DLQ publish in the trace above
```

Each attempt runs in its own trace and links to the message it read. A DLQ
message's `traceparent` points into the trace of the attempt that gave up, so
from a dead letter you reach the span that holds the reason and the error.

## 4. Crash before commit

The scoreboard applies a goal, then crashes before Kafka commits the offset.
Kafka delivers the goal again. autotel marks the second delivery with
`messaging.ordering.duplicate`, and the scoreboard skips goals it has already
applied (the stand-in for a unique constraint on `eventId`), so the score
counts it once.

```text
process match-events 5ed1a097  error
process match-events f4e9977a  ok     duplicate
```

autotel tracks duplicates per consumer group, in memory. A redelivery after a
real process restart needs the store's own idempotency, which is why the
scoreboard checks `eventId` itself.

## 5. Hot partition

The final draws 30 events while five group games draw one each. Keyed by
match, the final's events share a partition. Each span's
`messaging.kafka.consumer_lag` holds how many messages in its partition were
still waiting after it, the same lag `kafka-consumer-groups` reports:

```text
partition  events  maxLag
0          2       1
1          32      31
2          1       0
```

Kafka's usual fixes for this are a compound key (match plus minute) or, if a
match's order doesn't matter to a consumer, no key at all.

## 6. More consumers than partitions

Four scoreboard instances join one group on a three-partition topic. Kafka
gives each partition to one member, so the fourth instance holds nothing.
`instrumentConsumerEvents` from `autotel-kafka` records each group join
as a span with the member's `messaging.kafka.consumer.assignment_count`:

```text
6. Four consumers, three partitions: partitions per member [1,1,1,0]
```

## The catalog: what ran beside what it promises

`pnpm start` also writes `.autotel/snapshot.json`, the architecture snapshot
[autocatalog](https://github.com/jagreehal/autocatalog) reads. The catalog for
the feed sits beside the code:

- `events/match/MatchEventRecorded/` declares `match.event_recorded`: its
  producer, its five consumer groups, its three topics and a schema whose
  `type` is one of `kickoff`, `goal`, `card`, `sub` or `full_time`.
- `autocatalog.consumes.json` names the dead-letter queue the notifications
  consumers give up to, and after how many attempts.

Three things in the code make the snapshot line up with the catalog:

- `publish` calls `track()` inside each PRODUCER span, and `init` sets
  `events: { includeTraceContext: true }`. The snapshot matches each CONSUMER
  span's link to the message it read.
- Each scenario writes to its own topic, `match-events-<run>`, and both spans
  set `messaging.destination.template` to `match-events`. The snapshot joins
  on the template, so every run's topic is one channel.
- Consumer groups keep fixed names (`scoreboard`, `notifications`, `stats`),
  the names the catalog lists as consumers.

For each consumer, the snapshot records what happened to its deliveries:

```json
{
  "consumer": "notifications-retry",
  "channel": "match-events.retry",
  "count": 2,
  "failed": 2,
  "retried": 1,
  "deadLettered": 1,
  "deadLetterReasons": [
    {
      "reason": "push provider unavailable",
      "category": "processing",
      "queue": "match-events.dlq",
      "count": 1
    }
  ]
}
```

`autocatalog drift` checks the catalog against it:

```bash
npx autocatalog drift --base events --current events --snapshot .autotel/snapshot.json
```

```text
breaking   match/match.event_recorded: runtime payloads set `type` to 1 value(s) outside the values the schema allows …
info       match/match.event_recorded: notifications dead-lettered 1 of 3 deliveries (snapshot of 2026-01-01T00:00:00.000Z): `unknown event type 'gaol'` (1)
info       match/match.event_recorded: notifications-retry dead-lettered 1 of 2 deliveries (snapshot of 2026-01-01T00:00:00.000Z): `push provider unavailable` (1)

1 breaking · 0 suspicious · 0 additive
```

The malformed `gaol` event from scenario 3 is the breaking change: drift
catches in CI what the DLQ caught at runtime. `npx autocatalog site` shows the same
outcomes on the event's page, beside each consumer.

## Tests

```bash
KAFKA_BROKER=localhost:9092 pnpm test:integration
pnpm kafka:down
```

The tests assert each scenario's spans. They skip when `KAFKA_BROKER` is
unset.
