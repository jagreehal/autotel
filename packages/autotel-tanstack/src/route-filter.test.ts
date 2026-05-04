import { describe, expect, it } from 'vitest';
import { isExcludedPath } from './route-filter';

describe('route-filter', () => {
  it('matches plain string paths as prefix for backwards compatibility', () => {
    expect(isExcludedPath('/health', ['/health'])).toBe(true);
    expect(isExcludedPath('/healthz', ['/health'])).toBe(true);
    expect(isExcludedPath('/api/users', ['/health'])).toBe(false);
  });

  it('matches glob patterns through shared autotel-edge matcher', () => {
    expect(isExcludedPath('/api/internal/debug', ['/api/internal/*'])).toBe(
      true,
    );
    expect(isExcludedPath('/api/public/debug', ['/api/internal/*'])).toBe(
      false,
    );
  });

  it('matches regex patterns', () => {
    expect(isExcludedPath('/api/v2/health', [/^\/api\/v\d+\/health$/])).toBe(
      true,
    );
    expect(isExcludedPath('/api/v2/users', [/^\/api\/v\d+\/health$/])).toBe(
      false,
    );
  });
});
