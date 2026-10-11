import { describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  deriveExecutionRootSpanId,
  deriveTraceIdFromArn,
} from '@aws/durable-execution-sdk-js-otel';
import {
  durableExecutionContext,
  type DurableExecutionStatusChangeEvent,
} from './context';

const arn =
  'arn:aws:lambda:eu-north-1:123456789012:function:fn:$LATEST/durable-execution/order-1/abc';
const event: DurableExecutionStatusChangeEvent = {
  source: 'aws.lambda',
  'detail-type': 'Durable Execution Status Change',
  detail: {
    durableExecutionArn: arn,
    durableExecutionName: 'order-1',
    functionArn: 'arn:aws:lambda:eu-north-1:123456789012:function:fn:2',
    status: 'SUCCEEDED',
    startTimestamp: '2026-10-11T08:26:21.250Z',
  },
};
const lambda = (XAmznTraceId?: string, InputPayload?: string) => ({
  send: async () => ({ TraceHeader: { XAmznTraceId }, InputPayload }),
});
const header =
  'Root=1-6acb482d-2b8f1c464b840b63538e6767;Parent=5e20bd4fd20c56b4;Sampled=0';
const parentOf = async (xray?: string, input?: string) =>
  trace.getSpanContext(
    await durableExecutionContext(event, lambda(xray, input) as never),
  );

describe('durableExecutionContext', () => {
  it('joins the trace Lambda stored with the execution', async () => {
    const parent = await parentOf(header, '{"orderId":"o-1"}');
    expect(parent).toMatchObject({
      traceId: '6acb482d2b8f1c464b840b63538e6767',
      spanId: '5e20bd4fd20c56b4',
      traceFlags: 1,
    });
  });

  it("without a header, derives the IDs AWS's plugins use", async () => {
    expect(await parentOf()).toMatchObject({
      traceId: deriveTraceIdFromArn(arn, new Date(event.detail.startTimestamp)),
      spanId: deriveExecutionRootSpanId(arn),
    });
  });

  it('joins the caller of a chained execution first, as the extractor does', async () => {
    const input = JSON.stringify({
      id: 'c-1',
      _traceContext: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
    });
    expect(await parentOf(header, input)).toMatchObject({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    });
  });
});
