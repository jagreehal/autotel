// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { reportWebVital } from './web-vitals';
import { captureEvents, eventsNamed } from './test-events';

describe('web vitals', () => {
  beforeEach(() => captureEvents());

  it('emits the canonical browser.web_vital event per metric', () => {
    reportWebVital(
      {
        name: 'LCP',
        value: 2410.5,
        rating: 'needs-improvement',
        delta: 120.5,
        id: 'v5-1730-1',
      },
      false,
    );

    const [event] = eventsNamed('browser.web_vital');
    expect(event).toBeDefined();
    // Lower-cased: the convention names these `lcp`, the library reports `LCP`,
    // and forwarding the library's casing makes every query provider-specific.
    expect(event.attributes['browser.web_vital.name']).toBe('lcp');
    expect(event.attributes['browser.web_vital.value']).toBe(2410.5);
    expect(event.attributes['browser.web_vital.rating']).toBe('needs-improvement');
    expect(event.attributes['browser.web_vital.delta']).toBe(120.5);
    expect(event.attributes['browser.web_vital.id']).toBe('v5-1730-1');
  });

  it('carries delta and id so repeat reports can be deduplicated', () => {
    // With reportAllChanges on, one measurement arrives many times. Without an
    // id they are indistinguishable, and without a delta they cannot be
    // differenced.
    reportWebVital({ name: 'CLS', value: 0.1, rating: 'good', delta: 0.02, id: 'a' }, false);
    reportWebVital({ name: 'CLS', value: 0.12, rating: 'good', delta: 0.02, id: 'a' }, false);
    const ids = eventsNamed('browser.web_vital').map(
      (e) => e.attributes['browser.web_vital.id'],
    );
    expect(ids).toEqual(['a', 'a']);
  });

  it('omits delta and id when a caller reports a metric by hand', () => {
    reportWebVital({ name: 'TTFB', value: 12, rating: 'good' }, false);
    const [event] = eventsNamed('browser.web_vital');
    expect(event.attributes['browser.web_vital.delta']).toBeUndefined();
    expect(event.attributes['browser.web_vital.id']).toBeUndefined();
  });

  it('keeps each metric a separate event rather than one shared span', () => {
    reportWebVital({ name: 'LCP', value: 1, rating: 'good' }, false);
    reportWebVital({ name: 'CLS', value: 0.02, rating: 'good' }, false);
    expect(eventsNamed('browser.web_vital')).toHaveLength(2);
  });

  it('does not emit the old homegrown attribute names', () => {
    reportWebVital({ name: 'INP', value: 12, rating: 'good' }, false);
    const [event] = eventsNamed('browser.web_vital');
    expect(event.attributes['web_vitals.inp']).toBeUndefined();
  });
});
