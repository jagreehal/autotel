#!/usr/bin/env node

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AutotelLambdaStack } from '../infra/stack';

const app = new cdk.App();

const env = process.env.ENV || 'local';
const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
const account = process.env.CDK_DEFAULT_ACCOUNT || '000000000000';

new AutotelLambdaStack(app, 'AutotelLambdaStack', {
  ENV: env,
  STACK_NAME: `${env}-autotel-lambda`,
  AWS_REGION: region,
  OTEL_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  env: {
    account,
    region,
  },
});

app.synth();
