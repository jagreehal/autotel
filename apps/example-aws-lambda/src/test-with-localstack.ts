/**
 * Test Lambda handlers with LocalStack
 * 
 * This script tests the Lambda handlers using LocalStack for AWS services.
 * Make sure LocalStack is running: docker-compose up -d
 */

import 'dotenv/config';
import { init } from 'autotel';
import { wrapHandler, traceLambda } from 'autotel-aws/lambda';
import { setXRayAnnotation } from 'autotel-aws/xray';
import { instrumentSDK, createTracedClient } from 'autotel-aws/sdk';
import { traceDynamoDB } from 'autotel-aws/dynamodb';
import { trace as autotelTrace } from 'autotel';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { S3Event } from 'aws-lambda';
import type { LambdaContext } from 'autotel-aws';
import type { TraceContext } from 'autotel';
import { setupLocalStack } from './setup-localstack.js';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const REGION = process.env.AWS_DEFAULT_REGION || 'us-east-1';

// Initialize autotel
init({
  service: 'example-aws-lambda-localstack',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  debug: true,
});

// Create instrumented AWS SDK clients pointing to LocalStack
const s3 = instrumentSDK(
  new S3Client({
    endpoint: LOCALSTACK_ENDPOINT,
    region: REGION,
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
    forcePathStyle: true,
  })
);

const dynamodb = createTracedClient(DynamoDBClient, {
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

const sqs = instrumentSDK(
  new SQSClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: REGION,
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
  })
);

// S3 operation helper - use trace() directly to avoid traceS3 argument issues
const processS3File = async (bucket: string, key: string) => {
  return autotelTrace('s3.GetObject', async (ctx) => {
    ctx.setAttribute('aws.s3.bucket', bucket);
    ctx.setAttribute('aws.s3.key', key);
    ctx.setAttribute('db.system', 's3'); // Semantic convention

    const result = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    if (result.Body) {
      const content = await result.Body.transformToString();
      ctx.setAttribute('file.size', content.length);
      console.log(`   📄 Processed file: ${key} (${content.length} bytes)`);
      return content;
    }

    return null;
  });
};

// DynamoDB operation helper - use trace() directly for better control
const fetchUserData = async (userId: string) => {
  return autotelTrace('dynamodb.GetItem', async (ctx) => {
    ctx.setAttribute('db.system', 'dynamodb');
    ctx.setAttribute('db.operation', 'GetItem');
    ctx.setAttribute('db.name', 'users');
    ctx.setAttribute('db.statement', 'SELECT * FROM users WHERE id = ?');
    ctx.setAttribute('user.id', userId);

    // Only query if userId is valid
    if (!userId) {
      ctx.setAttribute('user.exists', false);
      console.log(`   ⚠️  No userId provided`);
      return null;
    }

    try {
      const result = await dynamodb.send(
        new GetItemCommand({
          TableName: 'users',
          Key: {
            id: { S: userId },
          },
        })
      );

      if (result.Item) {
        ctx.setAttribute('user.exists', true);
        console.log(`   👤 User found: ${userId}`);
      } else {
        ctx.setAttribute('user.exists', false);
        console.log(`   ⚠️  User not found: ${userId}`);
      }

      return result;
    } catch (error: any) {
      ctx.setAttribute('db.error', error.message || error.name);
      console.log(`   ⚠️  DynamoDB error: ${error.message || error.name}`);
      throw error;
    }
  });
};

// SQS operation helper
// Use trace() directly since traceSQS has limitations with arguments
import { trace } from 'autotel';
import { buildSQSAttributes } from 'autotel-aws/attributes';

const sendNotification = async (data: { bucket: string; key: string; userId?: string }) => {
  const queueUrl = process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/notifications';
  
  return autotelTrace('sqs.send', async (ctx) => {
    // Set SQS semantic attributes
    ctx.setAttribute('messaging.system', 'aws_sqs');
    ctx.setAttribute('messaging.destination.name', 'notifications');
    ctx.setAttribute('messaging.operation', 'send');
    ctx.setAttribute('aws.sqs.queue_url', queueUrl);
    
    // Set custom attributes
    ctx.setAttribute('notification.type', 'file-processed');
    ctx.setAttribute('notification.bucket', data.bucket);
    ctx.setAttribute('notification.key', data.key);

    const result = await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          event: 'file-processed',
          bucket: data.bucket,
          key: data.key,
          userId: data.userId,
          timestamp: new Date().toISOString(),
        }),
      })
    );

    if (result.MessageId) {
      ctx.setAttribute('sqs.message.id', result.MessageId);
      console.log(`   📨 Notification sent: ${result.MessageId}`);
    }

    return result;
  });
};

