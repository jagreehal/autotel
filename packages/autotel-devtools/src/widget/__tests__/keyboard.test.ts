/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('keyboard utilities', () => {
  describe('module exports', () => {
    it('exports isInputFocused and isMac', async () => {
      const mod = await import('../utils/keyboard');
      expect(typeof mod.isInputFocused).toBe('function');
      expect(typeof mod.isMac).toBe('boolean');
    });
  });

  describe('isInputFocused', () => {
    it('handles activeElement being null safely', async () => {
      const mod = await import('../utils/keyboard');
      // Force activeElement to null to test the guard
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        Document.prototype,
        'activeElement',
      );
      Object.defineProperty(document, 'activeElement', {
        value: null,
        configurable: true,
      });
      const result = mod.isInputFocused();
      // Restore
      if (originalDescriptor) {
        Object.defineProperty(
          Document.prototype,
          'activeElement',
          originalDescriptor,
        );
      } else {
        delete (document as any).activeElement;
      }
      expect(result).toBe(false);
    });

    it('returns false for body element', async () => {
      const mod = await import('../utils/keyboard');
      expect(mod.isInputFocused()).toBe(false);
    });
  });

  describe('isMac', () => {
    it('is a boolean constant', async () => {
      const mod = await import('../utils/keyboard');
      expect(typeof mod.isMac).toBe('boolean');
    });
  });
});
