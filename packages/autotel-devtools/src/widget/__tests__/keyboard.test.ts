/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('keyboard utilities', () => {
  describe('module exports', () => {
    it('exports isInputFocused and isMac', async () => {
      const mod = await import('../utils/keyboard');
      expect(mod.isInputFocused).toBeTypeOf('function');
      expect(mod.isMac).toBeTypeOf('boolean');
    });
  });

  describe('isInputFocused', () => {
    it('handles activeElement being null safely', async () => {
      const mod = await import('../utils/keyboard');
      // Force activeElement to null to test the guard. The stub is an *own*
      // property on `document`, so deleting it is what restores the prototype
      // getter — restoring a `Document.prototype` descriptor leaves the own
      // property in place and pins activeElement to null for every later test.
      Object.defineProperty(document, 'activeElement', {
        value: null,
        configurable: true,
      });
      const result = mod.isInputFocused();
      delete (document as unknown as Record<string, unknown>).activeElement;
      expect(result).toBe(false);
      expect(document.activeElement).toBe(document.body);
    });

    it('returns false for body element', async () => {
      const mod = await import('../utils/keyboard');
      expect(mod.isInputFocused()).toBe(false);
    });
  });

  describe('isMac', () => {
    it('is a boolean constant', async () => {
      const mod = await import('../utils/keyboard');
      expect(mod.isMac).toBeTypeOf('boolean');
    });
  });
});

describe('isInputFocused inside shadow DOM', () => {
  // The devtools widget renders into a shadow root, so `document.activeElement`
  // is the shadow *host*, not the focused input. Global shortcuts ("l", "w",
  // "f", "e", "/") must still be suppressed while typing in the attribute
  // filter box.
  it('returns true when the focused input lives in a shadow root', async () => {
    const mod = await import('../utils/keyboard');
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.append(input);
    input.focus();

    expect(shadow.activeElement).toBe(input);
    expect(mod.isInputFocused()).toBe(true);

    host.remove();
  });
});
