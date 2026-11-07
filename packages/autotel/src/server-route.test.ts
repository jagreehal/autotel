import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { RPCType, setRPCMetadata, type RPCMetadata } from '@opentelemetry/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setHttpServerRoute } from './server-route';

describe('setHttpServerRoute', () => {
  const manager = new AsyncLocalStorageContextManager();

  beforeAll(() => {
    context.setGlobalContextManager(manager.enable());
  });

  afterAll(() => {
    manager.disable();
    context.disable();
  });

  it('hands the route to the HTTP server span of the request', () => {
    const metadata: RPCMetadata = {
      type: RPCType.HTTP,
      span: trace.wrapSpanContext({
        traceId: '1'.repeat(32),
        spanId: '1'.repeat(16),
        traceFlags: 1,
      }),
    };

    const handed = context.with(
      setRPCMetadata(context.active(), metadata),
      () => setHttpServerRoute('/users/:id'),
    );

    expect(handed).toBe(true);
    expect(metadata.route).toBe('/users/:id');
  });

  it('says so when no HTTP server span is listening', () => {
    expect(setHttpServerRoute('/users/:id')).toBe(false);
  });
});
