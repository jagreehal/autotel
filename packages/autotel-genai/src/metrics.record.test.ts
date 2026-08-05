import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { genAiMetricViews } from './metrics.js';
import { recordGenAiMetrics, resetGenAiInstruments } from './metrics.js';

let exporter: InMemoryMetricExporter;
let provider: MeterProvider;

beforeEach(() => {
  exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  provider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter })],
    views: genAiMetricViews(),
  });
  metrics.setGlobalMeterProvider(provider);
  resetGenAiInstruments();
});

afterEach(async () => {
  await provider.shutdown();
  metrics.disable();
  resetGenAiInstruments();
});

it('exports the canonical GenAI instruments with their attributes', async () => {
  recordGenAiMetrics({
    durationSeconds: 1.5,
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-4o',
    },
    inputTokens: 900,
    outputTokens: 120,
    costUsd: 0.0033,
    timeToFirstChunk: 0.42,
  });

  await provider.forceFlush();

  const collected = exporter.getMetrics().at(-1);
  const byName = new Map(
    collected!.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .map((metric) => [metric.descriptor.name, metric]),
  );

  expect([...byName.keys()].sort()).toEqual([
    'gen_ai.client.cost.usd',
    'gen_ai.client.operation.duration',
    'gen_ai.client.operation.time_to_first_chunk',
    'gen_ai.client.token.usage',
  ]);

  const duration = byName.get('gen_ai.client.operation.duration')!;
  expect(duration.dataPoints[0]!.attributes).toMatchObject({
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': 'gpt-4o',
  });

  // One instrument, split by token type, as the spec models it.
  const tokens = byName.get('gen_ai.client.token.usage')!;
  expect(
    tokens.dataPoints
      .map((point) => point.attributes['gen_ai.token.type'])
      .sort(),
  ).toEqual(['input', 'output']);
});

it('omits an instrument when the operation reported no value for it', async () => {
  recordGenAiMetrics({
    durationSeconds: 0.2,
    attributes: { 'gen_ai.operation.name': 'execute_tool' },
  });

  await provider.forceFlush();

  const names = exporter
    .getMetrics()
    .at(-1)!
    .scopeMetrics.flatMap((scope) => scope.metrics)
    .map((metric) => metric.descriptor.name);

  expect(names).toContain('gen_ai.client.operation.duration');
  expect(names).not.toContain('gen_ai.client.cost.usd');
});
