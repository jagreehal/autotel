// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pendingLogCount, recordEvent, resetForTesting } from './span-exporter';
import { initFull, resetFullForTesting } from './full';
import { resetSessionForTesting } from './session';

// Exercised through initFull rather than configureExporter: the previous
// sampling tests configured the exporter by hand and so could not see that
// initFull never passed the rate along.
describe('initFull wires sampling through to events and logs', () => {
  beforeEach(() => {
    // No vi.resetModules(): it would give `full` a different copy of the
    // exporter than this file holds, and every assertion would read a module
    // nothing wrote to — which is how the first version of this test passed
    // against the bug it exists to catch.
    resetFullForTesting();
    resetForTesting();
    resetSessionForTesting();
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    resetFullForTesting();
    resetForTesting();
    resetSessionForTesting();
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
  });

  it('drops events at sampleRate 0', () => {
    initFull({
      service: 'web',
      endpoint: 'https://collector.example.com',
      sampleRate: 0,
    });
    recordEvent('app.jank', {});
    expect(pendingLogCount()).toBe(0);
  });

  it('keeps events at sampleRate 1', () => {
    initFull({
      service: 'web',
      endpoint: 'https://collector.example.com',
      sampleRate: 1,
    });
    recordEvent('app.jank', {});
    expect(pendingLogCount()).toBe(1);
  });

  it('keeps events when no rate is configured', () => {
    initFull({ service: 'web', endpoint: 'https://collector.example.com' });
    recordEvent('app.jank', {});
    expect(pendingLogCount()).toBe(1);
  });
});

describe('init (lean mode) wires sampling too', () => {
  it('drops events at sampleRate 0', async () => {
    const { init, resetForTesting: resetLean } = await import('./init');
    resetLean();
    resetForTesting();
    init({
      service: 'web',
      endpoint: 'https://collector.example.com',
      sampleRate: 0,
    });
    recordEvent('app.jank', {});
    expect(pendingLogCount()).toBe(0);
    resetLean();
  });
});

describe('a custom sampler owns every signal', () => {
  beforeEach(() => {
    resetFullForTesting();
    resetForTesting();
    resetSessionForTesting();
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
  });
  afterEach(() => {
    resetFullForTesting();
    resetForTesting();
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
  });

  const alwaysOn = {
    shouldSample: () => ({ decision: 2 }),
    toString: () => 'AlwaysOn',
  };

  it('does not let sampleRate drop events behind the sampler back', () => {
    // The API says a custom `sampler` makes `sampleRate` ignored. Passing the
    // rate to the log exporter anyway split the two: an always-on sampler with
    // sampleRate 0 exported spans and silently dropped every event.
    initFull({
      service: 'web',
      endpoint: 'https://collector.example.com',
      sampler: alwaysOn as never,
      sampleRate: 0,
    });
    recordEvent('app.jank', {});
    expect(pendingLogCount()).toBe(1);
  });
});
