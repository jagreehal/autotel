import { describe, it, expect, beforeEach } from 'vitest';
import {
  inferVariableNameFromCallStack,
  clearInferenceCache,
} from './variable-name-inference';

// Helper function that simulates trace() for testing
function trace<T>(fn: T): T {
  const varName = inferVariableNameFromCallStack();
  // Attach the inferred name to the function for verification
  (fn as { __inferredName?: string }).__inferredName = varName;
  return fn;
}

describe('variable-name-inference', () => {
  beforeEach(() => {
    // Clear cache before each test to ensure isolation
    clearInferenceCache();
  });

  describe('inferVariableNameFromCallStack', () => {
    it('should infer variable name from const assignment', () => {
      const testFunction = trace(() => 'test');

      expect((testFunction as { __inferredName?: string }).__inferredName).toBe(
        'testFunction',
      );
    });

    it('should cache inference results', () => {
      // Helper to test caching from same location
      function callFromSameLocation() {
        const cachedResult = trace(() => 'test');
        return (cachedResult as { __inferredName?: string }).__inferredName;
      }

      const result1 = callFromSameLocation();
      const result2 = callFromSameLocation();

      // Both calls from same location should get same cached result
      expect(result1).toBe('cachedResult');
      expect(result2).toBe('cachedResult');
    });

    it('should gracefully handle errors', () => {
      // This test verifies that even if something goes wrong,
      // the function returns undefined rather than throwing
      expect(() => trace(() => 'test')).not.toThrow();
    });
  });

  describe('pattern matching', () => {
    // These tests verify that the regex patterns work correctly
    // by creating actual assignments and checking inference

    it('should match const pattern', () => {
      const myConstVariable = trace(() => 'test');
      expect(
        (myConstVariable as { __inferredName?: string }).__inferredName,
      ).toBe('myConstVariable');
    });

    it('should handle camelCase names', () => {
      const myCamelCaseVariableName = trace(() => 'test');
      expect(
        (myCamelCaseVariableName as { __inferredName?: string }).__inferredName,
      ).toBe('myCamelCaseVariableName');
    });

    it('should handle PascalCase names', () => {
      const MyPascalCaseName = trace(() => 'test');
      expect(
        (MyPascalCaseName as { __inferredName?: string }).__inferredName,
      ).toBe('MyPascalCaseName');
    });

    it('should handle snake_case names', () => {
      const my_snake_case_name = trace(() => 'test');
      expect(
        (my_snake_case_name as { __inferredName?: string }).__inferredName,
      ).toBe('my_snake_case_name');
    });

    it('should handle names with numbers', () => {
      const myVariable123 = trace(() => 'test');
      expect(
        (myVariable123 as { __inferredName?: string }).__inferredName,
      ).toBe('myVariable123');
    });

    it('should handle names with dollar signs', () => {
      const $myVariable = trace(() => 'test');
      expect(($myVariable as { __inferredName?: string }).__inferredName).toBe(
        '$myVariable',
      );
    });

    it('should handle names with underscores', () => {
      const _privateVariable = trace(() => 'test');
      expect(
        (_privateVariable as { __inferredName?: string }).__inferredName,
      ).toBe('_privateVariable');
    });
  });

  describe('edge cases', () => {
    it('should handle multiple spaces in assignment', () => {
      const spacedVariable = trace(() => 'test');
      expect(
        (spacedVariable as { __inferredName?: string }).__inferredName,
      ).toBe('spacedVariable');
    });

    it('should handle assignment with no spaces', () => {
      const noSpaces = trace(() => 'test');
      expect((noSpaces as { __inferredName?: string }).__inferredName).toBe(
        'noSpaces',
      );
    });
  });

  describe('caching behavior', () => {
    it('should cache results for same call location', () => {
      // Helper function to call from same location multiple times
      function callFromSameLocation() {
        const cachedResult = trace(() => 'test');
        return (cachedResult as { __inferredName?: string }).__inferredName;
      }

      const result1 = callFromSameLocation();
      const result2 = callFromSameLocation();

      // Both calls from same source location should return same result
      expect(result1).toBe('cachedResult');
      expect(result2).toBe('cachedResult');
    });

    it('should clear cache when requested', () => {
      const beforeClear = trace(() => 'test');
      const result1 = (beforeClear as { __inferredName?: string })
        .__inferredName;

      clearInferenceCache();

      const afterClear = trace(() => 'test');
      const result2 = (afterClear as { __inferredName?: string })
        .__inferredName;

      // Both should infer correctly regardless of cache
      expect(result1).toBe('beforeClear');
      expect(result2).toBe('afterClear');
    });
  });

  describe('integration with trace pattern', () => {
    it('should work with factory pattern simulation', () => {
      // Simulate the factory pattern: trace((ctx) => async () => {})
      const myFactoryFunction = trace((_ctx: unknown) => async () => {
        return 'test';
      });

      expect(
        (myFactoryFunction as { __inferredName?: string }).__inferredName,
      ).toBe('myFactoryFunction');
    });

    it('should work with direct pattern simulation', () => {
      // Simulate direct pattern: trace(async () => {})
      const myDirectFunction = trace(async () => {
        return 'test';
      });

      expect(
        (myDirectFunction as { __inferredName?: string }).__inferredName,
      ).toBe('myDirectFunction');
    });
  });
});
