# SQS dead-letter queue you can inspect and replay

When a message lands in this example's dead-letter queue, the trace tells you
why it failed, how many attempts it took, and what happened when you replayed
it:

- **Why it failed.** The attempt that gives up calls `ctx.recordDLQ()` with the
  reason, a category, the attempt count and the original error. It then moves
  the message to the DLQ with its own span context attached.
- **What's in the DLQ.** `inspectDeadLetters()` lists up to 10 dead letters,
  each with its reason, attempt count and the trace id of the order behind it.
- **What the replay did.** `replayDeadLetters()` sends every message back. The
  consumer calls `ctx.recordReplay()`, and the replay span links to the
  producer and to the attempt that dead-lettered the message. It also records
  how long the message waited in the DLQ.

You run it on [MiniStack](https://ministack.org), with no AWS account:

```bash
pnpm install
pnpm ministack:up
pnpm start
```

```text
In the DLQ:
│ orderId │ reason                         │ attempts │ traceId                            │
│ 'o-1'   │ 'payment provider unavailable' │ 3        │ '031fa6b5357fb2a519c8445f3a77142d' │
Replayed 1 message(s)

│ span                     │ status  │ retry │ dlq                            │ replay │ links                      │
│ 'publish orders 3d5b9bfc'│ 'ok'    │       │                                │        │ ''                         │
│ 'process orders 31487425'│ 'error' │ 1     │                                │        │ '3d5b9bfc'                 │
│ 'process orders f61feddf'│ 'error' │ 2     │                                │        │ '3d5b9bfc'                 │
│ 'process orders 689509ee'│ 'error' │       │ 'payment provider unavailable' │        │ '3d5b9bfc'                 │
│ 'process orders 0254f9d7'│ 'ok'    │       │                                │ true   │ '3d5b9bfc, 689509ee (dlq)' │
```

The test asserts the same chain:

```bash
SQS_ENDPOINT=http://localhost:4566 pnpm test:integration
pnpm ministack:down
```

The code is all in [`src/orders.ts`](./src/orders.ts).

## Routing to the DLQ from the consumer

SQS can dead-letter a message for you (`RedrivePolicy`) and redrive it back
(`StartMessageMoveTask`). On real SQS a redriven message keeps its
`traceparent` and `baggage` attributes, so its consumer span still links to the
original producer. SQS delivers it as a new message, with
`ApproximateReceiveCount` back at `1`.

This example moves the message from the consumer instead, which lets it attach
what the replay needs:

| Attribute         | Set by        | Used for                              |
| ----------------- | ------------- | ------------------------------------- |
| `dlq.traceparent` | consumer      | replay span's link to the failed span |
| `dlq.reason`      | consumer      | `inspectDeadLetters()`                |
| `dlq.attempts`    | consumer      | `inspectDeadLetters()`                |
| `dlq.routed_at`   | consumer      | `messaging.replay.dwell_time_ms`      |
| `replay.attempt`  | replay script | `messaging.replay.attempt`            |

The queue also keeps a `RedrivePolicy` set one receive past the consumer's last
attempt, for a consumer that stops mid-message. `inspectDeadLetters()` reports
those messages as moved by the policy, and their replay links to the producer.

SQS allows 10 attributes per message. This scheme uses up to 7, counting
`traceparent` and `tracestate`.

Kafka (a DLQ topic with headers) and RabbitMQ (a dead-letter exchange with
headers) follow the same pattern with their own send and delete calls.
