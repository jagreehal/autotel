# autotel-kafka

## 1.0.1

### Patch Changes

- Updated dependencies [80a7f9a]
  - autotel@9.1.0

## 1.0.0

### Major Changes

- 039f92c: Adopt OpenTelemetry JS SDK 3 and add state transitions.

  **SDK 3:** upgrade to Node.js 22.15+ and `@opentelemetry/api` 1.10.

  - Import `@opentelemetry/sdk-trace` in place of `sdk-trace-base`, `sdk-trace-node` and `sdk-trace-web`, and `@opentelemetry/api` in place of `api-logs`.
  - Use `TracerProvider` for the Basic, Node and Web providers, and `trace.setGlobalTracerProvider()` for `register()`.
  - Pass processors an options object: `new BatchSpanProcessor({ exporter })`.
  - Rename `SdkLogRecord` to `ReadWriteLogRecord`. `SpanAttributeValue` in `autotel-subscribers` is now `unknown`.
  - Send to Jaeger over OTLP.
  - `init()` reads `OTEL_BSP_*`, `OTEL_SPAN_*` and `OTEL_ATTRIBUTE_*`.

  **State transitions:**

  - **autotel:** `transition()` counts `autotel.state.transitions` after a persisted write, whatever the sampling decision. `init()` warns when another tracer provider holds the global, and sets `deployment.environment` and `deployment.environment.name` to one value, taken from `environment`, then either key in `OTEL_RESOURCE_ATTRIBUTES` or `resourceAttributes`, then `NODE_ENV`.
  - **autotel-subscribers:** `ArchitectureSnapshotSubscriber` adds aggregated `transitions`.
  - **autotel-mongoose:** prototype `watchTransitions()` records transitions from a change stream.
  - **autotel-mcp:** `get_state_transitions` and `get_entity_history` read them. `getMetricSeries` takes `groupBy`, the collector keeps metric temporality and start times, and Loki attribute filters reach structured metadata.

  `autotel-aws/durable` has an install command in its README.

### Patch Changes

- Updated dependencies [092e810]
- Updated dependencies [6e32484]
- Updated dependencies [039f92c]
- Updated dependencies [092e810]
- Updated dependencies [3c872f2]
  - autotel@9.0.0

## 0.1.1

### Patch Changes

- Updated dependencies [8feeb23]
  - autotel@8.8.1

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
