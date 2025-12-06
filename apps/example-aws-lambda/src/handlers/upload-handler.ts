/**
 * Upload Handler - Triggered by S3 events
 *
 * Demonstrates:
 * - traceLambda() for context access
 * - AWS SDK v3 instrumentation
 * - Service-specific semantic helpers
 * - X-Ray annotations
 */

import { init } from 'autotel';
import { traceLambda } from 'autotel-aws/lambda';
import { setXRayAnnotation } from 'autotel-aws/xray';
import { instrumentSDK } from 'autotel-aws/sdk';
import { traceS3 } from 'autotel-aws/s3';
import { traceDynamoDB } from 'autotel-aws/dynamodb';
import { traceSQS } from 'autotel-aws/sqs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { S3Event } from 'aws-lambda';

// Initialize autotel (reads from OTEL_* env vars)
init({
  service: process.env.OTEL_SERVICE_NAME || 'autotel-lambda',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
});

// Create instrumented AWS SDK clients
const s3 = instrumentSDK(new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
}));

const dynamodb = instrumentSDK(new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
}));

const sqs = instrumentSDK(new SQSClient({
  region: process.env.AWS_REGION || 'us-east-1',
}));

// S3 file processing with semantic attributes
const processS3File = traceS3({
  operation: 'GetObject',
  bucket: process.env.S3_BUCKET_NAME || 'uploads',
})((ctx) => async (bucket: string, key: string) => {
  ctx.setAttribute('aws.s3.bucket', bucket);
  ctx.setAttribute('aws.s3.key', key);

  const result = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  if (result.Body) {
    const content = await result.Body.transformToString();
    ctx.setAttribute('file.size', content.length);
    return { content, contentType: result.ContentType };
  }

  return null;
});

// DynamoDB user lookup with semantic attributes
const fetchUserData = traceDynamoDB({
  operation: 'GetItem',
  table: process.env.DYNAMODB_TABLE_NAME || 'users',
})((ctx) => async (userId: string) => {
  ctx.setAttribute('db.statement', 'SELECT * FROM users WHERE id = ?');
  ctx.setAttribute('user.id', userId);

  const result = await dynamodb.send(
    new GetItemCommand({
      TableName: process.env.DYNAMODB_TABLE_NAME || 'users',
      Key: { id: { S: userId } },
    })
  );

  ctx.setAttribute('user.exists', !!result.Item);
  return result.Item;
});

// Record file upload in DynamoDB
const recordUpload = traceDynamoDB({
  operation: 'PutItem',
  table: process.env.DYNAMODB_TABLE_NAME || 'users',
})((ctx) => async (userId: string, fileKey: string, fileSize: number) => {
  ctx.setAttribute('user.id', userId);
  ctx.setAttribute('file.key', fileKey);

  await dynamodb.send(
    new PutItemCommand({
      TableName: process.env.DYNAMODB_TABLE_NAME || 'users',
      Item: {
        id: { S: userId },
        lastUpload: { S: fileKey },
        lastUploadSize: { N: String(fileSize) },
        updatedAt: { S: new Date().toISOString() },
      },
    })
  );
});

// SQS notification with semantic attributes
const sendNotification = traceSQS({
  operation: 'send',
  queueName: 'notifications',
  queueUrl: process.env.SQS_QUEUE_URL,
})((ctx) => async (data: { bucket: string; key: string; userId?: string; fileSize?: number }) => {
  ctx.setAttribute('notification.type', 'file-processed');
  ctx.setAttribute('notification.bucket', data.bucket);
  ctx.setAttribute('notification.key', data.key);

  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({
        event: 'file-processed',
        ...data,
        timestamp: new Date().toISOString(),
      }),
    })
  );

  if (result.MessageId) {
    ctx.setAttribute('messaging.message.id', result.MessageId);
  }

  return result;
});

// Helper to extract userId from S3 key
function extractUserIdFromKey(key: string): string | undefined {
  const match = key.match(/user-(\w+)/);
  return match ? match[1] : undefined;
}

// Main handler using traceLambda for context access
export const handler = traceLambda<S3Event, { statusCode: number; body: string }>(
  (ctx) => async (event) => {
    ctx.setAttribute('lambda.event.source', 's3');
    ctx.setAttribute('lambda.event.record_count', event.Records.length);

    // X-Ray annotations for filtering in X-Ray console
    setXRayAnnotation('operation.type', 'file-upload');

    let processedCount = 0;

    for (const record of event.Records) {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      ctx.setAttribute('s3.bucket', bucket);
      ctx.setAttribute('s3.key', key);

      // Process the file
      const fileData = await processS3File(bucket, key);

      if (fileData) {
        const userId = extractUserIdFromKey(key);

        if (userId) {
          setXRayAnnotation('user.id', userId);

          // Check if user exists
          await fetchUserData(userId);

          // Record the upload
          await recordUpload(userId, key, fileData.content.length);
        }

        // Send notification
        await sendNotification({
          bucket,
          key,
          userId,
          fileSize: fileData.content.length,
        });

        processedCount++;
      }
    }

    ctx.setAttribute('processing.complete', true);
    ctx.setAttribute('processing.count', processedCount);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Processed ${processedCount} files` }),
    };
  }
);
