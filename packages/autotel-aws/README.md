# autotel-aws

OpenTelemetry instrumentation for AWS services - ergonomic, vendor-agnostic observability.

> **AWS X-Ray SDK Deprecation Notice**: AWS X-Ray SDKs enter maintenance mode on February 25, 2026 and reach end of support on February 25, 2027. AWS recommends migrating to OpenTelemetry. This package provides an ergonomic migration path.

## Features

- **Lambda Handler Instrumentation** - Automatic tracing with cold start detection
- **AWS SDK v3 Auto-Instrumentation** - Global patching or per-client wrapping
- **Service-Specific Semantic Helpers** - S3, DynamoDB, SQS, SNS, Kinesis, Step Functions, EventBridge
- **SQS Producer/Consumer Classes** - Built-in trace context propagation
- **SNS Publisher Class** - Automatic context injection for distributed tracing
- **Kinesis Producer/Consumer Classes** - Stream processing with context propagation
- **Step Functions Executor/Worker** - State machine orchestration with distributed tracing
- **EventBridge Publisher** - Event-driven architecture tracing
- **X-Ray Compatibility** - Annotation/metadata helpers for X-Ray users
- **Middy Middleware** - Full span lifecycle management for Middy users
- **Lambda Layer** - Pre-built layer for easy deployment
- **Vendor Agnostic** - Works with any OTLP backend (X-Ray, Honeycomb, Datadog, etc.)
- **Tree-Shakeable** - Per-service entry points for minimal bundle size

## Installation

```bash
npm install autotel-aws autotel
# or
pnpm add autotel-aws autotel
```

> **Note:** `autotel` is the core tracing library that provides `init()`, `trace()`, and other foundational APIs. `autotel-aws` extends it with AWS-specific instrumentation.

## Quick Start

### Lambda Handler

```typescript
import { init } from 'autotel';
import { wrapHandler } from 'autotel-aws/lambda';

init({ service: 'my-lambda', endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT });

export const handler = wrapHandler(async (event, context) => {
  // Your handler code - automatically traced
  return { statusCode: 200 };
});
```

### Zero-Config Mode

```typescript
// IMPORTANT: Import this FIRST, before any AWS SDK imports
import 'autotel-aws/lambda/auto';

// Reads from OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT
export const handler = async (event, context) => {
  return { statusCode: 200 };
};
```

> **Note:** The auto-import must be at the top of your file to ensure instrumentation is set up before any AWS SDK clients are created.

### AWS SDK Auto-Instrumentation

```typescript
import { autoInstrumentAWS } from 'autotel-aws/sdk';

// Call at the top level of your file - all SDK clients are automatically traced
autoInstrumentAWS();

// All subsequent clients are instrumented
const s3 = new S3Client({ region: 'us-east-1' });
const dynamodb = new DynamoDBClient({ region: 'us-east-1' });
```

### Per-Client Instrumentation

```typescript
import { instrumentSDK, createTracedClient } from 'autotel-aws/sdk';
import { S3Client } from '@aws-sdk/client-s3';

// Option A: Wrap existing client
const s3 = instrumentSDK(new S3Client({ region: 'us-east-1' }));

// Option B: Create pre-instrumented client
const s3 = createTracedClient(S3Client, { region: 'us-east-1' });
```

## SQS Producer/Consumer

End-to-end distributed tracing across message queues with **automatic context injection/extraction** - each message in a batch is correctly linked to its parent trace:

```typescript
import { SQSProducer, SQSConsumer } from 'autotel-aws/sqs';
import { SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'us-east-1' });

// Producer - automatically injects trace context
const producer = new SQSProducer(sqs, {
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue',
});

await producer.send({ body: JSON.stringify({ orderId: '12345' }) });

// Batch send
await producer.sendBatch([
  { body: JSON.stringify({ orderId: '1' }), id: 'msg-1' },
  { body: JSON.stringify({ orderId: '2' }), id: 'msg-2' },
]);

// Consumer - automatically extracts trace context
const consumer = new SQSConsumer(sqs, {
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue',
});

await consumer.processMessages(async (message, ctx) => {
  ctx.setAttribute('order.id', JSON.parse(message.body).orderId);
  await processOrder(message.body);
});

// Continuous polling
await consumer.poll(async (message, ctx) => {
  return await processOrder(message.body);
}, { maxIterations: 100 });
```

