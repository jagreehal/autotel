---
name: autotel-aws
description: >
  OpenTelemetry instrumentation for AWS services (Lambda, SDK v3 clients, S3, DynamoDB, SQS, SNS, Kinesis, Step Functions, X-Ray) built on top of autotel.
type: integration
library: autotel-aws
library_version: "0.12.4"
sources:
  - jagreehal/autotel:packages/autotel-aws/src/
---

# autotel-aws

Vendor-agnostic OpenTelemetry instrumentation for AWS. Works with any OTLP backend. Provides:

- Lambda handler wrapping with automatic cold-start detection, trigger-type detection, and distributed trace context extraction
- AWS SDK v3 auto-instrumentation (per-client, pre-built, or global)
- Service-specific semantic helpers following OTel semantic conventions: S3, DynamoDB, SQS, SNS, Kinesis, Step Functions
- X-Ray compatibility layer (propagator, ID generator)
- AWS resource detectors (EC2, ECS, EKS)

## Setup

```bash
pnpm add autotel-aws autotel
# Add only the AWS SDK clients you actually use
pnpm add @aws-sdk/client-s3 @aws-sdk/client-dynamodb
```

Initialize at the top of your entry point (before any handlers or SDK usage):

```typescript
import { init } from 'autotel-aws';

await init({
  service: 'my-service',
  endpoint: process.env.OTLP_ENDPOINT,
  region: process.env.AWS_REGION,
});
```

`init` delegates to `autotel`'s `init()` and sets `cloud.provider: 'aws'` and `cloud.region` automatically.

## Configuration / Core Patterns

### Lambda handler instrumentation

**Simple wrap (no trace context access):**

```typescript
import { wrapHandler } from 'autotel-aws/lambda';

export const handler = wrapHandler(async (event, context) => {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
});
```

Automatically sets: `faas.name`, `faas.version`, `faas.invocation_id`, `faas.coldstart`, `faas.trigger`, `cloud.provider`, `cloud.region`, `cloud.account.id`.

**With trace context access (`traceLambda`):**

```typescript
import { traceLambda } from 'autotel-aws/lambda';

export const handler = traceLambda((ctx) => async (event, lambdaContext) => {
  ctx.setAttribute('user.id', event.userId);
  const result = await processOrder(event);
  ctx.setAttribute('order.status', result.status);
  return { statusCode: 200 };
});
```

**LambdaInstrumentationConfig options:**

| Option | Default | Description |
|---|---|---|
| `captureResponse` | `false` | Serialise response into `lambda.response` attribute (capped at 4 096 bytes) |
| `extractTraceContext` | `true` | Extract W3C / X-Ray trace context from the incoming event |
| `service` | — | Override service name |

### AWS SDK v3 instrumentation

Three approaches — pick one:

**A. Instrument an existing client:**

```typescript
import { instrumentSDK } from 'autotel-aws/sdk';
import { S3Client } from '@aws-sdk/client-s3';

const s3 = instrumentSDK(new S3Client({ region: 'us-east-1' }));
// All s3.send() calls are now traced automatically
```

**B. Create a pre-instrumented client:**

```typescript
import { createTracedClient } from 'autotel-aws/sdk';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const dynamo = createTracedClient(DynamoDBClient, { region: 'us-east-1' });
```

**C. Global auto-instrumentation (call once at startup):**

```typescript
import { autoInstrumentAWS } from 'autotel-aws/sdk';

autoInstrumentAWS();

// All subsequently created clients are instrumented automatically
const s3 = new S3Client({});
```

Disable with `disableAutoInstrumentAWS()`. Check status with `isAutoInstrumentEnabled()`.

### Service-specific semantic tracing helpers

All service helpers follow the same curried factory pattern:

```
traceXxx(config)(ctx => async (...args) => { ... })
```

**S3:**

```typescript
import { traceS3 } from 'autotel-aws/s3';

const getFile = traceS3({ operation: 'GetObject', bucket: 'my-bucket' })(
  (ctx) => async (key: string) => {
    ctx.setAttribute('aws.s3.key', key);
    return await s3.send(new GetObjectCommand({ Bucket: 'my-bucket', Key: key }));
  }
);

await getFile('path/to/file.txt');
```

