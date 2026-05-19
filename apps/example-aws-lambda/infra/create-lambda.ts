import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Duration, Stack } from 'aws-cdk-lib';
import {
  LayerVersion,
  Runtime,
  Tracing,
  type ILayerVersion,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, SourceMapMode, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { StackConfig, type OtelMode } from './constants';

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
  const otelMode: OtelMode = config.OTEL_MODE ?? 'custom-endpoint';

  const logGroup = new logs.LogGroup(scope, `${functionName}-logs`, {
    retention: logs.RetentionDays.ONE_DAY,
  });

  const adotLayer = otelMode === 'cloudwatch-adot'
    ? resolveAdotLayer(scope, functionName, config)
    : undefined;

  const lambdaFunction = new NodejsFunction(scope, functionName, {
    entry: path.join(__dirname, `../src/handlers/${file || id}.ts`),
    handler,
    ...defaultNodejsFunctionProps,
    ...props,
    functionName,
    logGroup,
    layers: [
      ...(adotLayer ? [adotLayer] : []),
      ...(props.layers ?? []),
    ],
    environment: {
      NODE_OPTIONS: '--enable-source-maps',
      OTEL_SERVICE_NAME: config.STACK_NAME,
      ...otelEnvironment(otelMode, config),
      ...props.environment,
    },
  });

  return lambdaFunction;
}

function otelEnvironment(mode: OtelMode, config: StackConfig): Record<string, string> {
  const region = config.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'us-east-1';
  switch (mode) {
    case 'custom-endpoint':
      // Original behaviour: a single endpoint for everything (LocalStack,
      // standalone collector, vendor backend, etc.).
      return {
        OTEL_EXPORTER_OTLP_ENDPOINT: config.OTEL_ENDPOINT,
      };
    case 'cloudwatch-direct':
      // In-process SigV4 exporters (autotel-aws/cloudwatch). Each signal
      // gets its own per-region endpoint. AWS_REGION is set by the Lambda
      // runtime — read by the exporters as the SigV4 region.
      return {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `https://xray.${region}.amazonaws.com/v1/traces`,
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `https://logs.${region}.amazonaws.com/v1/logs`,
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `https://monitoring.${region}.amazonaws.com/v1/metrics`,
        OTEL_MODE: 'cloudwatch-direct',
      };
    case 'cloudwatch-adot':
      // ADOT collector layer handles transport. The layer reads the same
      // OTEL_EXPORTER_OTLP_*_ENDPOINT vars (with `sigv4authextension`
      // configured in collector config) and signs on the way out.
      return {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `https://xray.${region}.amazonaws.com/v1/traces`,
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `https://logs.${region}.amazonaws.com/v1/logs`,
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `https://monitoring.${region}.amazonaws.com/v1/metrics`,
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-handler',
        OPENTELEMETRY_COLLECTOR_CONFIG_URI: '/opt/collector-config/config.yaml',
        OTEL_MODE: 'cloudwatch-adot',
      };
  }
}

function resolveAdotLayer(
  scope: Construct,
  functionName: string,
  config: StackConfig,
): ILayerVersion {
  if (!config.ADOT_LAYER_ARN) {
    throw new Error(
      `createLambdaFunction[${functionName}]: OTEL_MODE='cloudwatch-adot' requires ADOT_LAYER_ARN. ` +
        'Look up the ARN for your region at https://aws-otel.github.io/docs/getting-started/lambda.',
    );
  }
  return LayerVersion.fromLayerVersionArn(
    scope,
    `${functionName}-adot-layer`,
    config.ADOT_LAYER_ARN,
  );
}
