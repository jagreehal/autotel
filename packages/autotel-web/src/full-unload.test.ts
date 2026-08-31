// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pendingLogCount, recordEvent, resetForTesting } from './span-exporter';
import { initFull, resetFullForTesting } from './full';
import { resetSessionForTesting } from './session';

function hide(): void {
  Object.defineProperty(document, 'visibilityState', {
    value: 'hidden',
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}

beforeEach(() => {
  resetFullForTesting();
  resetForTesting();
  resetSessionForTesting();
});

afterEach(() => {
  resetFullForTesting();
  resetForTesting();
  resetSessionForTesting();
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
});

// Full mode borrows the hand-rolled transport for events and console logs, and
// those sit in a 2-second batch. A page being navigated away from has no next
// tick, so without a beacon on the way out the end of every visit is the part
// that never arrives.
it('beacons queued events when the page is hidden', () => {
  const beacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', {
    value: beacon,
    configurable: true,
  });
  Object.defineProperty(navigator, 'onLine', {
    value: false,
    configurable: true,
  });

  initFull({ service: 'web', endpoint: 'https://collector.example.com' });
  recordEvent('app.jank', {});
  expect(pendingLogCount()).toBe(1);

  hide();

  expect(beacon).toHaveBeenCalledWith(
    'https://collector.example.com/v1/logs',
    expect.any(Blob),
  );
  expect(pendingLogCount()).toBe(0);

  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
});

it('emits session.end on the way out when session events are on', () => {
  Object.defineProperty(navigator, 'sendBeacon', {
    value: vi.fn(() => false),
    configurable: true,
  });
  Object.defineProperty(navigator, 'onLine', {
    value: false,
    configurable: true,
  });

  initFull({
    service: 'web',
    endpoint: 'https://collector.example.com',
    session: { emitEvents: true },
  });
  recordEvent('app.jank', {});
  const before = pendingLogCount();

  hide();

  // sendBeacon refused, so everything owed stays queued — including the
  // session.end that only the unload path can produce.
  expect(pendingLogCount()).toBeGreaterThan(before);

  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
});
