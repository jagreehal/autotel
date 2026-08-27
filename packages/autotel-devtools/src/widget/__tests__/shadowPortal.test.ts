/**
 * @vitest-environment jsdom
 *
 * Shadow-DOM portal contract for the bits-ui-backed overlay components.
 *
 * Every overlay (popover, dialog, combobox listbox, tooltip) portals its
 * content. bits-ui defaults that target to `document.body`, which is the host
 * page — outside our shadow root, where none of our Tailwind styles reach and
 * where the host app's CSS would reach it instead. The widget therefore owns a
 * portal container *inside* the shadow root and points bits-ui at it via
 * `BitsConfig defaultPortalTo`.
 *
 * These tests pin that contract at the seam that matters: after opening an
 * overlay, its content must be findable inside the shadow root and absent from
 * `document.body`. If bits-ui changes its portal defaults, this fails loudly
 * rather than shipping an unstyled overlay into someone's product page.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import PortalHarness from './fixtures/PortalHarness.svelte';
import { createPortalTarget } from '../components/ui/portal';

let cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
  document.body.innerHTML = '';
});

/** Mount the harness inside a real shadow root, as `auto.ts` does in production. */
function mountInShadow() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const portalTarget = createPortalTarget(shadow);
  const app = mount(PortalHarness, {
    target: shadow as unknown as HTMLElement,
    props: { portalTarget },
  });

  cleanup.push(() => {
    void unmount(app);
    host.remove();
  });

  return { shadow, portalTarget };
}

describe('shadow-DOM portal target', () => {
  it('creates the portal container inside the shadow root, not the document', () => {
    const { shadow, portalTarget } = mountInShadow();

    expect(portalTarget.isConnected).toBe(true);
    expect(shadow.contains(portalTarget)).toBe(true);
    expect(document.body.contains(portalTarget)).toBe(false);
  });

  it('reuses one container per shadow root rather than stacking them', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const first = createPortalTarget(shadow);
    const second = createPortalTarget(shadow);

    expect(second).toBe(first);
    expect(shadow.querySelectorAll('[data-autotel-portal]')).toHaveLength(1);
    host.remove();
  });

  it('renders opened overlay content inside the shadow root', async () => {
    const { shadow } = mountInShadow();
    // `mount()` renders synchronously but Svelte flushes effects in a
    // microtask, and bits-ui attaches its trigger handlers from an effect — so
    // a click dispatched in the same tick lands before anything is listening.
    await tick();

    const trigger = shadow.querySelector<HTMLButtonElement>(
      '[data-testid="popover-trigger"]',
    );
    expect(trigger).not.toBeNull();

    clickLikeAUser(trigger!);
    await waitForShadow(shadow, '[data-testid="popover-content"]');

    expect(
      shadow.querySelector('[data-testid="popover-content"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector('[data-testid="popover-content"]'),
    ).toBeNull();
  });
});

/**
 * Dispatch the event sequence a real pointer click produces.
 *
 * `HTMLElement.click()` fires only `click`, and bits-ui's triggers open on
 * `pointerdown` — so a bare `.click()` leaves the overlay closed and makes this
 * look like a portal failure when it is a test-input failure.
 */
function clickLikeAUser(el: HTMLElement): void {
  const init = { bubbles: true, composed: true };
  el.dispatchEvent(new MouseEvent('pointerdown', init));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  el.dispatchEvent(new MouseEvent('pointerup', init));
  el.dispatchEvent(new MouseEvent('mouseup', init));
  el.click();
}

/** Poll the shadow root until `selector` appears, so we don't couple to bits-ui's tick count. */
async function waitForShadow(
  root: ShadowRoot,
  selector: string,
  timeoutMs = 1000,
): Promise<Element> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = root.querySelector(selector);
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for "${selector}" in shadow root`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
