/**
 * How much of the page anyone actually read.
 *
 * Scroll depth and content depth are different questions and the difference is
 * the whole point. Scroll depth is how far the reader moved; content depth is
 * how far down the page has been on screen — scroll position plus the height of
 * the viewport. On a page shorter than the window nothing scrolls, so a
 * scroll-only reading says 0% and the page looks like a bounce, when in fact
 * every word of it was visible.
 *
 * Both are reported at the end of a page view, alongside how long it lasted.
 * No OpenTelemetry convention covers this, so the attributes are autotel's,
 * named under `browser.page.*` beside the conventions that do exist.
 */

import { emitEvent } from './emit-event';
import { APP } from './semconv';

/** Event name for the end of a page view (autotel extension). */
export const PAGE_ENGAGEMENT_EVENT = 'browser.page_engagement';

export const PAGE_ENGAGEMENT_ATTR = {
  /** Deepest scroll reached, as a percentage of the scrollable distance. */
  MAX_SCROLL_PERCENTAGE: 'browser.page.max_scroll_percentage',
  /** Deepest point of the document that was on screen, as a percentage. */
  MAX_CONTENT_PERCENTAGE: 'browser.page.max_content_percentage',
  /** Seconds this page view lasted. */
  DURATION: 'browser.page.duration',
} as const;

export interface EngagementConfig {
  debug: boolean;
}

interface PageView {
  path: string;
  startedAt: number;
  maxScrollY: number;
  maxScrollHeight: number;
  maxContentY: number;
  maxContentHeight: number;
}

function scrollRoot(): Element | undefined {
  return globalThis.document?.documentElement ?? undefined;
}

/** A percentage of a total, where "nothing to cover" means fully covered. */
function percentage(reached: number, total: number): number {
  if (total <= 0) return 100;
  return Math.min(100, Math.round((reached / total) * 100));
}

/**
 * Start measuring engagement. Reports on `pagehide` and on history navigation,
 * so a single-page app gets one report per route rather than one per visit.
 * Returns a teardown.
 */
export function setupEngagement(config: EngagementConfig): () => void {
  if (globalThis.window === undefined) return () => {};

  let view: PageView | undefined;
  let reported = false;
  let initialMeasure: ReturnType<typeof setTimeout> | undefined;

  function startView(): void {
    view = {
      path: globalThis.location?.pathname ?? '',
      startedAt: Date.now(),
      maxScrollY: 0,
      maxScrollHeight: 0,
      maxContentY: 0,
      maxContentHeight: 0,
    };
    reported = false;
    // Not measured yet: at the instant a route changes the page is still
    // scrolled where the last one left it, and a framework scrolls to top on
    // the next tick. Measuring now would credit the new page with the old
    // page's depth.
    initialMeasure = setTimeout(measure, 0);
  }

  function measure(): void {
    if (!view) return;
    const element = scrollRoot();
    const viewportHeight = element?.clientHeight ?? 0;
    const documentHeight = element?.scrollHeight ?? 0;
    const scrollY = window.scrollY ?? element?.scrollTop ?? 0;

    view.maxScrollY = Math.max(view.maxScrollY, scrollY);
    view.maxScrollHeight = Math.max(
      view.maxScrollHeight,
      Math.max(0, documentHeight - viewportHeight),
    );
    view.maxContentY = Math.max(view.maxContentY, scrollY + viewportHeight);
    view.maxContentHeight = Math.max(view.maxContentHeight, documentHeight);
  }

  function report(): void {
    if (!view || reported) return;
    reported = true;
    measure();
    emitEvent(PAGE_ENGAGEMENT_EVENT, {
      [APP.SCREEN_NAME]: view.path,
      [PAGE_ENGAGEMENT_ATTR.MAX_SCROLL_PERCENTAGE]: percentage(
        view.maxScrollY,
        view.maxScrollHeight,
      ),
      [PAGE_ENGAGEMENT_ATTR.MAX_CONTENT_PERCENTAGE]: percentage(
        view.maxContentY,
        view.maxContentHeight,
      ),
      [PAGE_ENGAGEMENT_ATTR.DURATION]: Math.round(
        (Date.now() - view.startedAt) / 1000,
      ),
    });
    if (config.debug) {
      console.debug('[autotel-web] browser.page_engagement:', view.path);
    }
  }

  const onScroll = (): void => measure();
  const onHide = (): void => report();
  const onNavigate = (): void => {
    report();
    startView();
  };

  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('popstate', onNavigate);

  // `pushState` fires no event, so a single-page route change is invisible
  // without patching it. Restored on teardown.
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = (...args: Parameters<History['pushState']>) => {
    originalPushState(...args);
    onNavigate();
  };
  history.replaceState = (...args: Parameters<History['replaceState']>) => {
    originalReplaceState(...args);
    onNavigate();
  };

  startView();

  return () => {
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('resize', onScroll);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('popstate', onNavigate);
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    if (initialMeasure !== undefined) clearTimeout(initialMeasure);
    view = undefined;
  };
}
