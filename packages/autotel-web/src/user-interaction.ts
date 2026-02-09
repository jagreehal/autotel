/**
 * User interaction (click) spans for full mode
 *
 * Uses event delegation: one listener, creates a short span per click on matching elements.
 */

import { trace } from '@opentelemetry/api';

export interface UserInteractionConfig {
  selectors: string[];
  debug: boolean;
}

function matchesSelectors(element: Element, selectors: string[]): boolean {
  return selectors.some((sel) => element.matches(sel));
}

function closestMatch(element: Element | null, selectors: string[]): Element | null {
  let el: Element | null = element;
  while (el) {
    if (matchesSelectors(el, selectors)) return el;
    el = el.parentElement;
  }
  return null;
}

export function setupUserInteractionInstrumentation(config: UserInteractionConfig): void {
  if (typeof document === 'undefined') return;

  const tracer = trace.getTracer('autotel-web', '1.0.0');

  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      const target = event.target as Element;
      const matched = closestMatch(target, config.selectors);
      if (!matched) return;

      const tagName = matched.tagName.toLowerCase();
      const name = matched.getAttribute('data-track') ?? matched.getAttribute('aria-label') ?? tagName;
      const spanName = `click: ${name}`;

      const span = tracer.startSpan(spanName, {
        attributes: {
          'user.interaction.type': 'click',
          'element.tag': tagName,
          ...(matched.id && { 'element.id': matched.id }),
          ...(matched.getAttribute('data-track') && { 'element.data_track': matched.getAttribute('data-track')! }),
        },
      });
      span.end();
      if (config.debug) {
        console.debug('[autotel-web] user interaction span:', spanName);
      }
    },
    { capture: true, passive: true }
  );
}
