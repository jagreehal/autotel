/**
 * Tests for correlation ID generation and propagation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateCorrelationId,
  getCorrelationId,
  getOrCreateCorrelationId,
  runWithCorrelationId,
  getCorrelationStorage,
} from './correlation-id';

describe('Correlation ID', () => {
  beforeEach(() => {
    // Clear the async local storage before each test
    // Run with undefined context to clear - safer than enterWith with type assertion
    getCorrelationStorage().disable();
  });

  describe('generateCorrelationId', () => {
    it('should generate 16 hex character ID', () => {
      const id = generateCorrelationId();
      expect(id).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(id)).toBe(true);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateCorrelationId());
      }
      // All 100 IDs should be unique
      expect(ids.size).toBe(100);
    });

    it('should generate URL-safe IDs (hex only)', () => {
      for (let i = 0; i < 50; i++) {
        const id = generateCorrelationId();
        // Should only contain hex characters
        expect(/^[0-9a-f]+$/.test(id)).toBe(true);
        // Should be URL-safe (no special characters)
        expect(encodeURIComponent(id)).toBe(id);
      }
    });
  });

  describe('getCorrelationId', () => {
    it('should return undefined when no correlation ID is set', () => {
      const id = getCorrelationId();
      expect(id).toBeUndefined();
    });
  });

  describe('runWithCorrelationId', () => {
    it('should set correlation ID within callback', () => {
      const testId = 'test123456789012';

      runWithCorrelationId(testId, () => {
        expect(getCorrelationId()).toBe(testId);
      });
    });

    it('should return callback result', () => {
      const result = runWithCorrelationId('abc123def4567890', () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
    });

    it('should isolate correlation ID to callback scope', () => {
      expect(getCorrelationId()).toBeUndefined();

      runWithCorrelationId('scoped-id-12345678', () => {
        expect(getCorrelationId()).toBe('scoped-id-12345678');
      });

      // After callback, should be back to undefined
      expect(getCorrelationId()).toBeUndefined();
    });

    it('should support nested runWithCorrelationId calls', () => {
      runWithCorrelationId('outer-id-1234567', () => {
        expect(getCorrelationId()).toBe('outer-id-1234567');

        runWithCorrelationId('inner-id-7654321', () => {
          expect(getCorrelationId()).toBe('inner-id-7654321');
        });

        // After inner callback, should be back to outer
        expect(getCorrelationId()).toBe('outer-id-1234567');
      });
    });

    it('should work with async callbacks', async () => {
      const result = await runWithCorrelationId('async-id-123456', async () => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getCorrelationId();
      });

      expect(result).toBe('async-id-123456');
    });
  });

  describe('getOrCreateCorrelationId', () => {
    it('should return existing correlation ID if set', () => {
      const existingId = 'existing-id-1234';

      runWithCorrelationId(existingId, () => {
        const id = getOrCreateCorrelationId();
        expect(id).toBe(existingId);
      });
    });

    it('should generate new ID if not set', () => {
      // No correlation ID set
      const id = getOrCreateCorrelationId();

      expect(id).toBeDefined();
      expect(id).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(id)).toBe(true);
    });

    it('should return same ID on repeated calls within same context', () => {
      runWithCorrelationId('stable-id-123456', () => {
        const id1 = getOrCreateCorrelationId();
        const id2 = getOrCreateCorrelationId();
        expect(id1).toBe(id2);
      });
    });
  });

  describe('format specification', () => {
    it('should be exactly 16 characters (64 bits)', () => {
      for (let i = 0; i < 20; i++) {
        const id = generateCorrelationId();
        expect(id.length).toBe(16);
      }
    });

    it('should be crypto-random (not time-based)', () => {
      // Generate two IDs in quick succession
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();

      // If time-based, first chars would likely be similar
      // With crypto-random, they should be completely different
      expect(id1).not.toBe(id2);

      // Check that the IDs don't have a predictable pattern
      // (This is a statistical test - very unlikely to fail with crypto-random)
      const firstChars = [];
      for (let i = 0; i < 10; i++) {
        firstChars.push(generateCorrelationId()[0]);
      }
      // With crypto-random, we shouldn't see all the same first character
      const uniqueFirstChars = new Set(firstChars);
      expect(uniqueFirstChars.size).toBeGreaterThan(1);
    });
  });
});
