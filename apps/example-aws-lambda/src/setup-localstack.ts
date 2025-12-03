/**
 * Setup script for LocalStack AWS services
 * 
 * This script creates the necessary AWS resources in LocalStack for testing:
 * - S3 bucket
 * - DynamoDB table
 * - SQS queue
 */

import { S3Client, CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, CreateQueueCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const REGION = process.env.AWS_DEFAULT_REGION || 'us-east-1';

// Use non-instrumented clients for setup to avoid tracing overhead
const s3Client = new S3Client({
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
  forcePathStyle: true, // Required for LocalStack
});

const dynamodbClient = new DynamoDBClient({
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

const sqsClient = new SQSClient({
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

async function setupLocalStack() {
  console.log('🚀 Setting up LocalStack resources...\n');

  try {
    // Create S3 bucket (ignore if already exists)
    console.log('1. Creating S3 bucket...');
    try {
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: 'test-bucket',
        })
      );
      console.log('   ✅ S3 bucket "test-bucket" created');
    } catch (error: any) {
      if (error.name === 'BucketAlreadyExists' || error.name === 'BucketAlreadyOwnedByYou') {
        console.log('   ℹ️  S3 bucket "test-bucket" already exists');
      } else {
        throw error;
      }
    }

    // Upload a test file (overwrite if exists)
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'uploads/user-123/test-file.txt',
          Body: 'Hello from LocalStack!',
        })
      );
      console.log('   ✅ Test file uploaded');
    } catch (error: any) {
      if (error.name === 'NoSuchBucket' || error.Code === 'NoSuchBucket') {
        console.log('   ⚠️  Bucket not ready yet, file upload skipped');
      } else {
        console.log('   ⚠️  Could not upload test file:', error.message || error.name || 'Unknown error');
      }
    }

    // Create DynamoDB table (ignore if already exists)
    console.log('\n2. Creating DynamoDB table...');
    try {
      await dynamodbClient.send(
        new CreateTableCommand({
          TableName: 'users',
          AttributeDefinitions: [
            { AttributeName: 'id', AttributeType: 'S' },
          ],
          KeySchema: [
            { AttributeName: 'id', KeyType: 'HASH' },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        })
      );
      console.log('   ✅ DynamoDB table "users" created');
    } catch (error: any) {
      if (error.name === 'ResourceInUseException') {
        console.log('   ℹ️  DynamoDB table "users" already exists');
      } else {
        throw error;
      }
    }

    // Create SQS queue (ignore if already exists)
    console.log('\n3. Creating SQS queue...');
    try {
      await sqsClient.send(
        new CreateQueueCommand({
          QueueName: 'notifications',
        })
      );
      console.log('   ✅ SQS queue "notifications" created');
    } catch (error: any) {
      // SQS CreateQueue is idempotent, but check if queue exists
      if (error.name === 'QueueAlreadyExists' || error.message?.includes('already exists')) {
        console.log('   ℹ️  SQS queue "notifications" already exists');
      } else {
        throw error;
      }
    }

    // Get queue URL
    const queueUrlResult = await sqsClient.send(
      new GetQueueUrlCommand({
        QueueName: 'notifications',
      })
    );
    console.log(`   ✅ Queue URL: ${queueUrlResult.QueueUrl}`);

    console.log('\n✨ LocalStack setup complete!');
    console.log('\n📝 Environment variables for your Lambda:');
    console.log(`   AWS_ENDPOINT_URL=${LOCALSTACK_ENDPOINT}`);
    console.log(`   AWS_REGION=${REGION}`);
    console.log(`   AWS_ACCESS_KEY_ID=test`);
    console.log(`   AWS_SECRET_ACCESS_KEY=test`);
    console.log(`   SQS_QUEUE_URL=${queueUrlResult.QueueUrl}`);

  } catch (error) {
    console.error('❌ Error setting up LocalStack:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Name:', error.name);
    }
    // Don't exit - let the caller handle the error
    throw error;
  }
}

// Run setup if executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('setup-localstack')) {
  setupLocalStack().catch(console.error);
}

export { setupLocalStack };
