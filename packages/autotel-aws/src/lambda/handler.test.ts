import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { flush } = vi.hoisted(() => ({ flush: vi.fn(async () => {}) }));
vi.mock('autotel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('autotel')>();
  return { ...actual, flush };
});

import { traceLambda, wrapHandler } from './handler';

const lambdaContext = {
  functionName: 'fn',
  functionVersion: '$LATEST',
  awsRequestId: 'req-1',
  invokedFunctionArn: 'arn:aws:lambda:eu-west-1:123456789012:function:fn',
} as never;

describe('wrapHandler flush', () => {
  beforeEach(() => flush.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it('flushes after a successful handler', async () => {
    const handler = wrapHandler(async () => ({ statusCode: 200 }));
    await expect(handler({}, lambdaContext)).resolves.toEqual({
      statusCode: 200,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('flushes even when the handler throws', async () => {
    const handler = wrapHandler(async () => {
      throw new Error('boom');
    });
    await expect(handler({}, lambdaContext)).rejects.toThrow('boom');
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('traceLambda flushes too', async () => {
    const handler = traceLambda(() => async () => 'ok');
    await handler({}, lambdaContext);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('a failing flush never changes the outcome', async () => {
    flush.mockRejectedValueOnce(new Error('flush timeout'));
    const ok = wrapHandler(async () => 'ok');
    await expect(ok({}, lambdaContext)).resolves.toBe('ok');

    flush.mockRejectedValueOnce(new Error('flush timeout'));
    const bad = traceLambda(() => async () => {
      throw new Error('boom');
    });
    await expect(bad({}, lambdaContext)).rejects.toThrow('boom');
  });

  it('can be turned off', async () => {
    const handler = wrapHandler(async () => 'ok', { flush: false });
    await handler({}, lambdaContext);
    expect(flush).not.toHaveBeenCalled();
  });
});
