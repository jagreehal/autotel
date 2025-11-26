import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { init, resetForTesting } from './init';

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
    const mockFetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      // Track the call with its headers
      // Convert Headers object to plain object for easier testing
      const headersObj = init?.headers instanceof Headers 
        ? Object.fromEntries(init.headers.entries())
        : init?.headers;
      callTracker.push([input, { ...init, headers: headersObj }]);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    global.fetch = mockFetch;
    if (typeof window !== 'undefined') {
      (window as any).fetch = mockFetch;
    }
  });

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

    vi.restoreAllMocks();
    resetForTesting();
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

      await fetch('https://api.example.com/users');

      // Check that fetch was called without traceparent
      const [_, requestInit] = callTracker[0];
      const headers = requestInit?.headers instanceof Headers 
        ? requestInit.headers 
        : new Headers(requestInit?.headers);
      expect(headers.has('traceparent')).toBe(false);
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

      await fetch('https://api.example.com/users');

      // Check that fetch was called without traceparent
      const [_, requestInit] = callTracker[0];
      const headers = requestInit?.headers instanceof Headers 
        ? requestInit.headers 
        : new Headers(requestInit?.headers);
      expect(headers.has('traceparent')).toBe(false);
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

      await fetch('https://analytics.google.com/collect');

      // Check that fetch was called without traceparent
      const [_, requestInit] = callTracker[0];
      const headers = requestInit?.headers instanceof Headers 
        ? requestInit.headers 
        : new Headers(requestInit?.headers);
      expect(headers.has('traceparent')).toBe(false);
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

      await fetch('https://api.myapp.com/users');

      // Check that fetch was called without traceparent (DNT takes precedence)
      const [_, requestInit] = callTracker[0];
      const headers = new Headers(requestInit?.headers);
      expect(headers.has('traceparent')).toBe(false);
    });

  });



});
