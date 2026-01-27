import type { PlatformPreset } from '../../types/index';

/**
 * AWS Lambda platform preset
 */
export const awsLambda: PlatformPreset = {
  name: 'AWS Lambda',
  slug: 'aws-lambda',
  type: 'platform',
  description: 'AWS Lambda support with cold start handling',
  packages: {
    required: [
      'autotel-platforms',
      '@opentelemetry/instrumentation-aws-lambda',
    ],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [
      {
        name: 'AWS_LAMBDA_FUNCTION_NAME',
        description: 'Lambda function name (auto-set by AWS)',
        example: 'my-function',
        sensitive: false,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-platforms/aws',
      specifiers: ['createLambdaConfig'],
    },
  ],
  configBlock: {
    type: 'platform',
    code: '...createLambdaConfig(),',
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Add the Lambda layer or bundle instrumentation with your function',
    'Set OTEL_* environment variables in Lambda configuration',
  ],
};

/**
 * Cloudflare Workers platform preset
 */
export const cloudflare: PlatformPreset = {
  name: 'Cloudflare Workers',
  slug: 'cloudflare',
  type: 'platform',
  description: 'Cloudflare Workers support',
  packages: {
    required: [
      'autotel-platforms',
    ],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [],
  },
  imports: [
    {
      source: 'autotel-platforms/cloudflare',
      specifiers: ['createCloudflareConfig'],
    },
  ],
  configBlock: {
    type: 'platform',
    code: '...createCloudflareConfig(),',
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Workers have limited API support - some features may not be available',
    'Use waitUntil() for async span flushing',
  ],
};

/**
 * Edge runtime platform preset
 */
export const edge: PlatformPreset = {
  name: 'Edge Runtime',
  slug: 'edge',
  type: 'platform',
  description: 'Vercel Edge, Deno Deploy, and other edge runtimes',
  packages: {
    required: [
      'autotel-platforms',
    ],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [],
  },
  imports: [
    {
      source: 'autotel-platforms/edge',
      specifiers: ['createEdgeConfig'],
    },
  ],
  configBlock: {
    type: 'platform',
    code: '...createEdgeConfig(),',
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Edge runtimes have limited API support',
    'Auto-instrumentation may not work - use manual instrumentation',
  ],
};
