import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from './types.js';

describe('DEFAULT_CONFIG', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_CONFIG.captureArgs).toBe(true);
    expect(DEFAULT_CONFIG.captureResults).toBe(false);
    expect(DEFAULT_CONFIG.captureErrors).toBe(true);
  });

  it('should not have customAttributes in defaults', () => {
    expect('customAttributes' in DEFAULT_CONFIG).toBe(false);
  });
});
