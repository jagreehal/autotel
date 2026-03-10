import { describe, it, expect } from 'vitest';
import { getStringRedactor } from './init';

describe('getStringRedactor', () => {
  it('returns null when no attributeRedactor configured', () => {
    expect(getStringRedactor()).toBeNull();
  });
});
