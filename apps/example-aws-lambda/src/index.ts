/**
 * AWS Lambda example with autotel-aws
 *
 * This example demonstrates:
 * - Lambda handler instrumentation with wrapHandler()
 * - Lambda handler with traceLambda() for context access
 * - AWS SDK v3 instrumentation (S3, DynamoDB, SQS)
 * - Service-specific semantic helpers
 * - X-Ray annotation helpers
 *
 * Run: pnpm start
 *
 * This simulates a Lambda function that processes user uploads:
 * 1. Receives S3 event notification
 * 2. Fetches user data from DynamoDB
 * 3. Processes the file
 * 4. Sends notification via SQS
 */

import 'dotenv/config';
import { init } from 'autotel';
import { wrapHandler, traceLambda } from 'autotel-aws/lambda';
import { setXRayAnnotation } from 'autotel-aws/xray';
import { instrumentSDK, createTracedClient } from 'autotel-aws/sdk';
import { traceS3 } from 'autotel-aws/s3';
import { traceDynamoDB } from 'autotel-aws/dynamodb';
import { traceSQS } from 'autotel-aws/sqs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { S3Event } from 'aws-lambda';
import type { LambdaContext } from 'autotel-aws';
import type { TraceContext } from 'autotel';

// Initialize autotel
init({
  service: 'example-aws-lambda',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  debug: true,
});

// Create instrumented AWS SDK clients
// Note: These will fail in local testing without AWS credentials/endpoints
// In production, these would connect to real AWS services
const s3 = instrumentSDK(new S3Client({ region: 'us-east-1' }));
const dynamodb = createTracedClient(DynamoDBClient, { region: 'us-east-1' });
const sqs = instrumentSDK(new SQSClient({ region: 'us-east-1' }));

// Example 1: Simple handler wrapper
export const simpleHandler = wrapHandler(async (event: { message: string }, context: LambdaContext) => {
  console.log('Processing message:', event.message);
  return { statusCode: 200, body: JSON.stringify({ message: 'Success' }) };
});

// Example 2: Handler with context access using traceLambda
export const uploadHandler = traceLambda<S3Event, { statusCode: number; body: string }>(
  (ctx) => async (event: S3Event, context: LambdaContext) => {
  // Set custom attributes (ctx is TraceContext)
  ctx.setAttribute('lambda.event.source', 's3');
  ctx.setAttribute('lambda.event.record_count', event.Records.length);

  // Use X-Ray annotations (indexed in X-Ray console)
  setXRayAnnotation('user.id', 'user-123');
  setXRayAnnotation('operation.type', 'file-upload');

  // Process each S3 record
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = record.s3.object.key;

    ctx.setAttribute('s3.bucket', bucket);
    ctx.setAttribute('s3.key', key);

    // Use service-specific semantic helpers
    // Errors are automatically captured in traces by the library
    await processS3File(bucket, key);
    
    // Fetch user data from DynamoDB
    const userId = extractUserIdFromKey(key);
    if (userId) {
      await fetchUserData(userId);
    }

    // Send notification (commented out for local testing - requires AWS services)
    // await sendNotification({ bucket, key, userId });
    
    // Set more attributes using context
    ctx.setAttribute('processing.complete', true);
  }

  return { statusCode: 200, body: 'Processed successfully' };
});

// Example 3: S3 operation with semantic helper
const processS3File = traceS3({
  operation: 'GetObject',
  bucket: 'my-bucket', // Will be overridden by actual bucket
})((ctx) => async (bucket: string, key: string) => {
  ctx.setAttribute('aws.s3.bucket', bucket);
  ctx.setAttribute('aws.s3.key', key);

  // Simulate S3 operation
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  // Process file content
  if (result.Body) {
    const content = await result.Body.transformToString();
    ctx.setAttribute('file.size', content.length);
    console.log(`Processed file: ${key} (${content.length} bytes)`);
  }

  return result;
});

