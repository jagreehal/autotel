/**
 * AWS semantic attribute helpers
 * Following OpenTelemetry AWS semantic conventions
 */

/**
 * AWS semantic attribute keys
 */
export const AWS_ATTRS = {
  // Lambda
  LAMBDA_FUNCTION_NAME: 'faas.name',
  LAMBDA_FUNCTION_VERSION: 'faas.version',
  LAMBDA_INVOCATION_ID: 'faas.invocation_id',
  LAMBDA_COLD_START: 'faas.coldstart',
  LAMBDA_TRIGGER: 'faas.trigger',

  // AWS SDK
  AWS_SERVICE: 'rpc.service',
  AWS_OPERATION: 'rpc.method',
  AWS_REQUEST_ID: 'aws.request_id',
  AWS_EXTENDED_REQUEST_ID: 'aws.extended_request_id',
  AWS_CF_ID: 'aws.cf_id',

  // DynamoDB
  DDB_TABLE_NAMES: 'aws.dynamodb.table_names',
  DDB_CONSUMED_CAPACITY: 'aws.dynamodb.consumed_capacity',

  // S3
  S3_BUCKET: 'aws.s3.bucket',
  S3_KEY: 'aws.s3.key',
  S3_COPY_SOURCE: 'aws.s3.copy_source',

  // SQS
  SQS_QUEUE_NAME: 'messaging.destination.name',
  SQS_QUEUE_URL: 'aws.sqs.queue_url',
  SQS_MESSAGE_ID: 'messaging.message.id',

  // SNS
  SNS_TOPIC_ARN: 'messaging.destination.name',
  SNS_MESSAGE_ID: 'messaging.message.id',

  // Kinesis
  KINESIS_STREAM_NAME: 'messaging.destination.name',
  KINESIS_SHARD_ID: 'aws.kinesis.shard_id',

  // Step Functions
  SFN_STATE_MACHINE_ARN: 'aws.stepfunctions.state_machine_arn',
  SFN_EXECUTION_ARN: 'aws.stepfunctions.execution_arn',
  SFN_ACTIVITY_ARN: 'aws.stepfunctions.activity_arn',

  // EventBridge
  EVENTBRIDGE_EVENT_BUS: 'aws.eventbridge.event_bus',
  EVENTBRIDGE_SOURCE: 'aws.eventbridge.source',
  EVENTBRIDGE_DETAIL_TYPE: 'aws.eventbridge.detail_type',

  // X-Ray
  XRAY_ANNOTATIONS: 'aws.xray.annotations',
} as const;

/**
 * Build Lambda span attributes
 */
export function buildLambdaAttributes(context: {
  awsRequestId: string;
  functionName: string;
  functionVersion: string;
  coldStart?: boolean;
  trigger?: string;
}): Record<string, string | boolean> {
  return {
    [AWS_ATTRS.LAMBDA_FUNCTION_NAME]: context.functionName,
    [AWS_ATTRS.LAMBDA_FUNCTION_VERSION]: context.functionVersion,
    [AWS_ATTRS.LAMBDA_INVOCATION_ID]: context.awsRequestId,
    'cloud.provider': 'aws',
    'cloud.region': process.env.AWS_REGION || '',
    ...(context.coldStart !== undefined && {
      [AWS_ATTRS.LAMBDA_COLD_START]: context.coldStart,
    }),
    ...(context.trigger && {
      [AWS_ATTRS.LAMBDA_TRIGGER]: context.trigger,
    }),
  };
}

/**
 * Build AWS SDK span attributes
 */
export function buildSDKAttributes(metadata: {
  service: string;
  operation: string;
  requestId?: string;
  httpStatusCode?: number;
  extendedRequestId?: string;
  cfId?: string;
}): Record<string, string | number> {
  return {
    'rpc.system': 'aws-api',
    [AWS_ATTRS.AWS_SERVICE]: metadata.service,
    [AWS_ATTRS.AWS_OPERATION]: metadata.operation,
    ...(metadata.requestId && {
      [AWS_ATTRS.AWS_REQUEST_ID]: metadata.requestId,
    }),
    ...(metadata.httpStatusCode && {
      'http.status_code': metadata.httpStatusCode,
    }),
    ...(metadata.extendedRequestId && {
      [AWS_ATTRS.AWS_EXTENDED_REQUEST_ID]: metadata.extendedRequestId,
    }),
    ...(metadata.cfId && {
      [AWS_ATTRS.AWS_CF_ID]: metadata.cfId,
    }),
  };
}

