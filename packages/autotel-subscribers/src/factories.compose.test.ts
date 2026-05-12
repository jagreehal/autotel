import { describe, expect, it } from 'vitest';
import { composeSubscribers } from './factories';
import type {
  EventSubscriber,
  EventAttributes,
  FunnelStatus,
  OutcomeStatus,
  EventTrackingOptions,
} from 'autotel/event-subscriber';

class StubSubscriber implements EventSubscriber {
  readonly name: string;
  private readonly failUntil: number;
  public calls = 0;

  constructor(name: string, failUntil = 0) {
    this.name = name;
    this.failUntil = failUntil;
  }

  private async run(): Promise<void> {
    this.calls += 1;
    if (this.calls <= this.failUntil) {
      throw new Error(`${this.name} failed`);
    }
  }

  async trackEvent(_name: string, _attributes?: EventAttributes, _options?: EventTrackingOptions): Promise<void> {
    await this.run();
  }
  async trackFunnelStep(_funnel: string, _step: FunnelStatus, _attributes?: EventAttributes, _options?: EventTrackingOptions): Promise<void> {
    await this.run();
  }
  async trackOutcome(_operation: string, _outcome: OutcomeStatus, _attributes?: EventAttributes, _options?: EventTrackingOptions): Promise<void> {
    await this.run();
  }
  async trackValue(_name: string, _value: number, _attributes?: EventAttributes, _options?: EventTrackingOptions): Promise<void> {
    await this.run();
  }
}

describe('composeSubscribers strategies', () => {
  it('parallel requires all subscribers to succeed', async () => {
    const a = new StubSubscriber('a');
    const b = new StubSubscriber('b', 1);

    const composed = composeSubscribers([a, b], { strategy: 'parallel' });
    await expect(composed.trackEvent('x')).rejects.toThrow();
  });

  it('failover succeeds on next healthy subscriber', async () => {
    const a = new StubSubscriber('a', 1);
    const b = new StubSubscriber('b');

    const composed = composeSubscribers([a, b], { strategy: 'failover' });
    await composed.trackEvent('x');

    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
  });

  it('race succeeds if any subscriber succeeds', async () => {
    const a = new StubSubscriber('a', 1);
    const b = new StubSubscriber('b');

    const composed = composeSubscribers([a, b], { strategy: 'race' });
    await expect(composed.trackEvent('x')).resolves.toBeUndefined();
  });

  it('mirrored returns based on primary subscriber only', async () => {
    const a = new StubSubscriber('a');
    const b = new StubSubscriber('b', 10);

    const composed = composeSubscribers([a, b], { strategy: 'mirrored' });
    await expect(composed.trackEvent('x')).resolves.toBeUndefined();
    expect(a.calls).toBe(1);
  });

  it('round-robin rotates starting subscriber', async () => {
    const a = new StubSubscriber('a');
    const b = new StubSubscriber('b');

    const composed = composeSubscribers([a, b], {
      strategy: 'round-robin',
      maxAttemptsPerSubscriber: 1,
    });

    await composed.trackEvent('x');
    await composed.trackEvent('x');

    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
  });

  it('retries subscriber when retriable', async () => {
    const a = new StubSubscriber('a', 1);
    const composed = composeSubscribers([a], {
      strategy: 'failover',
      maxAttemptsPerSubscriber: 2,
      initialRetryDelayMs: 1,
      maxRetryDelayMs: 1,
    });

    await composed.trackEvent('x');
    expect(a.calls).toBe(2);
  });
});
