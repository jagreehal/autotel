/**
 * Regression test for the theme-switching bug.
 *
 * Before the fix, Layout.svelte set `data-theme` on `documentElement` (or the
 * `<autotel-devtools>` element) — but the theme tokens are declared under
 * `:host([data-theme='…'])` inside the widget's shadow-root stylesheet, and
 * styles inside a shadow root are scoped to that root. Setting the attribute
 * outside the shadow tree had no effect, so the dark/light/system toggle did
 * nothing visually.
 *
 * These tests mount Layout inside a real shadow root and assert that
 * `data-theme` lands on the *shadow host* (the only element the scoped
 * `:host()` rule can actually see), and that cycling the theme updates it.
 */

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import Layout from '../components/Layout.svelte';
import {
  themeSignal,
  type ThemeValue,
} from '../store.svelte';

function mountInShadow(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  host.id = 'test-host';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  render(Layout, { target: root });
  return { host, root };
}

describe('Layout — theme switching', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('autotel-devtools-theme');
    } catch {
      /* ignore */
    }
    themeSignal.value = 'system';
  });

  afterEach(() => {
    cleanup();
    document
      .querySelectorAll<HTMLElement>('#test-host')
      .forEach((n) => n.remove());
    // Defensive: nothing should land on <html> in the auto-mount path.
    document.documentElement.removeAttribute('data-theme');
  });

  it('applies the data-theme attribute to the shadow host, not to <html>', async () => {
    const { host } = mountInShadow();
    // The init $effect runs `getInitialTheme()` → 'system' from our beforeEach,
    // then the host-attribute $effect applies it. The button lives in the
    // shadow root, so we have to query through `host.shadowRoot`.
    const themeButton = host.shadowRoot!.querySelector(
      'button[title^="Theme:"]',
    ) as HTMLButtonElement;
    expect(themeButton).toBeTruthy();

    expect(host.getAttribute('data-theme')).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('cycles the theme on the shadow host when the button is clicked', async () => {
    const { host } = mountInShadow();
    const themeButton = host.shadowRoot!.querySelector(
      'button[title^="Theme:"]',
    ) as HTMLButtonElement;

    expect(host.getAttribute('data-theme')).toBe('system');

    await fireEvent.click(themeButton);
    expect(host.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    await fireEvent.click(themeButton);
    expect(host.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    await fireEvent.click(themeButton);
    expect(host.getAttribute('data-theme')).toBe('system');
  });

  it('updates the host when themeSignal changes from outside', async () => {
    const { host } = mountInShadow();
    expect(host.getAttribute('data-theme')).toBe('system');

    themeSignal.value = 'dark' as ThemeValue;
    // $effect flush — testing-library flushes after events, but not after
    // direct signal writes, so yield once.
    await Promise.resolve();
    expect(host.getAttribute('data-theme')).toBe('dark');
  });
});