/**
 * Build DynamoDB span attributes
 */
export function buildDynamoDBAttributes(operation: {
  tableName: string;
  operation: string;
  consumedCapacity?: number;
}): Record<string, string | number | string[]> {
  return {
    'db.system': 'dynamodb',
    'db.operation': operation.operation,
    'db.name': operation.tableName,
    [AWS_ATTRS.DDB_TABLE_NAMES]: [operation.tableName],
    ...(operation.consumedCapacity !== undefined && {
      [AWS_ATTRS.DDB_CONSUMED_CAPACITY]: operation.consumedCapacity,
    }),
  };
}

/**
 * Build S3 span attributes
 */
export function buildS3Attributes(operation: {
  bucket: string;
  key?: string;
  copySource?: string;
}): Record<string, string> {
  return {
    [AWS_ATTRS.S3_BUCKET]: operation.bucket,
    ...(operation.key && {
      [AWS_ATTRS.S3_KEY]: operation.key,
    }),
    ...(operation.copySource && {
      [AWS_ATTRS.S3_COPY_SOURCE]: operation.copySource,
    }),
  };
}

/**
 * Build SQS span attributes
 */
export function buildSQSAttributes(operation: {
  queueName: string;
  queueUrl?: string;
  messageId?: string;
  operation: 'send' | 'receive';
}): Record<string, string> {
  return {
    'messaging.system': 'aws_sqs',
    [AWS_ATTRS.SQS_QUEUE_NAME]: operation.queueName,
    'messaging.operation': operation.operation,
    ...(operation.queueUrl && {
      [AWS_ATTRS.SQS_QUEUE_URL]: operation.queueUrl,
    }),
    ...(operation.messageId && {
      [AWS_ATTRS.SQS_MESSAGE_ID]: operation.messageId,
    }),
  };
}

/**
 * Build SNS span attributes
 */
export function buildSNSAttributes(operation: {
  topicArn: string;
  messageId?: string;
}): Record<string, string> {
  return {
    'messaging.system': 'aws_sns',
    [AWS_ATTRS.SNS_TOPIC_ARN]: operation.topicArn,
    'messaging.operation': 'publish',
    ...(operation.messageId && {
      [AWS_ATTRS.SNS_MESSAGE_ID]: operation.messageId,
    }),
  };
}

/**
 * Build Kinesis span attributes
 */
export function buildKinesisAttributes(operation: {
  streamName: string;
  shardId?: string;
  operation: 'put' | 'get';
}): Record<string, string> {
  return {
    'messaging.system': 'aws_kinesis',
    [AWS_ATTRS.KINESIS_STREAM_NAME]: operation.streamName,
    'messaging.operation': operation.operation,
    ...(operation.shardId && {
      [AWS_ATTRS.KINESIS_SHARD_ID]: operation.shardId,
    }),
  };
}

/**
 * Build Step Functions span attributes
 */
export function buildStepFunctionsAttributes(operation: {
  stateMachineArn: string;
  executionArn?: string;
  activityArn?: string;
}): Record<string, string> {
  return {
    [AWS_ATTRS.SFN_STATE_MACHINE_ARN]: operation.stateMachineArn,
    ...(operation.executionArn && {
      [AWS_ATTRS.SFN_EXECUTION_ARN]: operation.executionArn,
    }),
    ...(operation.activityArn && {
      [AWS_ATTRS.SFN_ACTIVITY_ARN]: operation.activityArn,
    }),
  };
}

/**
 * Build EventBridge span attributes
 */
export function buildEventBridgeAttributes(operation: {
  eventBus: string;
  source: string;
  detailType: string;
}): Record<string, string> {
  return {
    [AWS_ATTRS.EVENTBRIDGE_EVENT_BUS]: operation.eventBus,
    [AWS_ATTRS.EVENTBRIDGE_SOURCE]: operation.source,
    [AWS_ATTRS.EVENTBRIDGE_DETAIL_TYPE]: operation.detailType,
  };
}
