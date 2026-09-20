import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AWS_BEDROCK,
  BEDROCK_PRICING,
  bedrockCompatibility,
  bedrockProviderAttributes,
  parseBedrockModelId,
} from './index.js';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;

function setup(options: Parameters<typeof bedrockCompatibility>[0] = {}) {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [
      bedrockCompatibility(options),
      new SimpleSpanProcessor(exporter),
    ],
  });
  return provider.getTracer('bedrock-test');
}

afterEach(async () => {
  await provider?.shutdown();
});

const only = (): ReadableSpan => {
  const spans = exporter.getFinishedSpans();
  if (spans.length !== 1)
    throw new Error(`expected 1 span, got ${spans.length}`);
  return spans[0]!;
};

const ARN =
  'arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

describe('parseBedrockModelId', () => {
  it('leaves a foundation model id alone', () => {
    expect(
      parseBedrockModelId('anthropic.claude-sonnet-4-5-20250929-v1:0'),
    ).toEqual({
      modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      vendor: 'anthropic',
      inferenceProfileRegion: undefined,
      arn: undefined,
    });
  });

  it('strips a cross-region profile prefix', () => {
    const p = parseBedrockModelId('eu.amazon.nova-pro-v1:0');
    expect(p.modelId).toBe('amazon.nova-pro-v1:0');
    expect(p.inferenceProfileRegion).toBe('eu');
    expect(p.vendor).toBe('amazon');
  });

  it('unwraps an inference-profile ARN', () => {
    const p = parseBedrockModelId(ARN);
    expect(p.modelId).toBe('anthropic.claude-sonnet-4-5-20250929-v1:0');
    expect(p.inferenceProfileRegion).toBe('eu');
    expect(p.arn).toBe(ARN);
  });

  it('does not mistake a two-segment id for a profile', () => {
    expect(parseBedrockModelId('zai.glm-4.7-flash')).toMatchObject({
      modelId: 'zai.glm-4.7-flash',
      vendor: 'zai',
      inferenceProfileRegion: undefined,
    });
  });
});

describe('bedrockCompatibility', () => {
  it('ignores spans from other providers', () => {
    const tracer = setup({ region: 'eu-west-1' });
    tracer
      .startSpan('chat', {
        attributes: {
          'gen_ai.provider.name': 'openai',
          'gen_ai.request.model': 'eu.gpt-4o',
        },
      })
      .end();
    const a = only().attributes;
    expect(a['gen_ai.request.model']).toBe('eu.gpt-4o');
    expect(a['cloud.region']).toBeUndefined();
  });

  it('normalises an ARN to the foundation id and keeps the facts', () => {
    const tracer = setup({ region: 'eu-west-1' });
    tracer
      .startSpan('chat', {
        attributes: {
          'gen_ai.provider.name': 'aws.bedrock',
          'gen_ai.request.model': ARN,
          'gen_ai.response.model': ARN,
        },
      })
      .end();
    const a = only().attributes;
    expect(a['gen_ai.request.model']).toBe(
      'anthropic.claude-sonnet-4-5-20250929-v1:0',
    );
    expect(a['gen_ai.response.model']).toBe(
      'anthropic.claude-sonnet-4-5-20250929-v1:0',
    );
    expect(a[AWS_BEDROCK.MODEL_ID_RAW]).toBe(ARN);
    expect(a[AWS_BEDROCK.MODEL_ARN]).toBe(ARN);
    expect(a[AWS_BEDROCK.INFERENCE_PROFILE_REGION]).toBe('eu');
    expect(a[AWS_BEDROCK.MODEL_VENDOR]).toBe('anthropic');
    expect(a['cloud.provider']).toBe('aws');
    expect(a['cloud.region']).toBe('eu-west-1');
  });

  it('adds cloud + vendor but leaves a plain id untouched', () => {
    const tracer = setup({ region: 'eu-west-1' });
    tracer
      .startSpan('chat', {
        attributes: {
          'gen_ai.provider.name': 'aws.bedrock',
          'gen_ai.request.model': 'zai.glm-4.7-flash',
        },
      })
      .end();
    const a = only().attributes;
    expect(a['gen_ai.request.model']).toBe('zai.glm-4.7-flash');
    expect(a[AWS_BEDROCK.MODEL_ID_RAW]).toBeUndefined();
    expect(a[AWS_BEDROCK.MODEL_VENDOR]).toBe('zai');
  });

  it('can keep the requested spelling when asked', () => {
    const tracer = setup({ normalizeModel: false });
    tracer
      .startSpan('chat', {
        attributes: {
          'gen_ai.provider.name': 'aws.bedrock',
          'gen_ai.request.model': 'us.meta.llama3-3-70b-instruct-v1:0',
        },
      })
      .end();
    const a = only().attributes;
    expect(a['gen_ai.request.model']).toBe(
      'us.meta.llama3-3-70b-instruct-v1:0',
    );
    expect(a[AWS_BEDROCK.INFERENCE_PROFILE_REGION]).toBe('us');
  });
});

describe('BEDROCK_PRICING', () => {
  it('keys resolve by prefix from a versioned id', () => {
    const id = 'amazon.nova-pro-v1:0';
    const key = Object.keys(BEDROCK_PRICING).find((k) => id.startsWith(k));
    expect(key).toBe('amazon.nova-pro');
  });
});

describe('bedrockProviderAttributes', () => {
  const trace = {
    guardrail: {
      inputAssessment: { 'gr-abc123': { topicPolicy: { topics: [] } } },
    },
  };

  it('records the stop reason and the guardrail that intervened', () => {
    expect(
      bedrockProviderAttributes({
        provider: 'aws.bedrock',
        rawFinishReason: 'guardrail_intervened',
        providerMetadata: { bedrock: { trace } },
      }),
    ).toEqual({
      [AWS_BEDROCK.STOP_REASON]: 'guardrail_intervened',
      [AWS_BEDROCK.GUARDRAIL_ID]: 'gr-abc123',
      [AWS_BEDROCK.GUARDRAIL_INTERVENED]: true,
    });
  });

  it('records a stop reason without a trace, and a passed guardrail as not intervened', () => {
    expect(
      bedrockProviderAttributes({
        provider: 'aws.bedrock',
        rawFinishReason: 'max_tokens',
      }),
    ).toEqual({
      [AWS_BEDROCK.STOP_REASON]: 'max_tokens',
      [AWS_BEDROCK.GUARDRAIL_INTERVENED]: false,
    });
  });

  it('adds nothing for other providers or when Bedrock said nothing extra', () => {
    expect(
      bedrockProviderAttributes({
        provider: 'openai',
        rawFinishReason: 'stop',
      }),
    ).toBeUndefined();
    expect(bedrockProviderAttributes({ provider: 'aws.bedrock' })).toEqual({});
  });
});
