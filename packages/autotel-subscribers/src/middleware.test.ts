import { describe, expect, it, vi } from 'vitest';
import {
  applyMiddleware,
  createMiddleware,
  inMemoryIdempotencyStore,
  inMemoryRateLimitStore,
  withEventLogger,
  withIdempotency,
  withRateLimit,
} from './middleware';
import type { EventSubscriber, EventAttributes, FunnelStatus, OutcomeStatus } from 'autotel/event-subscriber';

class RecorderSubscriber implements EventSubscriber {
  readonly name = 'Recorder';
  calls: string[] = [];

  async trackEvent(name: string, _attributes?: EventAttributes): Promise<void> {
    this.calls.push(name);
  }
  async trackFunnelStep(funnel: string, _step: FunnelStatus): Promise<void> {
    this.calls.push(funnel);
  }
  async trackOutcome(operation: string, _outcome: OutcomeStatus): Promise<void> {
    this.calls.push(operation);
  }
  async trackValue(name: string): Promise<void> {
    this.calls.push(name);
  }
}

describe('middleware', () => {
  it('supports context passing and event transformation', async () => {
    const base = new RecorderSubscriber();

    const subscriber = applyMiddleware(base, [
      createMiddleware(async ({ ctx, next }) => {
        await next({ ctxPatch: { trace: 'x' } as any });
        expect((ctx as any).trace).toBeUndefined();
      }),
      createMiddleware(async ({ event, ctx, next }) => {
        expect((ctx as any).trace).toBe('x');
        await next({ event: { ...event, name: 'changed' } as any });
      }),
    ]);

    await subscriber.trackEvent('original');
    expect(base.calls).toEqual(['changed']);
  });

  it('withIdempotency prevents duplicate sends', async () => {
    const base = new RecorderSubscriber();
    const store = inMemoryIdempotencyStore<boolean>();

    const subscriber = applyMiddleware(base, [
      withIdempotency({
        store,
        key: (event) => ('name' in event ? event.name : 'x'),
        ttlMs: 60_000,
      }),
    ]);

    await subscriber.trackEvent('dup');
    await subscriber.trackEvent('dup');

    expect(base.calls).toEqual(['dup']);
  });

  it('withRateLimit throws after limit exceeded', async () => {
    const base = new RecorderSubscriber();
    const store = inMemoryRateLimitStore();

    const subscriber = applyMiddleware(base, [
      withRateLimit({
        store,
        key: 'global',
        max: 1,
        windowMs: 10_000,
      }),
    ]);

    await subscriber.trackEvent('a');
    await expect(subscriber.trackEvent('b')).rejects.toThrow('Rate limited');
  });

  it('withEventLogger writes success and error records', async () => {
    const ok = new RecorderSubscriber();
    const failing: EventSubscriber = {
      name: 'Failing',
      async trackEvent() {
        throw new Error('boom');
      },
      async trackFunnelStep() {},
      async trackOutcome() {},
      async trackValue() {},
    };

    const sink = { write: vi.fn(async () => {}) };

    const okSubscriber = applyMiddleware(ok, [withEventLogger({ sink })]);
    await okSubscriber.trackEvent('ok');

    const badSubscriber = applyMiddleware(failing, [withEventLogger({ sink })]);
    await expect(badSubscriber.trackEvent('bad')).rejects.toThrow('boom');

    expect(sink.write).toHaveBeenCalledTimes(2);
    expect(sink.write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'success', eventName: 'ok' }),
    );
    expect(sink.write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'error', eventName: 'bad' }),
    );
  });
});
