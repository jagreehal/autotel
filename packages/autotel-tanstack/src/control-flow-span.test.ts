import { SpanStatusCode } from '@opentelemetry/api';
import { redirect } from '@tanstack/react-router';
import { init } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { traceLoader } from './loaders';

describe('TanStack control-flow span handling', () => {
  // init() registers the context manager the ambient getActiveTraceContext()
  // reads; without it the mock span never becomes the active span.
  beforeAll(() => {
    init({ service: 'tanstack-control-flow-test' });
  });

  it('does not record redirect() as a loader span error', async () => {
    const collector = createTraceCollector();
    const signal = redirect({ to: '/login' });
    const loader = traceLoader(async (_ctx: { route: { id: string } }) => {
      throw signal;
    });

    await expect(loader({ route: { id: '/private' } })).rejects.toBe(signal);

    const [span] = collector.getSpansByName('tanstack.loader./private');
    expect(span).toBeDefined();
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.attributes.error).not.toBe(true);
  });
});