## SNS Publisher

```typescript
import { SNSPublisher } from 'autotel-aws/sns';
import { SNSClient } from '@aws-sdk/client-sns';

const sns = new SNSClient({ region: 'us-east-1' });
const publisher = new SNSPublisher(sns, {
  topicArn: 'arn:aws:sns:us-east-1:123456789:my-topic',
});

// Single publish - trace context is automatically injected
await publisher.publish({
  message: JSON.stringify({ event: 'ORDER_COMPLETED' }),
  subject: 'Order Notification',
});

// Batch publish
await publisher.publishBatch([
  { message: JSON.stringify({ event: 'EVENT_1' }) },
  { message: JSON.stringify({ event: 'EVENT_2' }) },
  { message: JSON.stringify({ event: 'EVENT_3' }) },
]);
```

## Kinesis Producer/Consumer

Stream processing with automatic trace context propagation:

```typescript
import { KinesisProducer, KinesisConsumer } from 'autotel-aws/kinesis';
import { KinesisClient } from '@aws-sdk/client-kinesis';

const kinesis = new KinesisClient({ region: 'us-east-1' });

// Producer - injects trace context into record data
const producer = new KinesisProducer(kinesis, {
  streamName: 'my-stream',
});

await producer.putRecord({
  data: { orderId: '123', action: 'created' },
  partitionKey: 'order-123',
});

// Batch put
await producer.putRecords([
  { data: { id: '1' }, partitionKey: 'pk-1' },
  { data: { id: '2' }, partitionKey: 'pk-2' },
]);

// Consumer - extracts trace context from records
const consumer = new KinesisConsumer(kinesis, {
  streamName: 'my-stream',
});

const shardIterator = await consumer.getShardIterator('shardId-000000000000', 'TRIM_HORIZON');

await consumer.processRecords(shardIterator, async (record, ctx) => {
  ctx.setAttribute('order.id', record.orderId);
  await processRecord(record);
});
```

## Step Functions

Orchestrate workflows with distributed tracing across state machines:

```typescript
import { StepFunctionsExecutor, StepFunctionsActivityWorker } from 'autotel-aws/step-functions';
import { SFNClient } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({ region: 'us-east-1' });

// Executor - starts workflows with trace context injection
const executor = new StepFunctionsExecutor(sfn, {
  stateMachineArn: 'arn:aws:states:us-east-1:123456789:stateMachine:OrderProcessor',
});

// Start async execution
const result = await executor.startExecution({
  input: { orderId: '123', items: ['item1', 'item2'] },
  name: 'order-123-execution',
});

// Start sync execution (Express workflows)
const syncResult = await executor.startSyncExecution({
  input: { orderId: '456' },
});

// Activity worker - processes tasks with trace context extraction
const worker = new StepFunctionsActivityWorker(sfn, {
  activityArn: 'arn:aws:states:us-east-1:123456789:activity:ProcessPayment',
  workerName: 'payment-worker-1',
});

await worker.poll(async (input, taskToken, ctx) => {
  ctx.setAttribute('payment.amount', input.amount);
  const result = await processPayment(input);
  return result;
});
```

### Lambda Invoked by Step Functions

```typescript
import { extractStepFunctionsContext, stripTraceContext } from 'autotel-aws/step-functions';
import { wrapHandler } from 'autotel-aws/lambda';

export const handler = wrapHandler(async (event) => {
  // Extract parent trace context from Step Functions input
  const parentContext = extractStepFunctionsContext(event);

  // Process without trace context fields
  const { orderId, items } = stripTraceContext(event);
  await processOrder(orderId, items);

  return { status: 'completed' };
});
```

## EventBridge

Event-driven architecture with trace context propagation:

```typescript
import { EventBridgePublisher } from 'autotel-aws/eventbridge';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({ region: 'us-east-1' });
const publisher = new EventBridgePublisher(eventBridge, {
  eventBusName: 'my-event-bus',
  source: 'com.myapp.orders',
});

// Single event - trace context injected into detail
await publisher.putEvent({
  detailType: 'OrderCreated',
  detail: { orderId: '123', customerId: 'abc' },
});

// Batch events
await publisher.putEvents([
  { detailType: 'OrderCreated', detail: { orderId: '1' } },
  { detailType: 'OrderCreated', detail: { orderId: '2' } },
  { detailType: 'OrderCreated', detail: { orderId: '3' } },
]);
```