// Example 4: DynamoDB operation with semantic helper
const fetchUserData = traceDynamoDB({
  operation: 'GetItem',
  table: 'users',
})((ctx) => async (userId: string) => {
  ctx.setAttribute('db.statement', 'SELECT * FROM users WHERE id = ?');
  ctx.setAttribute('user.id', userId);

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
    console.log(`Fetched user: ${userId}`);
  } else {
    ctx.setAttribute('user.exists', false);
  }

  return result;
});

// Example 5: SQS operation with semantic helper
// Now using the fixed traceSQS which properly forwards arguments
const sendNotification = traceSQS({
  operation: 'send',
  queueName: 'notifications',
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/notifications',
})((ctx) => async (data: { bucket: string; key: string; userId?: string }) => {
  // Set custom attributes
  ctx.setAttribute('notification.type', 'file-processed');
  ctx.setAttribute('notification.bucket', data.bucket);
  ctx.setAttribute('notification.key', data.key);

  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/notifications',
      MessageBody: JSON.stringify({
        event: 'file-processed',
        bucket: data.bucket,
        key: data.key,
        userId: data.userId,
        timestamp: new Date().toISOString(),
      }),
    }),
  );

  if (result.MessageId) {
    ctx.setAttribute('messaging.message.id', result.MessageId);
    console.log(`Sent notification: ${result.MessageId}`);
  }

  return result;
});

// Helper function
function extractUserIdFromKey(key: string): string | undefined {
  // Example: extract user-123 from path like "uploads/user-123/file.txt"
  const match = key.match(/user-(\w+)/);
  return match ? match[1] : undefined;
}

// Example handler for API Gateway events
export const apiHandler = wrapHandler(
  async (event: { httpMethod: string; path: string; body?: string }, context: LambdaContext) => {
    console.log(`${event.httpMethod} ${event.path}`);

    if (event.path === '/health') {
      return {
        statusCode: 200,
        body: JSON.stringify({ status: 'ok', service: 'example-aws-lambda' }),
      };
    }

    if (event.path === '/users/:userId' && event.httpMethod === 'GET') {
      const userId = 'user-123'; // Extract from path
      // Errors are automatically captured in traces by the library
      await fetchUserData(userId);
      return {
        statusCode: 200,
        body: JSON.stringify({ userId, message: 'User data fetched' }),
      };
    }

    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Not found' }),
    };
  },
  {
    captureResponse: true,
    extractTraceContext: true,
  }
);

// Local testing (simulates Lambda execution)
// Only run tests if explicitly requested
if (process.env.RUN_TESTS === 'true') {
  console.log('🧪 Testing Lambda handlers locally...\n');

  // Mock Lambda context
  const mockContext: LambdaContext = {
    awsRequestId: 'test-request-id',
    functionName: 'example-aws-lambda',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:example-aws-lambda',
    memoryLimitInMB: '128',
    getRemainingTimeInMillis: () => 30_000,
    logGroupName: '/aws/lambda/example-aws-lambda',
    logStreamName: '2024/01/01/[$LATEST]test',
    callbackWaitsForEmptyEventLoop: false,
  };

  // Test simple handler
  console.log('1. Testing simpleHandler...');
  try {
    const result1 = await simpleHandler({ message: 'Hello from Lambda!' }, mockContext);
    console.log('✅ Result:', result1);
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Test API handler
  console.log('\n2. Testing apiHandler...');
  try {
    const result2 = await apiHandler(
      {
        httpMethod: 'GET',
        path: '/health',
      },
      mockContext
    );
    console.log('✅ Result:', result2);
  } catch (error) {
    console.error('❌ Error:', error);
  }

  console.log('\n✨ All tests completed!');
  console.log('\n💡 Note: Some operations may fail in local testing (AWS services not available)');
  console.log('   This is expected - the instrumentation still works and creates traces');
  console.log('\n💡 To test with real AWS services:');
  console.log('   1. Use LocalStack: pnpm test:localstack');
  console.log('   2. Or deploy to AWS Lambda');
  console.log('   3. Set OTEL_EXPORTER_OTLP_ENDPOINT environment variable');
  console.log('   4. View traces in your observability backend');
  
  // Exit successfully even if some AWS calls failed (this is a demo)
  process.exit(0);
}
