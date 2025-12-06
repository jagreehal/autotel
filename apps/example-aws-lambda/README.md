# AWS Lambda Example with autotel-aws

This example demonstrates how to use `autotel-aws` to instrument AWS Lambda functions and AWS SDK v3 clients. It includes AWS CDK infrastructure for deploying to AWS or testing locally with LocalStack.

## Features Demonstrated

- ✅ **Lambda Handler Instrumentation**
  - `wrapHandler()` - Simple wrapper for Lambda handlers
  - `traceLambda()` - Functional API with context access
  - Automatic trace context extraction from events

- ✅ **AWS SDK v3 Instrumentation**
  - `instrumentSDK()` - Instrument existing clients
  - `createTracedClient()` - Create pre-instrumented clients
  - Automatic span creation for all SDK operations

- ✅ **Service-Specific Semantic Helpers**
  - `traceS3()` - S3 operations with semantic attributes
  - `traceDynamoDB()` - DynamoDB operations with semantic attributes
  - `traceSQS()` - SQS operations with semantic attributes

- ✅ **X-Ray Compatibility**
  - `setXRayAnnotation()` - Set indexed annotations for X-Ray console

- ✅ **AWS CDK Infrastructure**
  - S3 bucket for file uploads
  - DynamoDB table for user data
  - SQS queue for notifications
  - Lambda functions with autotel instrumentation
  - LocalStack support for local development

## Quick Start

### Option 1: Local Testing with LocalStack (Recommended)

1. **Start LocalStack:**
   ```bash
   pnpm localstack:up
   ```

2. **Bootstrap CDK (first time only):**
   ```bash
   pnpm cdklocal:bootstrap
   ```

3. **Deploy the stack:**
   ```bash
   pnpm cdklocal:deploy
   ```

4. **Test the Lambda:**
   ```bash
   pnpm lambda:invoke
   ```

5. **View deployed functions:**
   ```bash
   pnpm lambda:list
   ```

6. **Cleanup:**
   ```bash
   pnpm cdklocal:destroy
   pnpm localstack:down
   ```

### Option 2: Deploy to AWS

1. **Configure AWS credentials:**
   ```bash
   aws configure
   ```

2. **Create `.env` file:**
   ```env
   ENV=dev
   AWS_REGION=us-east-1
   OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otel-collector:4318
   ```

3. **Bootstrap CDK (first time only):**
   ```bash
   pnpm cdk:bootstrap
   ```

4. **Deploy:**
   ```bash
   pnpm cdk:deploy
   ```

5. **Cleanup:**
   ```bash
   pnpm cdk:destroy
   ```

## Project Structure

```
.
├── bin/
│   └── app.ts              # CDK app entry point
├── infra/
│   ├── constants.ts        # Stack configuration and types
│   ├── create-lambda.ts    # Lambda function factory
│   └── stack.ts            # CDK stack definition
├── src/
│   ├── handlers/
│   │   ├── upload-handler.ts  # S3 event handler
│   │   └── api-handler.ts     # API Gateway handler
│   ├── index.ts            # Legacy local testing
│   └── setup-localstack.ts # Manual LocalStack setup (legacy)
├── cdk.json                # CDK configuration
├── cdk-with-localstack.sh  # LocalStack CDK wrapper
├── docker-compose.yml      # LocalStack + OTel Collector
└── .env.local              # LocalStack environment
```

## CDK Commands

| Command | Description |
|---------|-------------|
| `pnpm cdk:synth` | Synthesize CloudFormation template |
| `pnpm cdk:diff` | Compare deployed stack with current state |
| `pnpm cdk:deploy` | Deploy to AWS |
| `pnpm cdk:destroy` | Destroy AWS stack |
| `pnpm cdklocal:synth` | Synthesize for LocalStack |
| `pnpm cdklocal:deploy` | Deploy to LocalStack |
| `pnpm cdklocal:destroy` | Destroy LocalStack stack |

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure OpenTelemetry endpoint:**
   ```bash
   export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   ```

   Or create a `.env` file:
   ```env
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   ```

3. **Run the example:**
   ```bash
   pnpm start
   ```

## Example Handlers

### 1. Simple Handler Wrapper

```typescript
import { wrapHandler } from 'autotel-aws/lambda';

export const handler = wrapHandler(async (event, context) => {
  return { statusCode: 200, body: 'Success' };
});
```

### 2. Handler with Context Access

