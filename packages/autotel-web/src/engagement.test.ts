// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupEngagement } from './engagement';
import { captureEvents, eventsNamed } from './test-events';

const EVENT = 'browser.page_engagement';
let stop: (() => void) | undefined;

function sizePage(scrollHeight: number, clientHeight: number, scrollTop = 0) {
  const el = document.documentElement;
  Object.defineProperty(el, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  });
  Object.defineProperty(el, 'scrollTop', {
    value: scrollTop,
    configurable: true,
  });
  Object.defineProperty(window, 'scrollY', {
    value: scrollTop,
    configurable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  captureEvents();
  sizePage(2000, 500);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

describe('page engagement', () => {
  it('reports how far down the page the reader actually got', () => {
    stop = setupEngagement({ debug: false });
    sizePage(2000, 500, 750);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('pagehide'));

    const [span] = eventsNamed(EVENT);
    expect(span).toBeDefined();
    // Scrolled 750 of a possible 1500.
    expect(span.attributes['browser.page.max_scroll_percentage']).toBe(50);
  });

  it('separates content seen from distance scrolled', () => {
    stop = setupEngagement({ debug: false });
    sizePage(2000, 500, 750);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('pagehide'));

    // 750 scrolled + a 500 viewport means 1250 of 2000 has been on screen.
    expect(
      eventsNamed(EVENT)[0].attributes['browser.page.max_content_percentage'],
    ).toBe(63);
  });

  it('calls a page shorter than the viewport fully read', () => {
    // The case that makes scroll depth alone lie: nothing to scroll, so a
    // scroll-only reading says 0% and the page reads as a bounce.
    sizePage(400, 800);
    stop = setupEngagement({ debug: false });
    window.dispatchEvent(new Event('pagehide'));

    const [span] = eventsNamed(EVENT);
    expect(span.attributes['browser.page.max_scroll_percentage']).toBe(100);
    expect(span.attributes['browser.page.max_content_percentage']).toBe(100);
  });

  it('reports how long the page was open', () => {
    stop = setupEngagement({ debug: false });
    vi.advanceTimersByTime(12_000);
    window.dispatchEvent(new Event('pagehide'));
    expect(eventsNamed(EVENT)[0].attributes['browser.page.duration']).toBe(12);
  });

  it('names the page it is describing', () => {
    stop = setupEngagement({ debug: false });
    window.dispatchEvent(new Event('pagehide'));
    expect(eventsNamed(EVENT)[0].attributes['app.screen.name']).toBe(
      window.location.pathname,
    );
  });

  it('remembers the deepest point, not the last one', () => {
    stop = setupEngagement({ debug: false });
    sizePage(2000, 500, 1500);
    window.dispatchEvent(new Event('scroll'));
    sizePage(2000, 500, 0);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('pagehide'));
    expect(
      eventsNamed(EVENT)[0].attributes['browser.page.max_scroll_percentage'],
    ).toBe(100);
  });

  it('reports once per page view', () => {
    stop = setupEngagement({ debug: false });
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    expect(eventsNamed(EVENT)).toHaveLength(1);
  });

  it('starts a fresh measurement after a route change', () => {
    stop = setupEngagement({ debug: false });
    sizePage(2000, 500, 1500);
    window.dispatchEvent(new Event('scroll'));
    history.pushState({}, '', '/next');
    // The framework scrolls to top on the next tick; the new page must not
    // inherit the old one's depth.
    sizePage(2000, 500, 0);
    vi.advanceTimersByTime(1);
    window.dispatchEvent(new Event('pagehide'));

    const spans = eventsNamed(EVENT);
    expect(spans).toHaveLength(2);
    expect(spans[0].attributes['browser.page.max_scroll_percentage']).toBe(100);
    expect(spans[1].attributes['browser.page.max_scroll_percentage']).toBe(0);
  });
});
