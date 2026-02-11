import { describe, expect, it } from 'vitest';
import { createGoogleCloudConfig } from './google-cloud';

describe('createGoogleCloudConfig()', () => {
  describe('validation', () => {
    it('should throw if projectId is missing', () => {
      expect(() => {
        createGoogleCloudConfig({
          // @ts-expect-error - testing missing projectId
          projectId: '',
          service: 'test-service',
        });
      }).toThrow('projectId is required');
    });
  });

  describe('useCollector mode', () => {
    it('should return endpoint and headers when useCollector is true', () => {
      const config = createGoogleCloudConfig({
        projectId: 'my-project',
        service: 'my-service',
        useCollector: true,
      });

      expect(config).toMatchObject({
        service: 'my-service',
        endpoint: 'http://localhost:4318',
        headers: { 'x-goog-user-project': 'my-project' },
      });
    });

    it('should use custom collectorEndpoint when provided', () => {
      const config = createGoogleCloudConfig({
        projectId: 'my-project',
        service: 'my-service',
        useCollector: true,
        collectorEndpoint: 'http://collector:4318',
      });

      expect(config.endpoint).toBe('http://collector:4318');
    });

    it('should pass through environment and version', () => {
      const config = createGoogleCloudConfig({
        projectId: 'my-project',
        service: 'my-service',
        useCollector: true,
        environment: 'production',
        version: '1.2.3',
      });

      expect(config.environment).toBe('production');
      expect(config.version).toBe('1.2.3');
    });
  });
});
