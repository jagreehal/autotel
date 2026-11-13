/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- Decodes AWS SDK command input and output, whose shapes vary per command; each field is type-checked before it becomes an attribute. */

/**
 * Per-service span attributes for AWS SDK v3 calls, read from the command's
 * input and output. Names follow the OpenTelemetry AWS SDK conventions:
 * https://opentelemetry.io/docs/specs/semconv/cloud-providers/aws-sdk/
 *
 * Only identifiers and counts are read, never payloads (item values, message
 * bodies, object contents).
 */

import type { AttributeValue } from '@opentelemetry/api';

type Attrs = Record<string, AttributeValue>;
type Data = Record<string, any>;
type Extractor = {
  request?: (input: Data, operation: string) => Attrs;
  response?: (output: Data, operation: string) => Attrs;
};

/** Drops undefined values so callers can write every field inline. */
function compact(attrs: Record<string, AttributeValue | undefined>): Attrs {
  const out: Attrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const len = (v: unknown) => (Array.isArray(v) ? v.length : undefined);
/** The resource name at the end of a queue URL or an ARN. */
const lastSegment = (v: unknown, sep: string) =>
  typeof v === 'string' ? v.slice(v.lastIndexOf(sep) + 1) : undefined;

/** Every table a DynamoDB call touches, including batch and transact calls. */
function dynamoTables(input: Data): string[] | undefined {
  const names = new Set<string>();
  if (typeof input.TableName === 'string') names.add(input.TableName);
  if (input.RequestItems && typeof input.RequestItems === 'object') {
    for (const name of Object.keys(input.RequestItems)) names.add(name);
  }
  for (const item of input.TransactItems ?? []) {
    // SAFETY: each TransactItems entry maps one operation name to its request;
    // TableName is type-checked before use.
    for (const op of Object.values(item ?? {}) as Data[]) {
      if (typeof op?.TableName === 'string') names.add(op.TableName);
    }
  }
  return names.size > 0 ? [...names] : undefined;
}

function dynamoCapacity(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v : [v]).map((c) => JSON.stringify(c));
}

const EXTRACTORS = {
  S3: {
    request: (i) =>
      compact({
        'aws.s3.bucket': str(i.Bucket),
        'aws.s3.key': str(i.Key),
        'aws.s3.copy_source': str(i.CopySource),
        'aws.s3.upload_id': str(i.UploadId),
        'aws.s3.part_number': num(i.PartNumber),
        'aws.s3.delete.count': len(i.Delete?.Objects),
      }),
    response: (o) =>
      compact({
        'aws.s3.upload_id': str(o.UploadId),
        'aws.s3.delete.error_count': len(o.Errors),
      }),
  },
  DynamoDB: {
    request: (i, operation) => {
      const tables = dynamoTables(i);
      return compact({
        'db.system.name': 'aws.dynamodb',
        'db.operation.name': operation,
        'db.namespace': tables?.length === 1 ? tables[0] : undefined,
        'aws.dynamodb.table_names': tables,
        'aws.dynamodb.index_name': str(i.IndexName),
        'aws.dynamodb.consistent_read': bool(i.ConsistentRead),
        'aws.dynamodb.limit': num(i.Limit),
        'aws.dynamodb.projection': str(i.ProjectionExpression),
        'aws.dynamodb.select': str(i.Select),
        'aws.dynamodb.scan_forward': bool(i.ScanIndexForward),
        'aws.dynamodb.segment': num(i.Segment),
        'aws.dynamodb.total_segments': num(i.TotalSegments),
      });
    },
    response: (o) =>
      compact({
        'aws.dynamodb.consumed_capacity': dynamoCapacity(o.ConsumedCapacity),
        'aws.dynamodb.count': num(o.Count),
        'aws.dynamodb.scanned_count': num(o.ScannedCount),
      }),
  },
  SQS: {
    request: (i, operation) =>
      compact({
        'messaging.system': 'aws_sqs',
        'messaging.operation.name': operation,
        'aws.sqs.queue.url': str(i.QueueUrl),
        'messaging.destination.name':
          str(i.QueueName) ?? lastSegment(i.QueueUrl, '/'),
        'messaging.batch.message_count': len(i.Entries),
      }),
    response: (o) =>
      compact({
        'messaging.message.id': str(o.MessageId),
        'messaging.batch.message_count': len(o.Messages),
      }),
  },
  SNS: {
    request: (i, operation) => {
      const arn = str(i.TopicArn) ?? str(i.TargetArn);
      return compact({
        'messaging.system': 'aws_sns',
        'messaging.operation.name': operation,
        'aws.sns.topic.arn': arn,
        'messaging.destination.name': lastSegment(arn, ':'),
        'messaging.batch.message_count': len(i.PublishBatchRequestEntries),
      });
    },
    response: (o) => compact({ 'messaging.message.id': str(o.MessageId) }),
  },
  Kinesis: {
    request: (i) =>
      compact({
        'aws.kinesis.stream_name':
          str(i.StreamName) ?? lastSegment(i.StreamARN, '/'),
        'messaging.batch.message_count': len(i.Records),
      }),
  },
  Lambda: {
    request: (i) =>
      compact({
        'faas.invoked_name': str(i.FunctionName),
        'faas.invoked_provider': i.FunctionName ? 'aws' : undefined,
        'aws.lambda.resource_mapping.id': str(i.UUID),
      }),
  },
  SFN: {
    request: (i) =>
      compact({
        'aws.step_functions.state_machine.arn': str(i.stateMachineArn),
        'aws.step_functions.activity.arn': str(i.activityArn),
      }),
  },
  EventBridge: {
    request: (i) =>
      compact({
        'aws.eventbridge.event_bus':
          str(i.EventBusName) ?? str(i.Entries?.[0]?.EventBusName),
        'messaging.batch.message_count': len(i.Entries),
      }),
    response: (o) =>
      compact({
        'aws.eventbridge.failed_entry_count': num(o.FailedEntryCount),
      }),
  },
  SecretsManager: {
    response: (o) => compact({ 'aws.secretsmanager.secret.arn': str(o.ARN) }),
  },
} satisfies Record<string, Extractor>;

/** `DynamoDBDocument` (lib-dynamodb) shares DynamoDB's request shapes. */
function extractorFor(service: string): Extractor | undefined {
  const name = service.replace(/Document$/, '');
  // SAFETY: `Object.hasOwn` confirms `name` is one of the keys.
  return Object.hasOwn(EXTRACTORS, name)
    ? EXTRACTORS[name as keyof typeof EXTRACTORS]
    : undefined;
}

export function serviceRequestAttributes(
  service: string,
  operation: string,
  input: unknown,
): Attrs {
  const extract = extractorFor(service)?.request;
  if (!extract || !input || typeof input !== 'object') return {};
  // SAFETY: an object; extractors type-check each field they read.
  return extract(input as Data, operation);
}

export function serviceResponseAttributes(
  service: string,
  operation: string,
  output: unknown,
): Attrs {
  const extract = extractorFor(service)?.response;
  if (!extract || !output || typeof output !== 'object') return {};
  // SAFETY: an object; extractors type-check each field they read.
  return extract(output as Data, operation);
}

/**
 * Retries the SDK made before this call succeeded or gave up. Set on errors
 * too, where they explain a timeout or throttle.
 */
export function retryAttributes(metadata: unknown): Attrs {
  // SAFETY: `num()` type-checks both fields read below.
  const m = (metadata ?? {}) as Data;
  return compact({
    'aws.sdk.attempts': num(m.attempts),
    'aws.sdk.total_retry_delay_ms': num(m.totalRetryDelay),
  });
}
