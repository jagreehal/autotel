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
    expect(event.attributes['browser.web_vital.rating']).toBe(
      'needs-improvement',
    );
    expect(event.attributes['browser.web_vital.delta']).toBe(120.5);
    expect(event.attributes['browser.web_vital.id']).toBe('v5-1730-1');
  });

  it('carries delta and id so repeat reports can be deduplicated', () => {
    // With reportAllChanges on, one measurement arrives many times. Without an
    // id they are indistinguishable, and without a delta they cannot be
    // differenced.
    reportWebVital(
      { name: 'CLS', value: 0.1, rating: 'good', delta: 0.02, id: 'a' },
      false,
    );
    reportWebVital(
      { name: 'CLS', value: 0.12, rating: 'good', delta: 0.02, id: 'a' },
      false,
    );
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

  it('says why a vital is slow: element, phase breakdown, navigation', () => {
    reportWebVital(
      {
        name: 'LCP',
        value: 3200,
        rating: 'poor',
        navigationType: 'navigate',
        attribution: {
          target: 'main > img.hero',
          url: 'https://cdn.example.com/hero.jpg?sig=secret#x',
          timeToFirstByte: 400,
          resourceLoadDelay: 1800,
          resourceLoadDuration: 700,
          elementRenderDelay: 300,
          lcpEntry: { startTime: 1 },
        },
      },
      false,
    );
    const [event] = eventsNamed('browser.web_vital');
    expect(event.attributes).toMatchObject({
      'browser.web_vital.navigation_type': 'navigate',
      'browser.web_vital.target': 'main > img.hero',
      // Signed query strings are credentials; the path names the asset.
      'browser.web_vital.resource_url': 'https://cdn.example.com/hero.jpg',
      'browser.web_vital.time_to_first_byte': 400,
      'browser.web_vital.resource_load_delay': 1800,
      'browser.web_vital.resource_load_duration': 700,
      'browser.web_vital.element_render_delay': 300,
    });
    // Raw performance entries are objects, never attributes.
    expect(
      Object.keys(event.attributes).some((k) => k.includes('lcpEntry')),
    ).toBe(false);
  });

  it('puts the INP and CLS culprit on the same target attribute as LCP', () => {
    reportWebVital(
      {
        name: 'INP',
        value: 450,
        rating: 'poor',
        attribution: {
          interactionTarget: 'button#checkout',
          interactionType: 'pointer',
          inputDelay: 20,
          processingDuration: 380,
          presentationDelay: 50,
          loadState: 'complete',
        },
      },
      false,
    );
    reportWebVital(
      {
        name: 'CLS',
        value: 0.3,
        rating: 'poor',
        attribution: { largestShiftTarget: 'div.ad', largestShiftValue: 0.25 },
      },
      false,
    );
    const [inp, cls] = eventsNamed('browser.web_vital');
    expect(inp.attributes).toMatchObject({
      'browser.web_vital.target': 'button#checkout',
      'browser.web_vital.interaction_type': 'pointer',
      'browser.web_vital.processing_duration': 380,
      'browser.web_vital.load_state': 'complete',
    });
    expect(cls.attributes).toMatchObject({
      'browser.web_vital.target': 'div.ad',
      'browser.web_vital.largest_shift_value': 0.25,
    });
  });

  it('runs selectors and resource URLs through the configured redactor', () => {
    const redactor = (value: string) => value.replaceAll(/user-\d+/g, '[ID]');
    reportWebVital(
      {
        name: 'LCP',
        value: 3000,
        rating: 'poor',
        attribution: {
          target: 'div#user-4821 > img',
          url: 'https://cdn.example.com/avatars/user-4821.png',
        },
      },
      false,
      redactor,
    );
    const [event] = eventsNamed('browser.web_vital');
    expect(event.attributes['browser.web_vital.target']).toBe('div#[ID] > img');
    expect(event.attributes['browser.web_vital.resource_url']).toBe(
      'https://cdn.example.com/avatars/[ID].png',
    );
  });

  it('exports only bounded http(s) resource URLs, never inline images', () => {
    const base64 = 'A'.repeat(500_000);
    reportWebVital(
      {
        name: 'LCP',
        value: 3000,
        rating: 'poor',
        attribution: { url: `data:image/png;base64,${base64}` },
      },
      false,
    );
    reportWebVital(
      {
        name: 'LCP',
        value: 3000,
        rating: 'poor',
        attribution: { url: `https://cdn.example.com/${'a'.repeat(5000)}` },
      },
      false,
    );
    const [inline, long] = eventsNamed('browser.web_vital');
    expect(inline.attributes['browser.web_vital.resource_url']).toBeUndefined();
    expect(
      String(long.attributes['browser.web_vital.resource_url']).length,
    ).toBe(1024);
  });

  it('ties every vital of one page view to its navigation', () => {
    const navigation = {
      navigationType: 'soft-navigation',
      navigationId: 3,
      navigationInteractionId: 812,
      navigationURL: 'https://shop.example.com/cart?coupon=SECRET',
    };
    reportWebVital(
      { name: 'LCP', value: 1, rating: 'good', ...navigation },
      false,
    );
    reportWebVital(
      { name: 'CLS', value: 0, rating: 'good', ...navigation },
      false,
    );
    const events = eventsNamed('browser.web_vital');
    for (const event of events) {
      expect(event.attributes).toMatchObject({
        'browser.web_vital.navigation_id': 3,
        'browser.web_vital.navigation_interaction_id': 812,
        'browser.web_vital.navigation_url': 'https://shop.example.com/cart',
      });
    }
  });

  it('names the INP script responsible, through the redactor', () => {
    reportWebVital(
      {
        name: 'INP',
        value: 600,
        rating: 'poor',
        attribution: {
          totalScriptDuration: 420,
          totalStyleAndLayoutDuration: 90,
          longAnimationFrameEntries: [{}],
          longestScript: {
            subpart: 'processing-duration',
            intersectingDuration: 380,
            entry: {
              sourceURL: 'https://shop.example.com/app.js?v=9',
              sourceFunctionName: 'renderCart',
              invoker: 'BUTTON#user-4821.onclick',
              invokerType: 'event-listener',
              forcedStyleAndLayoutDuration: 60,
            },
          },
        },
      },
      false,
      (value) => value.replaceAll(/user-\d+/g, '[ID]'),
    );
    const [event] = eventsNamed('browser.web_vital');
    expect(event.attributes).toMatchObject({
      'browser.web_vital.total_script_duration': 420,
      'browser.web_vital.total_style_and_layout_duration': 90,
      'browser.web_vital.longest_script.url': 'https://shop.example.com/app.js',
      'browser.web_vital.longest_script.function': 'renderCart',
      'browser.web_vital.longest_script.invoker': 'BUTTON#[ID].onclick',
      'browser.web_vital.longest_script.invoker_type': 'event-listener',
      'browser.web_vital.longest_script.subpart': 'processing-duration',
      'browser.web_vital.longest_script.duration': 380,
      'browser.web_vital.longest_script.forced_style_and_layout_duration': 60,
    });
  });

  it('redacts before capping, so a cut never splits a sensitive value', () => {
    // The email straddles the 1024 boundary: capped first, it would reach the
    // redactor as `alice@example` and slip past the pattern.
    const url = `https://example.com/${'a'.repeat(990)}/alice@example.com/x`;
    reportWebVital(
      { name: 'LCP', value: 1, rating: 'good', attribution: { url } },
      false,
      (value) => value.replaceAll(/[\w.]+@[\w.]+\.\w+/g, '[EMAIL]'),
    );
    const [event] = eventsNamed('browser.web_vital');
    const exported = String(event.attributes['browser.web_vital.resource_url']);
    expect(exported).not.toContain('alice');
    expect(exported).toContain('[EMAIL]');
    expect(exported.length).toBeLessThanOrEqual(1024);
  });
});
