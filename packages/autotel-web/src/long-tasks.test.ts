// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { setupLongTaskObserver } from './long-tasks';
import { captureEvents, eventsNamed } from './test-events';

class FakeObserver {
  static last: FakeObserver | undefined;
  constructor(private readonly callback: (list: { getEntries: () => unknown[] }) => void) {
    FakeObserver.last = this;
  }
  observe(): void {}
  disconnect(): void {}
  emit(entries: unknown[]): void {
    this.callback({ getEntries: () => entries });
  }
}

describe('long tasks', () => {
  beforeEach(() => {
    captureEvents();
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver =
      FakeObserver;
    (window as unknown as { PerformanceObserver?: unknown }).PerformanceObserver =
      FakeObserver;
  });

  it('emits the canonical app.jank event', () => {
    setupLongTaskObserver({ debug: false });
    FakeObserver.last!.emit([{ duration: 137.4, startTime: 900 }]);

    const [event] = eventsNamed('app.jank');
    expect(event).toBeDefined();
    // `app.jank.period` and `.threshold` are documented in SECONDS. Recording
    // 50 for the browser's 50ms long-task threshold would claim a fifty-second
    // frame budget.
    expect(event.attributes['app.jank.period']).toBeCloseTo(0.1374, 4);
    expect(event.attributes['app.jank.threshold']).toBe(0.05);
  });

  it('claims no frame count, because the browser reports none', () => {
    setupLongTaskObserver({ debug: false });
    FakeObserver.last!.emit([{ duration: 60, startTime: 1 }]);
    expect(
      eventsNamed('app.jank')[0].attributes['app.jank.frame_count'],
    ).toBeUndefined();
  });

  it('emits one event per long task', () => {
    setupLongTaskObserver({ debug: false });
    FakeObserver.last!.emit([
      { duration: 60, startTime: 1 },
      { duration: 90, startTime: 2 },
    ]);
    expect(eventsNamed('app.jank')).toHaveLength(2);
  });

  it('does not emit the old homegrown span name', () => {
    setupLongTaskObserver({ debug: false });
    FakeObserver.last!.emit([{ duration: 60, startTime: 1 }]);
    expect(eventsNamed('long_task')).toHaveLength(0);
    expect(
      eventsNamed('app.jank')[0].attributes['app.jank.duration'],
    ).toBeUndefined();
  });
});
