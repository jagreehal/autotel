# Testing with LocalStack

This example includes LocalStack integration for testing AWS Lambda handlers with real AWS services locally.

## Quick Start

1. **Start LocalStack:**
   ```bash
   pnpm localstack:up
   # Or: docker-compose up -d
   ```

2. **Setup AWS resources:**
   ```bash
   pnpm setup
   ```
   This creates:
   - S3 bucket: `test-bucket`
   - DynamoDB table: `users`
   - SQS queue: `notifications`

3. **Run tests:**
   ```bash
   SQS_QUEUE_URL="http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/notifications" \
   pnpm test:localstack
   ```

## Docker Compose Services

The `docker-compose.yml` includes:

- **LocalStack** - AWS service emulator on port 4566
- **OpenTelemetry Collector** (optional) - OTLP receiver on ports 4317 (gRPC) and 4318 (HTTP)

## Environment Variables

Set these for LocalStack testing:

```bash
export LOCALSTACK_ENDPOINT=http://localhost:4566
export AWS_DEFAULT_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export SQS_QUEUE_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/notifications
```

## Troubleshooting

### LocalStack not starting
```bash
# Check if port 4566 is already in use
lsof -i :4566

# View LocalStack logs
pnpm localstack:logs
```

### Resources already exist
The setup script handles existing resources gracefully. If you need to reset:
```bash
# Stop and remove containers
docker-compose down -v

# Restart
docker-compose up -d
pnpm setup
```

### S3 bucket errors
If you see `NoSuchBucket` errors:
1. Verify LocalStack is running: `curl http://localhost:4566/_localstack/health`
2. Check bucket exists: `aws --endpoint-url=http://localhost:4566 s3 ls`
3. Re-run setup: `pnpm setup`

## What Gets Tested

The LocalStack test demonstrates:
- ✅ Lambda handler instrumentation
- ✅ S3 operations with tracing
- ✅ DynamoDB operations with tracing
- ✅ SQS message sending with tracing
- ✅ Distributed tracing across AWS services
- ✅ Error handling and span status codes

## Viewing Traces

If using the OpenTelemetry Collector in docker-compose:

- Traces are logged to the collector container's console
- View logs: `docker-compose logs otel-collector`

For other backends, configure `OTEL_EXPORTER_OTLP_ENDPOINT` in your environment.
