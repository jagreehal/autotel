import { channel, tracingChannel } from 'node:diagnostics_channel';
import { describe, expect, it, vi } from 'vitest';
import {
  diagnosticsChannelAvailable,
  subscribeChannel,
  subscribeTracingChannel,
} from './channel.js';

describe('diagnosticsChannelAvailable', () => {
  it('is true under Node', () => {
    expect(diagnosticsChannelAvailable()).toBe(true);
  });
});

describe('subscribeChannel', () => {
  it('receives published messages and stops after unsubscribe', () => {
    const handler = vi.fn();
    const dispose = subscribeChannel('autotel.test.chan', handler);
    const ch = channel('autotel.test.chan');

    ch.publish({ n: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toEqual({ n: 1 });

    dispose();
    ch.publish({ n: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('double-dispose is safe', () => {
    const dispose = subscribeChannel('autotel.test.chan2', vi.fn());
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
  });
});

describe('subscribeTracingChannel', () => {
  it('receives start and asyncEnd', () => {
    const start = vi.fn();
    const asyncEnd = vi.fn();
    const dispose = subscribeTracingChannel('autotel.test.trace', {
      start,
      asyncEnd,
    });
    const tc = tracingChannel('autotel.test.trace');

    const message = { foo: 'bar' };
    tc.start.publish(message);
    tc.asyncEnd.publish(message);

    expect(start).toHaveBeenCalledTimes(1);
    expect(asyncEnd).toHaveBeenCalledTimes(1);

    dispose();
    tc.start.publish(message);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