### Lambda Invoked by EventBridge

```typescript
import { extractEventBridgeContext, stripEventBridgeContext } from 'autotel-aws/eventbridge';
import { wrapHandler } from 'autotel-aws/lambda';

export const handler = wrapHandler(async (event) => {
  // Extract parent trace context from EventBridge detail
  const parentContext = extractEventBridgeContext(event);

  // Process without trace context fields
  const cleanDetail = stripEventBridgeContext(event.detail);
  await processEvent(cleanDetail);

  return { statusCode: 200 };
});
```

## Middy Middleware

Full span lifecycle management for Middy users:

```typescript
import middy from '@middy/core';
import { tracingMiddleware } from 'autotel-aws/lambda';

const baseHandler = async (event, context) => {
  return { statusCode: 200 };
};

export const handler = middy(baseHandler)
  .use(tracingMiddleware({ captureResponse: true }));
```

## Service-Specific Semantic Helpers

```typescript
import { traceS3 } from 'autotel-aws/s3';
import { traceDynamoDB } from 'autotel-aws/dynamodb';
import { traceKinesis } from 'autotel-aws/kinesis';
import { traceStepFunction } from 'autotel-aws/step-functions';
import { traceEventBridge } from 'autotel-aws/eventbridge';

// S3 operations with semantic attributes
export const uploadFile = traceS3({
  bucket: 'my-bucket',
  operation: 'PutObject',
})(ctx => async (key: string, body: Buffer) => {
  ctx.setAttribute('s3.key', key);
  return await s3.send(new PutObjectCommand({ Bucket: 'my-bucket', Key: key, Body: body }));
});

// DynamoDB operations with semantic attributes
export const getUser = traceDynamoDB({
  table: 'users',
  operation: 'GetItem',
})(ctx => async (userId: string) => {
  return await dynamodb.send(new GetItemCommand({
    TableName: 'users',
    Key: { id: { S: userId } }
  }));
});

// Kinesis with semantic attributes
export const publishEvent = traceKinesis({
  streamName: 'events',
  operation: 'PutRecord',
})(ctx => async (event: Event) => {
  ctx.setAttribute('event.type', event.type);
  return await kinesis.send(new PutRecordCommand({...}));
});
```

## X-Ray Annotations

For users sending traces to AWS X-Ray, annotations are indexed for filtering:

```typescript
import { setXRayAnnotation, setXRayMetadata } from 'autotel-aws/xray';

export const handler = wrapHandler(async (event, context) => {
  // Indexed in X-Ray (for filtering)
  setXRayAnnotation('user.id', event.userId);
  setXRayAnnotation('order.status', 'completed');

  // Not indexed (for detailed data)
  setXRayMetadata('request.payload', event);

  return { statusCode: 200 };
});
```

## Lambda Layer

Build and deploy a Lambda Layer with autotel-aws and all dependencies:

```bash
# Build the layer
pnpm --filter autotel-aws build:layer

# Deploy with AWS CLI
aws lambda publish-layer-version \
  --layer-name autotel-aws \
  --zip-file fileb://dist/layer/autotel-aws-layer.zip \
  --compatible-runtimes nodejs18.x nodejs20.x nodejs22.x \
  --compatible-architectures x86_64 arm64
```

Then attach the layer to your Lambda function and import as normal:

```typescript
import { init } from 'autotel';
import { wrapHandler } from 'autotel-aws/lambda';

init({ service: 'my-service' });

export const handler = wrapHandler(async (event) => {
  return { statusCode: 200 };
});
```

---

## Migration from AWS X-Ray SDK

### Why Migrate?

- X-Ray SDKs enter **maintenance mode** on February 25, 2026
- X-Ray SDKs reach **end of support** on February 25, 2027
- OpenTelemetry is AWS's recommended observability standard
- Vendor-agnostic: same instrumentation works with X-Ray, Honeycomb, Datadog, etc.

### Before (X-Ray SDK)

```typescript
import AWSXRay from 'aws-xray-sdk';

AWSXRay.config([AWSXRay.plugins.EC2Plugin]);
const s3 = AWSXRay.captureAWSv3Client(new S3Client({}));

export const handler = async (event, context) => {
  const segment = AWSXRay.getSegment();
  segment.addAnnotation('userId', event.userId);

  await s3.send(new GetObjectCommand({ Bucket: 'x', Key: 'y' }));
  return { statusCode: 200 };
};
```

