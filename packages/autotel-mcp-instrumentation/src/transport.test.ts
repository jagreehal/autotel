import { describe, it, expect } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { instrumentMcpTransport } from './client';

/** A transport that records what it was asked to send. */
function recordingTransport() {
  const sent: unknown[] = [];
  return {
    sent,
    async send(message: unknown, _options?: unknown): Promise<void> {
      sent.push(message);
    },
  };
}

/** Run `fn` with an active span; returns the span's trace id. */
function withActiveSpan(fn: () => Promise<void>): Promise<string> {
  const span = trace.getTracer('test').startSpan('execute_tool');
  return context
    .with(trace.setSpan(context.active(), span), fn)
    .then(() => span.spanContext().traceId)
    .finally(() => span.end());
}

describe('instrumentMcpTransport', () => {
  it('puts the active traceparent on requests', async () => {
    const transport = instrumentMcpTransport(recordingTransport());
    const traceId = await withActiveSpan(() =>
      transport.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'find', arguments: { q: 1 } },
      }),
    );

    expect(transport.sent[0]).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'find',
        arguments: { q: 1 },
        _meta: { traceparent: expect.stringContaining(traceId) },
      },
    });
  });

  it('keeps _meta the caller set, and lets it win', async () => {
    const transport = instrumentMcpTransport(recordingTransport());
    await withActiveSpan(() =>
      transport.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'find',
          _meta: { traceparent: 'mine', progressToken: 7 },
        },
      }),
    );

    expect(transport.sent[0]).toMatchObject({
      params: { _meta: { traceparent: 'mine', progressToken: 7 } },
    });
  });

  it('adds params to a request that had none', async () => {
    const transport = instrumentMcpTransport(recordingTransport());
    await withActiveSpan(() =>
      transport.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    );

    expect(transport.sent[0]).toMatchObject({
      params: { _meta: { traceparent: expect.any(String) } },
    });
  });

  it('leaves notifications, responses and span-less requests untouched', async () => {
    const transport = instrumentMcpTransport(recordingTransport());
    const notification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    const response = { jsonrpc: '2.0', id: 4, result: {} };
    await withActiveSpan(async () => {
      await transport.send(notification);
      await transport.send(response);
    });
    const outside = { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} };
    await transport.send(outside);

    expect(transport.sent).toEqual([notification, response, outside]);
    expect(transport.sent[2]).toBe(outside);
  });

  it('forwards extra send arguments and returns the same transport', async () => {
    const calls: unknown[][] = [];
    const raw = {
      async send(...args: unknown[]) {
        calls.push(args);
      },
    };
    const transport = instrumentMcpTransport(raw);
    await transport.send(
      { jsonrpc: '2.0', id: 6, result: {} },
      { relatedRequestId: 1 },
    );

    expect(transport).toBe(raw);
    expect(calls[0]![1]).toEqual({ relatedRequestId: 1 });
  });
});