```typescript
import { traceLambda, setXRayAnnotation } from 'autotel-aws/lambda';

export const handler = traceLambda((ctx) => async (event, context) => {
  ctx.setAttribute('user.id', event.userId);
  setXRayAnnotation('operation.type', 'file-upload');
  // Your handler code...
});
```

### 3. AWS SDK Instrumentation

```typescript
import { instrumentSDK } from 'autotel-aws/sdk';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = instrumentSDK(new S3Client({}));

await s3.send(new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt'
}));
```

### 4. Service-Specific Semantic Helpers

```typescript
import { traceS3 } from 'autotel-aws/s3';
import { traceDynamoDB } from 'autotel-aws/dynamodb';

const getFile = traceS3({
  operation: 'GetObject',
  bucket: 'my-bucket'
})((ctx) => async (key: string) => {
  // S3 operation with automatic semantic attributes
});

const getUser = traceDynamoDB({
  operation: 'GetItem',
  table: 'users'
})((ctx) => async (userId: string) => {
  // DynamoDB operation with automatic semantic attributes
});
```

## Deployment to AWS Lambda

1. **Build the function:**
   ```bash
   pnpm build
   ```

2. **Set environment variables in Lambda:**
   - `OTEL_SERVICE_NAME=example-aws-lambda`
   - `OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otel-collector:4318`
   - `OTEL_EXPORTER_OTLP_HEADERS=x-api-key=your-key` (if needed)

3. **Deploy using your preferred method:**
   - AWS SAM
   - Serverless Framework
   - AWS CDK
   - Terraform
   - Manual ZIP upload

## Observability Backends

This example works with any OTLP-compatible backend:

- **Honeycomb:**
  ```env
  OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
  OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
  ```

- **Datadog:**
  ```env
  OTEL_EXPORTER_OTLP_ENDPOINT=https://http-intake.logs.datadoghq.com
  OTEL_EXPORTER_OTLP_HEADERS=DD-API-KEY=YOUR_API_KEY
  ```

- **X-Ray (via OpenTelemetry Collector):**
  ```env
  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
  # Configure OpenTelemetry Collector with X-Ray exporter
  ```

- **Local Development (OpenTelemetry Collector):**
  ```env
  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
  ```

## What Gets Traced

- ✅ Lambda invocation (cold start detection, trigger type)
- ✅ All AWS SDK v3 operations (S3, DynamoDB, SQS, etc.)
- ✅ Service-specific semantic attributes
- ✅ Error tracking and status codes
- ✅ Request/response metadata
- ✅ Custom attributes and X-Ray annotations

## Local Testing

### Option 1: Mock Testing (No AWS Services)

The example includes local testing that simulates Lambda execution:

```bash
pnpm start
```

This will:
1. Initialize autotel
2. Create instrumented AWS SDK clients
3. Test handlers with mock events and context
4. Generate traces (if OTLP endpoint is configured)

### Option 2: LocalStack Testing (Real AWS Services)

For more realistic testing with actual AWS services, use LocalStack:

1. **Start LocalStack:**
   ```bash
   pnpm localstack:up
   ```

2. **Setup AWS resources:**
   ```bash
   pnpm setup
   ```
   This creates:
   - S3 bucket (`test-bucket`)
   - DynamoDB table (`users`)
   - SQS queue (`notifications`)

3. **Run tests with LocalStack:**
   ```bash
   pnpm test:localstack
   ```

4. **View LocalStack logs:**
   ```bash
   pnpm localstack:logs
   ```

5. **Stop LocalStack:**
   ```bash
   pnpm localstack:down
   ```

The LocalStack setup includes:
- ✅ S3, DynamoDB, SQS services
- ✅ OpenTelemetry Collector (optional)
- ✅ Health checks and automatic setup

## Next Steps

- Add more AWS services (SNS, Kinesis, Step Functions)
- Implement distributed tracing across multiple Lambdas
- Add custom sampling strategies
- Configure X-Ray remote sampling
- Set up alerts based on trace data

## Resources

- [autotel-aws Documentation](../../packages/autotel-aws/README.md)
- [LocalStack Testing Guide](./LOCALSTACK.md)
- [AWS X-Ray to OpenTelemetry Migration Guide](https://docs.aws.amazon.com/xray/latest/devguide/xray-api-migration.html)
- [OpenTelemetry AWS Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/cloud-providers/aws/)
