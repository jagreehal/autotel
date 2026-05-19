#!/usr/bin/env node

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AutotelLambdaStack } from '../infra/stack';
import type { OtelMode } from '../infra/constants';

const app = new cdk.App();

const env = process.env.ENV || 'local';
const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
const account = process.env.CDK_DEFAULT_ACCOUNT || '000000000000';

const otelMode = (process.env.OTEL_MODE as OtelMode | undefined) ?? 'custom-endpoint';
const validModes: OtelMode[] = ['custom-endpoint', 'cloudwatch-direct', 'cloudwatch-adot'];
if (!validModes.includes(otelMode)) {
  throw new Error(
    `Invalid OTEL_MODE='${otelMode}'. Expected one of: ${validModes.join(', ')}`,
  );
}

new AutotelLambdaStack(app, 'AutotelLambdaStack', {
  ENV: env,
  STACK_NAME: `${env}-autotel-lambda`,
  AWS_REGION: region,
  OTEL_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  OTEL_MODE: otelMode,
  ADOT_LAYER_ARN: process.env.ADOT_LAYER_ARN,
  env: {
    account,
    region,
  },
});

app.synth();