### After (autotel-aws)

```typescript
import { init } from 'autotel';
import { wrapHandler, setXRayAnnotation } from 'autotel-aws/lambda';
import { instrumentSDK } from 'autotel-aws/sdk';

init({ service: 'my-service' });
const s3 = instrumentSDK(new S3Client({}));

export const handler = wrapHandler(async (event, context) => {
  setXRayAnnotation('userId', event.userId);

  await s3.send(new GetObjectCommand({ Bucket: 'x', Key: 'y' }));
  return { statusCode: 200 };
});
```

### Key Migration Points

| X-Ray SDK | autotel-aws | Notes |
|-----------|-------------|-------|
| `AWSXRay.captureAWSv3Client(client)` | `instrumentSDK(client)` or `autoInstrumentAWS()` | Global auto-instrumentation available |
| `AWSXRay.getSegment().addAnnotation()` | `setXRayAnnotation()` | Same X-Ray filtering capability |
| `AWSXRay.getSegment().addMetadata()` | `setXRayMetadata()` | Same X-Ray metadata storage |
| `new AWSXRay.Segment()` | `trace('name', ...)` or `wrapHandler()` | Automatic span management |
| X-Ray daemon | Any OTLP collector | X-Ray, CloudWatch Agent, or third-party |

### Environment Variables

```bash
# For X-Ray via CloudWatch Agent or ADOT Collector
OTEL_SERVICE_NAME=my-service
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# For Honeycomb
OTEL_SERVICE_NAME=my-service
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY

# For Datadog
OTEL_SERVICE_NAME=my-service
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
DD_API_KEY=YOUR_API_KEY
```

---

## API Reference

### Entry Points

| Import | Description |
|--------|-------------|
| `autotel-aws/lambda` | Lambda handler wrappers + Middy middleware |
| `autotel-aws/lambda/auto` | Zero-config Lambda auto-init |
| `autotel-aws/sdk` | AWS SDK v3 instrumentation |
| `autotel-aws/s3` | S3 semantic helpers |
| `autotel-aws/dynamodb` | DynamoDB semantic helpers |
| `autotel-aws/sqs` | SQS helpers + Producer/Consumer |
| `autotel-aws/sns` | SNS helpers + Publisher |
| `autotel-aws/kinesis` | Kinesis helpers + Producer/Consumer |
| `autotel-aws/step-functions` | Step Functions Executor/Worker + context helpers |
| `autotel-aws/eventbridge` | EventBridge Publisher + context helpers |
| `autotel-aws/xray` | X-Ray annotation/metadata helpers |
| `autotel-aws/testing` | Test utilities for Lambda |
| `autotel-aws/attributes` | Semantic attribute builders |

### Semantic Attributes

All instrumentation follows [OpenTelemetry AWS Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/cloud-providers/aws-sdk/):

**Lambda:**
- `faas.name`, `faas.version`, `faas.invocation_id`
- `faas.coldstart`, `faas.trigger`
- `cloud.provider`, `cloud.region`, `cloud.account.id`

**AWS SDK:**
- `rpc.system` (aws-api), `rpc.service`, `rpc.method`
- `aws.request_id`, `http.status_code`

**Messaging (SQS/SNS/Kinesis):**
- `messaging.system`, `messaging.destination.name`
- `messaging.operation`, `messaging.message.id`
- `messaging.batch.message_count` (for batch operations)

**Database (DynamoDB):**
- `db.system`, `db.operation`, `db.name`
- `aws.dynamodb.table_names`

**Step Functions:**
- `aws.stepfunctions.state_machine_arn`
- `aws.stepfunctions.execution_arn`
- `aws.stepfunctions.activity_arn`

**EventBridge:**
- `aws.eventbridge.event_bus`
- `aws.eventbridge.source`
- `aws.eventbridge.detail_type`

## Testing

Integration tests require LocalStack:

```bash
# Start LocalStack
docker run -d -p 4566:4566 localstack/localstack

# Run integration tests
LOCALSTACK_ENDPOINT=http://localhost:4566 pnpm test:integration
```

## License

MIT
