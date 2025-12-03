/**
 * autotel-aws
 *
 * OpenTelemetry instrumentation for AWS services
 *
 * Features:
 * - Lambda handler instrumentation
 * - AWS SDK v3 auto-instrumentation
 * - Service-specific semantic helpers (S3, DynamoDB, SQS, SNS, Kinesis)
 * - X-Ray compatibility layer
 * - Vendor-agnostic (works with any OTLP backend)
 *
 * @example
 * ```typescript
 * import { init } from 'autotel-aws';
 * import { wrapHandler } from 'autotel-aws/lambda';
 * import { instrumentSDK } from 'autotel-aws/sdk';
 *
 * init({ service: 'my-service', autoDetectResources: true });
 *
 * const s3 = instrumentSDK(new S3Client({}));
 *
 * export const handler = wrapHandler(async (event) => {
 *   await s3.send(new GetObjectCommand({ Bucket: 'my-bucket', Key: 'file.txt' }));
 *   return { statusCode: 200 };
 * });
 * ```
 */

// Re-export types
export type * from './types';
export type * from './config';

// Re-export attribute builders
export * from './attributes';

// Re-export common utilities
export * from './common/error-handlers';
export * from './common/request-builder';
export * from './common/response-builder';
export * from './common/sdk-wrapper';

// Re-export service-specific modules
export * from './lambda';
export * from './sdk';
export * from './s3';
export * from './dynamodb';
export * from './sqs';
export * from './sns';
export * from './kinesis';
export * from './step-functions';
export * from './xray';

/**
 * Initialize autotel-aws with AWS resource detection
 *
 * @example
 * ```typescript
 * import { init } from 'autotel-aws';
 * import { init as autotelInit } from 'autotel';
 *
 * const detectors = getAWSResourceDetectors();
 * autotelInit({
 *   service: 'my-service',
 *   resourceDetectors: detectors,
 * });
 * ```
 */
export async function init(config: import('./config').AWSInitConfig): Promise<void> {
  const { init: autotelInit } = await import('autotel');

  autotelInit({
    service: config.service,
    endpoint: config.endpoint,
    resourceAttributes: {
      'cloud.provider': 'aws',
      'cloud.region': config.region || process.env.AWS_REGION || '',
      ...config.resourceAttributes,
    },
    // Note: autotel's init() doesn't directly accept resourceDetectors
    // AWS resource detection is handled automatically by autotel if
    // @opentelemetry/resource-detector-aws is installed
    // Users can call getAWSResourceDetectors() separately if needed
  });
}

/**
 * Get AWS resource detectors
 *
 * Returns resource detectors for EC2, ECS, EKS, and Lambda
 * Uses @opentelemetry/resource-detector-aws if available
 *
 * @example
 * ```typescript
 * import { getAWSResourceDetectors } from 'autotel-aws';
 * const detectors = await getAWSResourceDetectors();
 * // Use detectors with your OpenTelemetry SDK configuration
 * ```
 */
export async function getAWSResourceDetectors(): Promise<unknown[]> {
  try {
    // Use dynamic import to handle optional dependency
    // @ts-expect-error - Optional peer dependency, may not be installed
    const awsDetectors = await import('@opentelemetry/resource-detector-aws');
    return [
      awsDetectors.awsEc2Detector,
      awsDetectors.awsEcsDetector,
      awsDetectors.awsEksDetector,
      // Note: awsLambdaDetector may not exist in the package
      // Lambda metadata is typically extracted from environment variables
    ];
  } catch {
    // Package not installed, return empty array
    return [];
  }
}
