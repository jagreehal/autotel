import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
// import * as s3n from 'aws-cdk-lib/aws-s3-notifications'; // Disabled for LocalStack
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { StackConfig, bucketName, tableName, queueName } from './constants';
import { createLambdaFunction } from './create-lambda';

export class AutotelLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StackConfig) {
    super(scope, id, props);

    // Create S3 bucket for file uploads
    // Note: autoDeleteObjects disabled for LocalStack compatibility (requires extra Lambda)
    const uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      bucketName: bucketName(props.STACK_NAME),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: false,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Create DynamoDB table for users
    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: tableName(props.STACK_NAME),
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create SQS queue for notifications
    const notificationsQueue = new sqs.Queue(this, 'NotificationsQueue', {
      queueName: queueName(props.STACK_NAME),
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
    });

    // Create upload handler Lambda
    const uploadHandler = createLambdaFunction({
      scope: this,
      id: 'upload-handler',
      config: props,
      props: {
        timeout: cdk.Duration.minutes(1),
        environment: {
          DYNAMODB_TABLE_NAME: usersTable.tableName,
          SQS_QUEUE_URL: notificationsQueue.queueUrl,
          S3_BUCKET_NAME: uploadsBucket.bucketName,
        },
      },
    });

    // Grant permissions
    uploadsBucket.grantRead(uploadHandler);
    usersTable.grantReadWriteData(uploadHandler);
    notificationsQueue.grantSendMessages(uploadHandler);

    // Note: S3 event notifications disabled for LocalStack compatibility
    // S3 notifications require a Python Lambda that LocalStack can't create
    // For production, uncomment this:
    // uploadsBucket.addEventNotification(
    //   s3.EventType.OBJECT_CREATED,
    //   new s3n.LambdaDestination(uploadHandler),
    //   { prefix: 'uploads/' }
    // );

    // Create API handler Lambda
    const apiHandler = createLambdaFunction({
      scope: this,
      id: 'api-handler',
      config: props,
      props: {
        environment: {
          DYNAMODB_TABLE_NAME: usersTable.tableName,
        },
      },
    });

    usersTable.grantReadData(apiHandler);

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: uploadsBucket.bucketName,
      description: 'S3 bucket for file uploads',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: usersTable.tableName,
      description: 'DynamoDB table for users',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: notificationsQueue.queueUrl,
      description: 'SQS queue URL for notifications',
    });

    new cdk.CfnOutput(this, 'UploadHandlerArn', {
      value: uploadHandler.functionArn,
      description: 'Upload handler Lambda ARN',
    });

    new cdk.CfnOutput(this, 'ApiHandlerArn', {
      value: apiHandler.functionArn,
      description: 'API handler Lambda ARN',
    });
  }
}
