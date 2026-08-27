/**
 * Portal target for overlay content (popover, dialog, combobox listbox, tooltip).
 *
 * bits-ui portals overlay content to `document.body` by default. In the embedded
 * widget that is the *host page* — outside our shadow root, where none of our
 * Tailwind styles reach and where the host app's CSS reaches it instead. So the
 * widget owns a container inside its own root and points bits-ui at it once, via
 * `BitsConfig defaultPortalTo`, rather than per-overlay.
 *
 * `PortalTarget` is `Element | string`, and a `ShadowRoot` is a `DocumentFragment`
 * rather than an `Element` — so the shadow root itself cannot be the target. This
 * appends a plain `<div>` to it and hands that back.
 */

/** Marks the container so repeat calls find it instead of stacking duplicates. */
const PORTAL_ATTR = 'data-autotel-portal';

/**
 * The overlay container for `root`, created on first call and reused after.
 *
 * Idempotent per root: the widget can be mounted, unmounted and remounted into
 * the same shadow root (the custom element does exactly that on reconnect)
 * without leaving a trail of empty containers behind.
 */
export function createPortalTarget(
  root: ShadowRoot | HTMLElement,
): HTMLElement {
  const existing = root.querySelector<HTMLElement>(`[${PORTAL_ATTR}]`);
  if (existing) return existing;

  const target = document.createElement('div');
  target.setAttribute(PORTAL_ATTR, '');
  // The container is a positioning context only — it must never intercept
  // pointer events or occupy layout space when no overlay is open. Overlay
  // content sets its own `pointer-events` and stacking.
  target.style.position = 'absolute';
  target.style.top = '0';
  target.style.left = '0';
  target.style.zIndex = '2147483000';
  root.appendChild(target);
  return target;
}