Auto-sets: `aws.s3.bucket`. Span name: `s3.GetObject`.

**DynamoDB:**

```typescript
import { traceDynamoDB } from 'autotel-aws/dynamodb';

const getUser = traceDynamoDB({ operation: 'GetItem', table: 'users' })(
  (ctx) => async (userId: string) => {
    ctx.setAttribute('db.statement', 'GetItem WHERE id = :id');
    const result = await dynamodb.send(new GetItemCommand({
      TableName: 'users',
      Key: { id: { S: userId } },
    }));
    if (result.ConsumedCapacity?.CapacityUnits) {
      ctx.setAttribute('aws.dynamodb.consumed_capacity', result.ConsumedCapacity.CapacityUnits);
    }
    return result.Item;
  }
);
```

Auto-sets: `db.system` ('dynamodb'), `db.operation`, `db.name`, `aws.dynamodb.table_names`. Span name: `dynamodb.GetItem`.

**SQS / SNS / Kinesis / Step Functions / EventBridge** — follow the same `traceXxx({ operation, ... })` pattern via their respective subpaths (`autotel-aws/sqs`, `autotel-aws/sns`, etc.).

### X-Ray compatibility

```typescript
import { configureXRay } from 'autotel-aws/xray';

// Enable X-Ray propagator and ID generator before init()
configureXRay({ propagator: true, idGenerator: true });

await init({ service: 'my-service' });
```

### AWS resource detectors

```typescript
import { getAWSResourceDetectors } from 'autotel-aws';

const detectors = await getAWSResourceDetectors();
// detectors = [awsEc2Detector, awsEcsDetector, awsEksDetector] if
// @opentelemetry/resource-detector-aws is installed; [] otherwise
```

## Common Mistakes

### HIGH — Calling init() after creating SDK clients

```typescript
// WRONG: SDK clients created before SDK is initialised
import { S3Client } from '@aws-sdk/client-s3';
const s3 = new S3Client({});
await init({ service: 'my-service' }); // too late
```

```typescript
// CORRECT: init() first, clients after
await init({ service: 'my-service' });
const s3 = instrumentSDK(new S3Client({}));
```

### HIGH — Using traceLambda but forgetting to call the inner handler

```typescript
// WRONG: factory must return an async function; the function is what gets invoked
export const handler = traceLambda((ctx) => {
  ctx.setAttribute('foo', 'bar'); // ctx.setAttribute called eagerly — wrong timing
  return { statusCode: 200 };     // returning a value, not a handler function
});
```

```typescript
// CORRECT: the factory returns the handler function
export const handler = traceLambda((ctx) => async (event, lambdaContext) => {
  ctx.setAttribute('foo', 'bar');
  return { statusCode: 200 };
});
```

### MEDIUM — Forgetting to await init() before the first invocation

Lambda cold start code runs synchronously before the handler. If `init()` is not awaited, the first invocation may execute before the SDK is ready.

```typescript
// WRONG (at module level, unawaited)
init({ service: 'my-service' }); // returns a Promise, not awaited
```

```typescript
// CORRECT: await at module level using top-level await, or guard the handler
await init({ service: 'my-service' });
export const handler = wrapHandler(async (event) => { ... });
```

### MEDIUM — Enabling captureResponse on large payloads

`captureResponse: true` serialises the full response to a span attribute. Payloads over 4 096 bytes are replaced with `lambda.response.truncated = true` and `lambda.response.size`, but the serialisation still happens. Avoid on high-throughput or large-payload handlers.

### MEDIUM — Using global autoInstrumentAWS() in tests

`autoInstrumentAWS()` patches the SDK globally and persists across test files. Always call `disableAutoInstrumentAWS()` in test teardown, or prefer `instrumentSDK()` / `createTracedClient()` for isolated instrumentation.

## Version

Targets autotel-aws v0.12.4. AWS SDK v3 peer deps: `@aws-sdk/client-*` ^3.1014.0 (all optional). Requires `autotel` as a direct dependency. See also: `autotel-backends` (vendor configs), `autotel-adapters` (HTTP framework adapters).
