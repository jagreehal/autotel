import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { init, resetForTesting } from './init';

const PAGE_ORIGIN = 'https://app.example.com';

describe('init() with privacy controls', () => {
  let callTracker: Array<[RequestInfo | URL, RequestInit | undefined]> = [];

  beforeEach(() => {
    // Reset between tests
    resetForTesting();
    callTracker = [];

    // Clean up any navigator mocks from previous tests
    Object.defineProperty(navigator, 'doNotTrack', {
      value: null,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    // Mock the underlying fetch that will be called by the patched version
    //  This needs to happen BEFORE init() so it's in place when fetch is patched
    const mockFetch = vi
      .fn()
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        // Track the call with its headers
        // Convert Headers object to plain object for easier testing
        const headersObj =
          init?.headers instanceof Headers
            ? Object.fromEntries(init.headers.entries())
            : init?.headers;
        callTracker.push([input, { ...init, headers: headersObj }]);
        // SAFETY: init() reads `ok` and `status` off what fetch resolves to;
        // nothing else of Response is reached on this path.
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response);
      });

    // init() returns at its SSR guard without a window, so without this stub
    // nothing is patched and every "does not inject" assertion below passes
    // for the wrong reason.
    vi.stubGlobal('window', {
      fetch: mockFetch,
      location: { origin: PAGE_ORIGIN, href: `${PAGE_ORIGIN}/` },
      addEventListener: vi.fn(),
    });
    global.fetch = mockFetch;
  });

  /** The instrumented fetch init() installed on the stubbed window. */
  function patchedFetch(): typeof fetch {
    // SAFETY: the beforeEach stubs a window carrying a fetch, and init()
    // replaces it with the instrumented one before any test calls this.
    return (globalThis.window as { fetch: typeof fetch }).fetch;
  }

  /** The traceparent on the most recent call, or null. */
  function lastTraceparent(): string | null {
    const requestInit = callTracker.at(-1)?.[1];
    const headers = new Headers(requestInit?.headers);
    return headers.get('traceparent');
  }

  afterEach(() => {
    // Clean up navigator mocks
    Object.defineProperty(navigator, 'doNotTrack', {
      value: null,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetForTesting();
  });

  it('injects traceparent with no privacy config (control)', async () => {
    init({ service: 'test-app' });

    await patchedFetch()(`${PAGE_ORIGIN}/api/users`);

    expect(lastTraceparent()).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-0[01]$/);
  });

  describe('Do Not Track (DNT)', () => {
    afterEach(() => {
      Object.defineProperty(navigator, 'doNotTrack', {
        value: null,
        configurable: true,
        writable: true,
      });
    });

    it('should not inject traceparent when DNT is enabled and respectDoNotTrack is true', async () => {
      Object.defineProperty(navigator, 'doNotTrack', {
        value: '1',
        configurable: true,
      });

      init({
        service: 'test-app',
        privacy: {
          respectDoNotTrack: true,
        },
      });

      // Same-origin, so only the DNT check can stop the injection.
      await patchedFetch()(`${PAGE_ORIGIN}/api/users`);

      expect(lastTraceparent()).toBeNull();
    });
  });

  describe('Global Privacy Control (GPC)', () => {
    it('should not inject traceparent when GPC is enabled and respectGPC is true', async () => {
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        value: true,
        configurable: true,
      });

      init({
        service: 'test-app',
        privacy: {
          respectGPC: true,
        },
      });

      // Same-origin, so only the DNT check can stop the injection.
      await patchedFetch()(`${PAGE_ORIGIN}/api/users`);

      expect(lastTraceparent()).toBeNull();
    });
  });

  describe('Origin Blocklist', () => {
    it('should not inject traceparent for blocked origins', async () => {
      init({
        service: 'test-app',
        privacy: {
          blockedOrigins: ['analytics.google.com', 'facebook.com'],
        },
      });

      await patchedFetch()('https://analytics.google.com/collect');

      expect(lastTraceparent()).toBeNull();
    });
  });

  describe('Combined Privacy Controls', () => {
    afterEach(() => {
      Object.defineProperty(navigator, 'doNotTrack', {
        value: null,
        configurable: true,
        writable: true,
      });
    });

    it('should respect DNT even if origin is allowed', async () => {
      Object.defineProperty(navigator, 'doNotTrack', {
        value: '1',
        configurable: true,
      });

      init({
        service: 'test-app',
        privacy: {
          respectDoNotTrack: true,
          allowedOrigins: ['api.myapp.com'],
        },
      });

      await patchedFetch()('https://api.myapp.com/users');

      // DNT takes precedence over the allowlist.
      expect(lastTraceparent()).toBeNull();
    });
  });
});
