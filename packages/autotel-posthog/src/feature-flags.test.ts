// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { setEventSink } from 'autotel-web';
import { posthogCompatibility } from './compatibility';

const emitted: { name: string; attributes: Record<string, unknown> }[] = [];

beforeEach(() => {
  emitted.length = 0;
  setEventSink((name, attributes) => emitted.push({ name, attributes }));
});

function runEnricher(featureFlags: string[], flags: Record<string, unknown>) {
  const exporter = new InMemorySpanExporter();
  const processor = posthogCompatibility({
    posthog: {
      get_session_id: () => 'sess-1',
      get_distinct_id: () => 'user-1',
      getFeatureFlag: (key: string) => flags[key],
    } as never,
    featureFlags,
  });
  const provider = new BasicTracerProvider({
    spanProcessors: [processor, new SimpleSpanProcessor(exporter)],
  });
  provider.getTracer('t').startSpan('work').end();
  const [span] = exporter.getFinishedSpans();
  if (!span) throw new Error('no span was exported');
  return span;
}

describe('feature flags on spans', () => {
  it('uses the canonical evaluation attributes, not a per-key attribute', () => {
    // `feature_flag.<key>` is keyed by flag name, so no backend can group across
    // flags and none of them ship a panel that reads it.
    const span = runEnricher(['new-checkout'], { 'new-checkout': 'treatment' });
    expect(span.attributes['feature_flag.key']).toBe('new-checkout');
    expect(span.attributes['feature_flag.result.value']).toBe('treatment');
    expect(span.attributes['feature_flag.provider.name']).toBe('posthog');
    expect(span.attributes['feature_flag.new-checkout']).toBeUndefined();
  });

  it('keeps every flag as its own evaluation event', () => {
    // Correlated log records, not span events: attributes hold one flag, and
    // the repository emits events through the Logs API model.
    runEnricher(['a', 'b'], { a: true, b: 'variant-2' });
    const events = emitted.filter(
      (event) => event.name === 'feature_flag.evaluation',
    );
    expect(events.map((e) => e.attributes['feature_flag.key'])).toEqual([
      'a',
      'b',
    ]);
    expect(events.at(-1)?.attributes['feature_flag.result.value']).toBe(
      'variant-2',
    );
  });

  it('skips a flag PostHog has no answer for', () => {
    const span = runEnricher(['missing'], {});
    expect(span.attributes['feature_flag.key']).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });

  it('records the person the flag was evaluated for', () => {
    const span = runEnricher(['a'], { a: true });
    expect(span.attributes['feature_flag.context.id']).toBe('user-1');
  });
});
