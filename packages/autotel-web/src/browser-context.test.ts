// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { browserResourceAttributes } from './browser-context';

function withNavigator<T>(patch: Record<string, unknown>, run: () => T): T {
  const restore: [string, PropertyDescriptor | undefined][] = [];
  for (const [key, value] of Object.entries(patch)) {
    restore.push([key, Object.getOwnPropertyDescriptor(navigator, key)]);
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
  try {
    return run();
  } finally {
    for (const [key, descriptor] of restore) {
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else delete (navigator as unknown as Record<string, unknown>)[key];
    }
  }
}

describe('browserResourceAttributes', () => {
  it('reports the language under the canonical key', () => {
    expect(
      withNavigator({ language: 'en-GB' }, browserResourceAttributes),
    ).toMatchObject({ 'browser.language': 'en-GB' });
  });

  it('reports platform, mobile and brands from userAgentData', () => {
    const attrs = withNavigator(
      {
        userAgentData: {
          platform: 'macOS',
          mobile: false,
          brands: [
            { brand: 'Chromium', version: '140' },
            { brand: 'Not?A_Brand', version: '24' },
          ],
        },
      },
      browserResourceAttributes,
    );
    expect(attrs['browser.platform']).toBe('macOS');
    expect(attrs['browser.mobile']).toBe(false);
    expect(attrs['browser.brands']).toEqual(['Chromium 140', 'Not?A_Brand 24']);
  });

  it('omits what the browser does not expose rather than guessing', () => {
    // Safari and Firefox have no userAgentData. A parsed-from-user-agent guess
    // belongs in the collector, which has a real UA database.
    const attrs = withNavigator({ userAgentData: undefined }, browserResourceAttributes);
    expect(attrs['browser.platform']).toBeUndefined();
    expect(attrs['browser.mobile']).toBeUndefined();
    expect(attrs['browser.brands']).toBeUndefined();
  });

  it('returns nothing off-browser', () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      configurable: true,
    });
    try {
      expect(browserResourceAttributes()).toEqual({});
    } finally {
      if (navigatorDescriptor)
        Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    }
  });
});
