import { describe, it, expect } from 'vitest';
import { getServiceColor, SERVICE_COLORS } from './service-colors';

describe('getServiceColor', () => {
  it('returns a valid ink color for any service name', () => {
    expect(SERVICE_COLORS).toContain(getServiceColor('frontend'));
    expect(SERVICE_COLORS).toContain(getServiceColor('backend-api'));
  });

  it('returns same color for same service', () => {
    expect(getServiceColor('auth')).toBe(getServiceColor('auth'));
  });

  it('returns different colors for different services (likely)', () => {
    const colors = new Set(
      ['frontend', 'backend', 'database', 'auth', 'cache'].map((s) =>
        getServiceColor(s),
      ),
    );
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });
});
