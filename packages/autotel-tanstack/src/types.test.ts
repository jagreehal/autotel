import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, SPAN_ATTRIBUTES } from './types';

describe('types', () => {
  describe('DEFAULT_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_CONFIG.captureArgs).toBe(true);
      expect(DEFAULT_CONFIG.captureResults).toBe(false);
      expect(DEFAULT_CONFIG.captureErrors).toBe(true);
      expect(DEFAULT_CONFIG.sampling).toBe('adaptive');
    });

    it('should capture x-request-id by default', () => {
      expect(DEFAULT_CONFIG.captureHeaders).toContain('x-request-id');
    });

    it('should not exclude any paths by default', () => {
      expect(DEFAULT_CONFIG.excludePaths).toEqual([]);
    });
  });

  describe('SPAN_ATTRIBUTES', () => {
    it('should have HTTP semantic convention attributes', () => {
      expect(SPAN_ATTRIBUTES.HTTP_REQUEST_METHOD).toBe('http.request.method');
      expect(SPAN_ATTRIBUTES.HTTP_RESPONSE_STATUS_CODE).toBe(
        'http.response.status_code',
      );
      expect(SPAN_ATTRIBUTES.URL_PATH).toBe('url.path');
    });

    it('should have RPC semantic convention attributes', () => {
      expect(SPAN_ATTRIBUTES.RPC_SYSTEM).toBe('rpc.system');
      expect(SPAN_ATTRIBUTES.RPC_METHOD).toBe('rpc.method');
    });

    it('should have TanStack-specific attributes', () => {
      expect(SPAN_ATTRIBUTES.TANSTACK_TYPE).toBe('tanstack.type');
      expect(SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_NAME).toBe(
        'tanstack.server_function.name',
      );
      expect(SPAN_ATTRIBUTES.TANSTACK_LOADER_ROUTE_ID).toBe(
        'tanstack.loader.route_id',
      );
    });
  });
});
