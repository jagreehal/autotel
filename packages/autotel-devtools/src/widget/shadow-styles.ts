// The one way the widget styles its shadow root, for every mount path
// (`<autotel-devtools>` and the auto-mounting script tag).

import cssText from './styles.css?inline';

const HOISTED = 'data-autotel-devtools-properties';

/**
 * Register the stylesheet's `@property` rules on the document.
 *
 * Tailwind v4 declares its utility variables (`--tw-translate-y`,
 * `--tw-shadow`, …) with `@property`, and browsers apply `@property` rules
 * from the document, not from a shadow root. Registering them on the document
 * gives transform, border, ring and shadow utilities their initial values
 * inside the widget. Once per document; a host page's own Tailwind registers
 * the same rules.
 */
export function hoistPropertyRules(
  css: string,
  doc: Document = document,
): void {
  if (doc.head.querySelector(`style[${HOISTED}]`)) return;
  const rules = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g);
  if (!rules) return;
  const style = doc.createElement('style');
  style.setAttribute(HOISTED, '');
  style.textContent = rules.join('\n');
  doc.head.appendChild(style);
}

/** Inject the widget stylesheet into a shadow root, and register its variables. */
export function styleShadowRoot(shadow: ShadowRoot): void {
  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);
  hoistPropertyRules(cssText);
}
