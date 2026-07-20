import { describe, expect, it } from 'vitest';
import module from './module';

describe('autotel-nuxt module', () => {
  it('exports a nuxt module factory', () => {
    expect(typeof module).toBe('function');
  });
});
