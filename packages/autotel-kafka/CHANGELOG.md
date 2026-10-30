# autotel-kafka

## 0.1.0

### Minor Changes

- 89cb674: `autotel`:

  - `createMemoryExporter()` records span links on `RecordedSpan.links`.
  - `traceConsumer` reads lag from the message's own partition, and `messaging.kafka.consumer_lag` counts the messages after the current one, matching `kafka-consumer-groups`.
  - `ordering.detectOutOfOrder` marks a message that arrived after a later one with `messaging.ordering.out_of_order`, and a skip ahead with `messaging.ordering.gap_count`. `ordering.detectDuplicates` tracks each consumer group on its own.
  - Producer and consumer spans add `messaging.destination.partition.id` and `messaging.kafka.offset`, and a failing handler sets `error.type` and calls `onError`.
  - `ConsumerConfig.onDLQ` is deprecated: call your own code after `ctx.recordDLQ()`.
  - `traceStep` records each step's position in its workflow as `workflow.step.index`, from 0 in run order.

  `autotel-aws`: `SQSConsumer.processMessages` runs each message under a CONSUMER span named `process <queue>` (it was `sqs.process`), linked to its producer, with `recordRetry`, `recordDLQ` and `recordReplay` on the handler's context. A failing message records its error on its span and stays on the queue for redelivery, the rest of the batch runs, and `processMessages` resolves with the number of messages that succeeded.

  New package `autotel-kafka`: the Kafka instrumentation from `autotel-plugins/kafka`, with the same API. Spans and metrics report the instrumentation scope `autotel-kafka`. `instrumentConsumerEvents` reads KafkaJS group, member, leader and partition-count payloads, records each event as a span when you give no `lifecycleSpan` (and requires one for `mode: 'events'`), and records `consumer.disconnect` as a lifecycle event. A `consumer.crash` records the error KafkaJS sends with it.

  `autotel-plugins`: `autotel-plugins/kafka` and the root entry's Kafka exports re-export `autotel-kafka` and are deprecated. Import from `autotel-kafka`. The package no longer depends on `@opentelemetry/instrumentation` or `@opentelemetry/semantic-conventions`.

  `autotel-subscribers`: the architecture snapshot records what each observed consumer did with its deliveries (`failed`, `retried`, `deadLettered`, `replayed` and the top ten `deadLetterReasons`), and a `workflows` map of each `traceWorkflow` run by end status and each step's failures, skips and compensations. The consumer join reads `messaging.destination.template` when a span sets it, so per-run topics count as one channel.

### Patch Changes

- Updated dependencies [89cb674]
  - autotel@8.8.0
