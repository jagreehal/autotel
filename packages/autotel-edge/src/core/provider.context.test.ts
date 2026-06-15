import { describe, it, expect } from 'vitest';
import { trace } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SamplingDecision, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WorkerTracerProvider } from './provider';

const noopProcessor: SpanProcessor = {
  onStart: () => {},
  onEnd: () => {},
  shutdown: async () => {},
  forceFlush: async () => {},
};

/**
 * Regression guard for Issue 1.1: register() must register the context manager
 * with the global OTel API, otherwise the active span is lost after the first
 * `await` and consumers that resolve trace context from the active span
 * (autotel-agent / autotel-audit inside a handler or Workflow step) break.
 *
 * NOTE: this test registers a global context manager, so it lives in its own
 * file to avoid leaking that global state into other suites.
 */
describe('WorkerTracerProvider global context propagation', () => {
  it('keeps the active span across an await after register()', async () => {
    const provider = new WorkerTracerProvider(
      [noopProcessor],
      resourceFromAttributes({}),
    );
    provider.register();

    // The provider's WorkerTracer needs a head sampler (normally set from config).
    (
      provider.getTracer('test') as unknown as {
        setHeadSampler(s: unknown): void;
      }
    ).setHeadSampler({
      shouldSample: () => ({
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: {},
        traceState: undefined,
      }),
      toString: () => 'AlwaysOn',
    });

    // Resolve via the global API to prove the global registration took effect.
    const tracer = trace.getTracer('test');

    await tracer.startActiveSpan('op', async (span) => {
      // Simulate the async work a handler / step.do() callback performs.
      await Promise.resolve();
      expect(trace.getActiveSpan()).toBe(span);
      span.end();
    });
  });
});
