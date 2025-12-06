import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Duration } from 'aws-cdk-lib';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, SourceMapMode, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { StackConfig } from './constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find esbuild binary in the monorepo
const monorepoRoot = path.resolve(__dirname, '../../../..');
const esbuildPath = path.join(monorepoRoot, 'node_modules/.bin/esbuild');

const defaultNodejsFunctionProps: NodejsFunctionProps = {
  bundling: {
    minify: true,
    sourceMap: true,
    sourceMapMode: SourceMapMode.INLINE,
    sourcesContent: false,
    target: 'es2020',
    // External packages that should not be bundled (included in Lambda runtime or layers)
    externalModules: [
      '@aws-sdk/*', // AWS SDK v3 is included in Lambda runtime
    ],
    // Use local bundling with explicit esbuild path (fixes pnpm monorepo issues)
    forceDockerBundling: false,
    esbuildArgs: {
      '--log-level': 'warning',
    },
  },
  // Use Node.js 20 for better LocalStack compatibility
  runtime: Runtime.NODEJS_20_X,
  tracing: Tracing.ACTIVE,
  timeout: Duration.seconds(30),
  memorySize: 256,
};

export interface CreateLambdaOptions {
  scope: Construct;
  id: string;
  file?: string;
  handler?: string;
  props?: NodejsFunctionProps;
  config: StackConfig;
}

export function createLambdaFunction({
  scope,
  id,
  file,
  handler = 'handler',
  props = {},
  config,
}: CreateLambdaOptions): NodejsFunction {
  const functionName = `${config.STACK_NAME}-${id}`;

  const logGroup = new logs.LogGroup(scope, `${functionName}-logs`, {
    retention: logs.RetentionDays.ONE_DAY,
  });

  const lambdaFunction = new NodejsFunction(scope, functionName, {
    entry: path.join(__dirname, `../src/handlers/${file || id}.ts`),
    handler,
    ...defaultNodejsFunctionProps,
    ...props,
    functionName,
    logGroup,
    environment: {
      NODE_OPTIONS: '--enable-source-maps',
      OTEL_SERVICE_NAME: config.STACK_NAME,
      OTEL_EXPORTER_OTLP_ENDPOINT: config.OTEL_ENDPOINT,
      // Note: AWS_REGION is a reserved env var set by Lambda runtime
      ...props.environment,
    },
  });

  return lambdaFunction;
}
