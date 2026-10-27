import { afterEach, describe, expect, it, vi } from 'vitest';
import { propagation } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { span, trace } from './functional';
import { init } from './init';
import { shutdown } from './shutdown';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const PARENT_ID = 'b7ad6b7169203331';
const TRACEPARENT = `00-${TRACE_ID}-${PARENT_ID}-01`;

/** The real pipeline: propagation needs init()'s propagator. */
function setup(traceContextFromEnv?: boolean) {
  const exporter = new InMemorySpanExporter();
  init({
    service: 'env-carrier',
    sampling: 'development',
    spanProcessor: new SimpleSpanProcessor(exporter),
    traceContextFromEnv,
  });
  return exporter;
}

describe('trace context from the environment', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await shutdown();
  });

  it("continues the parent process's trace from TRACEPARENT", async () => {
    vi.stubEnv('TRACEPARENT', TRACEPARENT);
    vi.stubEnv('BAGGAGE', 'tenant=acme');
    const exporter = setup();
    let tenant: string | undefined;

    await trace.run('job', async () => {
      tenant = propagation.getActiveBaggage()?.getEntry('tenant')?.value;
      await trace.run('job.step', async () => {});
    });
    span({ name: 'second-root' }, () => {});

    // SimpleSpanProcessor exports asynchronously.
    await expect.poll(() => exporter.getFinishedSpans().length).toBe(3);
    const spans = Object.fromEntries(
      exporter.getFinishedSpans().map((s) => [s.name, s]),
    );
    expect(spans['job']?.spanContext().traceId).toBe(TRACE_ID);
    expect(spans['job']?.parentSpanContext?.spanId).toBe(PARENT_ID);
    expect(spans['job']?.parentSpanContext?.isRemote).toBe(true);
    // Children stay under their local parent.
    expect(spans['job.step']?.parentSpanContext?.spanId).toBe(
      spans['job']?.spanContext().spanId,
    );
    expect(spans['second-root']?.parentSpanContext?.spanId).toBe(PARENT_ID);
    expect(tenant).toBe('acme');
  });

  it('starts a trace of its own when turned off, or when TRACEPARENT is malformed', async () => {
    vi.stubEnv('TRACEPARENT', TRACEPARENT);
    let exporter = setup(false);
    await trace.run('off', async () => {});
    await expect.poll(() => exporter.getFinishedSpans().length).toBe(1);
    expect(exporter.getFinishedSpans()[0]?.parentSpanContext).toBeUndefined();
    await shutdown();

    vi.stubEnv('TRACEPARENT', 'not-a-traceparent');
    exporter = setup();
    await trace.run('malformed', async () => {});
    await expect.poll(() => exporter.getFinishedSpans().length).toBe(1);
    expect(exporter.getFinishedSpans()[0]?.parentSpanContext).toBeUndefined();
  });
});
