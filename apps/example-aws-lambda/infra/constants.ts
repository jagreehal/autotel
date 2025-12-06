import { StackProps } from 'aws-cdk-lib/core';

export interface StackConfig extends StackProps {
  ENV: string;
  STACK_NAME: string;
  AWS_REGION?: string;
  OTEL_ENDPOINT: string;
}

export const ENV = process.env.ENV || 'local';
export const STACK_NAME = `${ENV}-autotel-lambda`;

// Resource naming - prefixed with stack name for uniqueness
export const bucketName = (stackName: string) => `${stackName}-uploads`;
export const tableName = (stackName: string) => `${stackName}-users`;
export const queueName = (stackName: string) => `${stackName}-notifications`;
