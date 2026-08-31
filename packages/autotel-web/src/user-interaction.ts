/**
 * Clicks.
 *
 * OpenTelemetry already names this `app.widget.click`, with `app.widget.*` for
 * what was clicked and `app.screen.*` for where. Those names were written for
 * mobile, but a button is a widget and a route is a screen, so a browser click
 * fits them exactly — and a dashboard built on them then covers web and mobile
 * without knowing which it is looking at.
 */

import { emitEvent } from './emit-event';
import { APP, AUTOTEL_WEB, WEB_EVENT } from './semconv';

export interface UserInteractionConfig {
  /** CSS selectors whose clicks are recorded. */
  selectors: string[];
  debug: boolean;
}

function closestMatch(
  target: Element | null,
  selectors: string[],
): Element | undefined {
  if (!target?.closest) return undefined;
  for (const selector of selectors) {
    const match = target.closest(selector);
    if (match) return match;
  }
  return undefined;
}

/**
 * The name a human would use for this widget, in the order a human would pick
 * one: what the app explicitly called it, then what a screen reader says, then
 * the tag as a last resort.
 */
export function widgetName(element: Element): string {
  return (
    element.getAttribute('data-track') ??
    element.getAttribute('aria-label') ??
    element.tagName.toLowerCase()
  );
}

/** Attributes describing a click on `element`, canonical names throughout. */
export function clickAttributes(
  element: Element,
  event: { clientX?: number; clientY?: number },
): Record<string, string | number> {
  const attributes: Record<string, string | number> = {
    [APP.WIDGET_NAME]: widgetName(element),
    [AUTOTEL_WEB.WIDGET_TAG]: element.tagName.toLowerCase(),
    [APP.SCREEN_NAME]: globalThis.location?.pathname ?? '',
  };
  if (element.id) attributes[APP.WIDGET_ID] = element.id;
  if (typeof event.clientX === 'number') {
    attributes[APP.SCREEN_COORDINATE_X] = event.clientX;
  }
  if (typeof event.clientY === 'number') {
    attributes[APP.SCREEN_COORDINATE_Y] = event.clientY;
  }
  return attributes;
}

export function setupUserInteractionInstrumentation(
  config: UserInteractionConfig,
): void {
  if (globalThis.document === undefined) return;

  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      // SAFETY: this listener is registered on document for click events, whose
      // target is the element clicked; closestMatch tolerates a detached node.
      const matched = closestMatch(event.target as Element, config.selectors);
      if (!matched) return;

      emitEvent(WEB_EVENT.WIDGET_CLICK, clickAttributes(matched, event));
      if (config.debug) {
        console.debug('[autotel-web] app.widget.click:', widgetName(matched));
      }
    },
    { capture: true, passive: true },
  );
}
