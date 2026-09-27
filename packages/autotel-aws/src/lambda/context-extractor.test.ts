import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  context,
  createContextKey,
  propagation,
  ROOT_CONTEXT,
  trace,
} from '@opentelemetry/api';
import { init } from 'autotel';
import {
  isTracingSuppressed,
  suppressTracing,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { parentContextOf } from './context-extractor';
import type { LambdaInstrumentationConfig } from '../config';

const CARRIER_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const HEADER_TRACE = '0af7651916cd43dd8448eb211c80319c';

/** An API Gateway event whose headers carry one trace and whose JSON body carries another. */
const event = {
  headers: { traceparent: `00-${HEADER_TRACE}-b7ad6b7169203331-01` },
  body: JSON.stringify({
    _meta: { traceparent: `00-${CARRIER_TRACE}-00f067aa0ba902b7-01` },
  }),
};

type Event = typeof event;

const fromBody = (e: Event) => JSON.parse(e.body)._meta;

function spanContextOf(
  event: Event,
  option?: LambdaInstrumentationConfig<Event>['extractTraceContext'],
) {
  return trace.getSpanContext(parentContextOf(event, option) ?? ROOT_CONTEXT);
}

describe('parentContextOf', () => {
  beforeAll(() => {
    init({ service: 'context-extractor-test' });
    propagation.disable();
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  afterAll(() => {
    context.disable();
    propagation.disable();
  });

  it.each([true, false])(
    'preserves host context while extracting a custom parent (active span: %s)',
    (hasSpan) => {
      const requestKey = createContextKey('test.request');
      let active = propagation.setBaggage(
        suppressTracing(context.active().setValue(requestKey, 'request-123')),
        propagation.createBaggage({ 'autotel.debug': { value: 'true' } }),
      );
      if (hasSpan) {
        active = trace.setSpanContext(active, {
          traceId: HEADER_TRACE,
          spanId: 'b7ad6b7169203331',
          traceFlags: 1,
        });
      }
      context.with(active, () => {
        const parent = parentContextOf(event, fromBody);
        expect(parent).toBeDefined();
        expect({
          suppressed: isTracingSuppressed(parent!),
          debug: propagation.getBaggage(parent!)?.getEntry('autotel.debug')
            ?.value,
          request: parent!.getValue(requestKey),
          traceId: trace.getSpanContext(parent!)?.traceId,
          spanId: trace.getSpanContext(parent!)?.spanId,
        }).toEqual({
          suppressed: true,
          debug: 'true',
          request: 'request-123',
          traceId: CARRIER_TRACE,
          spanId: '00f067aa0ba902b7',
        });
        expect(context.active()).toBe(active);
      });
    },
  );

  it.each([{}, { traceparent: 'not-a-traceparent' }])(
    'falls back to event headers for unusable custom context %j with an active span',
    (carrier) => {
      const active = trace.setSpanContext(context.active(), {
        traceId: CARRIER_TRACE,
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
      });
      context.with(active, () => {
        expect(trace.getSpanContext(context.active())?.traceId).toBe(
          CARRIER_TRACE,
        );
        expect(spanContextOf(event, () => carrier)?.traceId).toBe(HEADER_TRACE);
      });
    },
  );

  it('a carrier function wins over where AWS put the context', () => {
    expect(spanContextOf(event, fromBody)?.traceId).toBe(CARRIER_TRACE);
  });

  it('falls back to the built-in extraction when the carrier has nothing usable', () => {
    expect(spanContextOf(event, () => {})?.traceId).toBe(HEADER_TRACE);
    expect(
      spanContextOf(event, () => ({ traceparent: 'not-a-traceparent' }))
        ?.traceId,
    ).toBe(HEADER_TRACE);
  });

  it('true and unset keep the built-in extraction; false turns it off', () => {
    expect(spanContextOf(event, true)?.traceId).toBe(HEADER_TRACE);
    expect(spanContextOf(event)?.traceId).toBe(HEADER_TRACE);
    expect(spanContextOf(event, false)).toBeUndefined();
  });
});
