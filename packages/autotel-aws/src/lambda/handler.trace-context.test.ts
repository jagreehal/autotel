// Its own file: handler.test.ts mocks autotel's flush, which this needs real.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { context, propagation, trace } from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { init } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { createMockLambdaContext } from '../testing/lambda-harness';
import { traceLambda, wrapHandler } from './handler';
import { getContextFromRequest, tracingMiddleware } from './middleware';
import type { LambdaInstrumentationConfig } from '../config';
import type { LambdaEvent } from '../types';

describe('Lambda trace context', () => {
  const exporter = new InMemorySpanExporter();
  beforeAll(() => {
    init({
      service: 'test',
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    propagation.disable();
    propagation.setGlobalPropagator(
      new CompositePropagator({
        propagators: [
          new W3CTraceContextPropagator(),
          new W3CBaggagePropagator(),
        ],
      }),
    );
  });
  beforeEach(() => exporter.reset());

  it('parents the invocation span on a context the caller carried in the body', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const callerSpanId = '00f067aa0ba902b7';
    const handler = wrapHandler(async () => 'ok', {
      extractTraceContext: (event: { meta: { traceparent: string } }) =>
        event.meta,
    });

    await handler(
      { meta: { traceparent: `00-${traceId}-${callerSpanId}-01` } },
      createMockLambdaContext({ functionName: 'fn' }),
    );

    const invocation = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'lambda.fn');

    expect(invocation?.spanContext().traceId).toBe(traceId);
    expect(invocation?.parentSpanContext?.spanId).toBe(callerSpanId);
  });

  const carrier = {
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    tracestate: 'vendor=value',
    baggage: 'tenant=acme',
  };
  const sources = [
    {
      name: 'custom carrier',
      event: {},
      config: { extractTraceContext: () => carrier },
    },
    {
      name: 'event headers',
      event: { headers: carrier },
      config: { extractTraceContext: true },
    },
  ] satisfies Array<{
    name: string;
    event: LambdaEvent;
    config: LambdaInstrumentationConfig<LambdaEvent>;
  }>;

  function assertPropagation() {
    expect(
      propagation.getBaggage(context.active())?.getEntry('tenant')?.value,
    ).toBe('acme');
    expect(
      trace.getSpanContext(context.active())?.traceState?.serialize(),
    ).toBe('vendor=value');
    const downstream: Record<string, string> = {};
    propagation.inject(context.active(), downstream);
    expect(downstream.baggage).toBe('tenant=acme');
    return 'ok';
  }

  describe.each(sources)('$name', ({ event, config }) => {
    it.each(['wrapHandler', 'traceLambda'])(
      'preserves baggage through %s',
      async (wrapper) => {
        const handler =
          wrapper === 'wrapHandler'
            ? wrapHandler(async () => assertPropagation(), config)
            : traceLambda(() => async () => assertPropagation(), config);
        expect(
          await handler(event, createMockLambdaContext({ functionName: 'fn' })),
        ).toBe('ok');
        expect(
          exporter.getFinishedSpans().find((s) => s.name === 'lambda.fn')
            ?.parentSpanContext?.spanId,
        ).toBe('00f067aa0ba902b7');
      },
    );

    it('preserves baggage in the Middy request context', async () => {
      const middleware = tracingMiddleware(config);
      const request = {
        event,
        context: createMockLambdaContext({ functionName: 'fn' }),
        response: undefined,
        error: undefined,
        internal: {},
      };
      await middleware.before!(request);
      try {
        const parent = getContextFromRequest(request);
        expect(parent).toBeDefined();
        context.with(parent!, assertPropagation);
      } finally {
        await middleware.after!(request);
      }
    });
  });
});