// Lambda handler that processes S3 events
const uploadHandler = traceLambda<S3Event, { statusCode: number; body: string }>(
  (ctx) => async (event: S3Event, context: LambdaContext) => {
    ctx.setAttribute('lambda.event.source', 's3');
    ctx.setAttribute('lambda.event.record_count', event.Records.length);

    setXRayAnnotation('user.id', 'user-123');
    setXRayAnnotation('operation.type', 'file-upload');

    console.log(`\n📦 Processing ${event.Records.length} S3 record(s)...`);

    for (const record of event.Records) {
      const bucket = record.s3.bucket.name;
      const key = record.s3.object.key;

      ctx.setAttribute('s3.bucket', bucket);
      ctx.setAttribute('s3.key', key);

      // Process S3 file
      // Errors are automatically captured in traces by the library
      const content = await processS3File(bucket, key);
      if (content) {
        console.log(`   ✅ Processed S3 file: ${key}`);
      }

      // Fetch user data
      const userId = extractUserIdFromKey(key);
      if (userId) {
        // Errors are automatically captured in traces by the library
        await fetchUserData(userId);
      }

      // Send notification
      // Errors are automatically captured in traces by the library
      await sendNotification({ bucket, key, userId });
    }

    ctx.setAttribute('processing.complete', true);

    return { statusCode: 200, body: 'Processed successfully' };
  }
);

function extractUserIdFromKey(key: string): string | undefined {
  const match = key.match(/user-(\w+)/);
  return match ? match[1] : undefined;
}

// Test function
async function testWithLocalStack() {
  console.log('🧪 Testing Lambda handlers with LocalStack...\n');

  // Check if LocalStack is available
  try {
    const response = await fetch(`${LOCALSTACK_ENDPOINT}/_localstack/health`);
    if (!response.ok) {
      throw new Error('LocalStack health check failed');
    }
    console.log('✅ LocalStack is running\n');
  } catch (error) {
    console.error('❌ LocalStack is not available!');
    console.error('   Please start LocalStack: docker-compose up -d');
    console.error('   Then run setup: pnpm setup');
    process.exit(1);
  }

  // Setup resources (skip if already set up)
  // Note: Setup may fail if resources already exist, but that's OK
  console.log('ℹ️  Skipping setup (resources should already exist from previous run)');
  console.log('   Run "pnpm setup" separately if you need to recreate resources\n');
  
  // Get queue URL for testing
  const { SQSClient, GetQueueUrlCommand } = await import('@aws-sdk/client-sqs');
  const setupSqs = new SQSClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: REGION,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  const queueResult = await setupSqs.send(new GetQueueUrlCommand({ QueueName: 'notifications' }));
  if (queueResult.QueueUrl && !process.env.SQS_QUEUE_URL) {
    process.env.SQS_QUEUE_URL = queueResult.QueueUrl;
    console.log(`   ✅ Found queue: ${queueResult.QueueUrl}\n`);
  }

  // Mock Lambda context
  const mockContext: LambdaContext = {
    awsRequestId: 'test-request-id-' + Date.now(),
    functionName: 'example-aws-lambda',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:example-aws-lambda',
    memoryLimitInMB: '128',
    getRemainingTimeInMillis: () => 30000,
    logGroupName: '/aws/lambda/example-aws-lambda',
    logStreamName: '2024/01/01/[$LATEST]test',
    callbackWaitsForEmptyEventLoop: false,
  };

  // Test S3 event handler
  console.log('📋 Testing uploadHandler with S3 event...');
  try {
    const s3Event: S3Event = {
      Records: [
        {
          eventVersion: '2.1',
          eventSource: 'aws:s3',
          awsRegion: 'us-east-1',
          eventTime: new Date().toISOString(),
          eventName: 'ObjectCreated:Put',
          userIdentity: {
            principalId: 'test-principal',
          },
          requestParameters: {
            sourceIPAddress: '127.0.0.1',
          },
          responseElements: {
            'x-amz-request-id': 'test-request-id',
            'x-amz-id-2': 'test-id-2',
          },
          s3: {
            s3SchemaVersion: '1.0',
            configurationId: 'test-config',
            bucket: {
              name: 'test-bucket',
              ownerIdentity: {
                principalId: 'test',
              },
              arn: 'arn:aws:s3:::test-bucket',
            },
            object: {
              key: 'uploads/user-123/test-file.txt',
              size: 1024,
              eTag: 'test-etag',
              sequencer: 'test-sequencer',
            },
          },
        },
      ],
    };

    const result = await uploadHandler(s3Event, mockContext);
    console.log(`\n✅ Handler completed: ${result.body}`);
  } catch (error) {
    console.error('❌ Error:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
  }

  console.log('\n✨ Testing complete!');
  console.log('\n📊 Check your OpenTelemetry collector for traces');
  console.log('   (If using docker-compose, traces are logged to console)');
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('test-with-localstack')) {
  testWithLocalStack().catch(console.error);
}
