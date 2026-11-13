---
'autotel': minor
'autotel-aws': minor
---

**autotel**

- `createValueRedactor()` masks structured values, such as response bodies and serialized errors, with the span and log redaction rules. Call it before you write to stdout or a custom destination. It needs no `init()`.
- `OTEL_NODE_RESOURCE_DETECTORS` takes a comma-separated list: `env`, `host`, `os`, `process`, `serviceinstance`, `all` or `none`. `init({ resourceDetectors })` sets the detectors in code.

**autotel-aws**

- SDK spans record the resource each call touched, following the OpenTelemetry AWS SDK conventions: S3 bucket and key, DynamoDB tables (batch, transact and DocumentClient included), SQS queue, SNS topic, Kinesis stream, Lambda function, Step Functions state machine and EventBridge bus. `aws.sdk.attempts` and `aws.sdk.total_retry_delay_ms` record retries. A custom service name keeps these attributes.
- DynamoDB spans set `db.system.name` to `aws.dynamodb`.
- `autotel` moves to a peer dependency, and the AWS SDK client peers accept `^3.300.0`.
