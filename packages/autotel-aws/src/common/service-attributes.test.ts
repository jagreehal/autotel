/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-unknown-parameters, anti-slop/no-object-parameters, anti-slop/require-safety-comment-for-type-assertion -- Test fakes stand in for SDK clients and commands of any shape. */

import { beforeEach, describe, expect, it } from 'vitest';
import { createTraceCollector, type TraceCollector } from 'autotel/testing';
import { wrapSDKClient } from './sdk-wrapper';

// The wrapper names the service after the client class and the operation
// after the command class, as the real SDK's constructors are named.
function client(
  name: string,
  respond: () => Promise<unknown>,
  service?: string,
) {
  const Client = {
    [name]: class {
      send = respond;
    },
  }[name];
  return wrapSDKClient(new Client() as any, service);
}
function command(name: string, input: unknown) {
  const Command = {
    [name]: class {
      input = input;
    },
  }[name];
  return new Command();
}
const ok =
  (output: object = {}) =>
  async () => ({
    ...output,
    $metadata: { httpStatusCode: 200, attempts: 1, totalRetryDelay: 0 },
  });

describe('per-service SDK span attributes', () => {
  let collector: TraceCollector;
  beforeEach(() => {
    collector = createTraceCollector();
  });
  const attrs = () => collector.getSpans()[0].attributes;

  it('S3: bucket, key and copy source', async () => {
    await client('S3Client', ok()).send(
      command('CopyObjectCommand', {
        Bucket: 'b',
        Key: 'k',
        CopySource: 'src/k',
      }),
    );
    expect(attrs()).toMatchObject({
      'aws.s3.bucket': 'b',
      'aws.s3.key': 'k',
      'aws.s3.copy_source': 'src/k',
    });
  });

  it('keeps service attributes when the span name is overridden', async () => {
    await client('S3Client', ok({ ETag: 'e' }), 's3').send(
      command('GetObjectCommand', { Bucket: 'b', Key: 'k' }),
    );
    expect(collector.getSpans()[0].name).toBe('aws.s3.GetObject');
    expect(attrs()).toMatchObject({ 'aws.s3.bucket': 'b', 'aws.s3.key': 'k' });
  });

  it('DynamoDB: every table in a batch, and consumed capacity', async () => {
    await client(
      'DynamoDBClient',
      ok({ ConsumedCapacity: [{ TableName: 'a', CapacityUnits: 1 }] }),
    ).send(command('BatchGetItemCommand', { RequestItems: { a: {}, b: {} } }));
    expect(attrs()).toMatchObject({
      'db.system.name': 'aws.dynamodb',
      'db.operation.name': 'BatchGetItem',
      'aws.dynamodb.table_names': ['a', 'b'],
      'aws.dynamodb.consumed_capacity': [
        JSON.stringify({ TableName: 'a', CapacityUnits: 1 }),
      ],
    });
    expect(attrs()['db.namespace']).toBeUndefined();
  });

  it('DynamoDB document client: tables in a transaction', async () => {
    await client('DynamoDBDocumentClient', ok()).send(
      command('TransactWriteCommand', {
        TransactItems: [{ Put: { TableName: 't' } }],
      }),
    );
    expect(attrs()).toMatchObject({
      'aws.dynamodb.table_names': ['t'],
      'db.namespace': 't',
    });
  });

  it('SQS: queue name from the URL, and the message id', async () => {
    await client('SQSClient', ok({ MessageId: 'm1' })).send(
      command('SendMessageCommand', {
        QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123/orders',
        MessageBody: 'not recorded',
      }),
    );
    expect(attrs()).toMatchObject({
      'messaging.system': 'aws_sqs',
      'messaging.destination.name': 'orders',
      'messaging.message.id': 'm1',
    });
    expect(JSON.stringify(attrs())).not.toContain('not recorded');
  });

  it('records retries on a failed call and marks the span ERROR', async () => {
    const error = Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
      $metadata: { attempts: 3, totalRetryDelay: 250 },
    });
    await expect(
      client('S3Client', async () => {
        throw error;
      }).send(command('GetObjectCommand', { Bucket: 'b', Key: 'k' })),
    ).rejects.toBe(error);
    const span = collector.getSpans()[0];
    expect(span.status.code).toBe(2);
    expect(span.attributes).toMatchObject({
      'aws.s3.key': 'k',
      'aws.sdk.attempts': 3,
      'aws.sdk.total_retry_delay_ms': 250,
    });
  });

  it('adds nothing for services it does not know', async () => {
    await client('ACMClient', ok()).send(
      command('ListCertificatesCommand', { Bucket: 'ignored' }),
    );
    expect(attrs()['aws.s3.bucket']).toBeUndefined();
  });
});
