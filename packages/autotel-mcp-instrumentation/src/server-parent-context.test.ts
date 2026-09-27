import { beforeAll, describe, expect, it } from 'vitest';
import { context, propagation, trace, TraceFlags } from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { serverParentContext } from './context';

const CALLER_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const meta = { traceparent: `00-${CALLER_TRACE}-00f067aa0ba902b7-01` };

/** Run `fn` with a host span (e.g. a Lambda invocation) active in `traceId`. */
function asHost<T>(traceId: string, fn: () => T): T {
  const host = trace.wrapSpanContext({
    traceId,
    spanId: 'b7ad6b7169203331',
    traceFlags: TraceFlags.SAMPLED,
  });

  return context.with(trace.setSpan(context.active(), host), fn);
}

const parentSpanId = () =>
  trace.getSpanContext(serverParentContext(meta))?.spanId;

describe('serverParentContext', () => {
  beforeAll(() => {
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

  it('preserves incoming baggage and the host span when they share a trace', () => {
    asHost(CALLER_TRACE, () => {
      const parent = serverParentContext({ ...meta, baggage: 'tenant=acme' });
      expect(trace.getSpanContext(parent)?.spanId).toBe('b7ad6b7169203331');
      expect(propagation.getBaggage(parent)?.getEntry('tenant')?.value).toBe(
        'acme',
      );
      const carrier: Record<string, string> = {};
      propagation.inject(parent, carrier);
      expect(carrier.baggage).toBe('tenant=acme');
    });
  });

  it("keeps the host's span when the host already joined the caller's trace", () => {
    expect(asHost(CALLER_TRACE, parentSpanId)).toBe('b7ad6b7169203331');
  });

  it("uses the caller's span from _meta when the host is in another trace", () => {
    expect(asHost('0af7651916cd43dd8448eb211c80319c', parentSpanId)).toBe(
      '00f067aa0ba902b7',
    );
  });

  it("uses the caller's span from _meta when nothing is active", () => {
    expect(parentSpanId()).toBe('00f067aa0ba902b7');
  });
});
