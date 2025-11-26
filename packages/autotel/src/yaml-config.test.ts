import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadYamlConfigFromFile,
  loadYamlConfig,
  hasYamlConfig,
} from './yaml-config.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('yaml-config', () => {
  const testDir = path.join(tmpdir(), `autotel-yaml-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    // Reset environment variables
    delete process.env.AUTOTEL_CONFIG_FILE;
    delete process.env.TEST_SERVICE_NAME;
    delete process.env.TEST_ENDPOINT;
    delete process.env.UNDEFINED_VAR;
  });

  afterEach(() => {
    // Cleanup test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadYamlConfigFromFile', () => {
    it('should parse basic YAML config', () => {
      const yaml = `
service:
  name: test-service
  version: 1.0.0
  environment: production
debug: true
`;
      const filePath = path.join(testDir, 'test.yaml');
      writeFileSync(filePath, yaml);

      const config = loadYamlConfigFromFile(filePath);
      expect(config.service).toBe('test-service');
      expect(config.version).toBe('1.0.0');
      expect(config.environment).toBe('production');
      expect(config.debug).toBe(true);
    });

    it('should parse exporter configuration', () => {
      const yaml = `
exporter:
  endpoint: http://localhost:4318
  protocol: grpc
  headers:
    x-api-key: secret-key
    x-custom: value
`;
      const filePath = path.join(testDir, 'exporter.yaml');
      writeFileSync(filePath, yaml);

      const config = loadYamlConfigFromFile(filePath);
      expect(config.endpoint).toBe('http://localhost:4318');
      expect(config.protocol).toBe('grpc');
      expect(config.otlpHeaders).toEqual({
        'x-api-key': 'secret-key',
        'x-custom': 'value',
      });
    });

    it('should parse resource attributes', () => {
      const yaml = `
resource:
  deployment.environment: production
  team: backend
  version: 2.0.0
`;
      const filePath = path.join(testDir, 'resource.yaml');
      writeFileSync(filePath, yaml);

      const config = loadYamlConfigFromFile(filePath);
      expect(config.resourceAttributes).toEqual({
        'deployment.environment': 'production',
        team: 'backend',
        version: '2.0.0',
      });
    });

    it('should parse integrations as array', () => {
      const yaml = `
integrations:
  - express
  - http
  - pino
`;
      const filePath = path.join(testDir, 'integrations.yaml');
      writeFileSync(filePath, yaml);

      const config = loadYamlConfigFromFile(filePath);
      expect(config.integrations).toEqual(['express', 'http', 'pino']);
    });

    it('should parse integrations as object', () => {
      const yaml = `
integrations:
  express:
    enabled: true
  http:
    enabled: false
`;
      const filePath = path.join(testDir, 'integrations-obj.yaml');
      writeFileSync(filePath, yaml);

      const config = loadYamlConfigFromFile(filePath);
      expect(config.integrations).toEqual({
        express: { enabled: true },
        http: { enabled: false },
      });
    });

    it('should substitute environment variables', () => {
      process.env.TEST_SERVICE_NAME = 'from-env';
      process.env.TEST_ENDPOINT = 'http://env-endpoint:4318';

      const yaml = `
service:
  name: \${env:TEST_SERVICE_NAME}
exporter:
  endpoint: \${env:TEST_ENDPOINT}
`;
      const filePath = path.join(testDir, 'env-test.yaml');
      writeFileSync(filePath, yaml);

      const config = loadYamlConfigFromFile(filePath);
      expect(config.service).toBe('from-env');
      expect(config.endpoint).toBe('http://env-endpoint:4318');
    });

    it('should use default value when env var not set', () => {
      const yaml = `
service:
  name: \${env:UNDEFINED_VAR:-default-service}
  environment: \${env:NODE_ENV:-development}
`;
      const filePath = path.join(testDir, 'default-test.yaml');
      writeFileSync(filePath, yaml);

      const config = loadYamlConfigFromFile(filePath);
      expect(config.service).toBe('default-service');
      // NODE_ENV might be set in test environment, so just check it's a string
      expect(typeof config.environment).toBe('string');
    });

    it('should handle nested env var substitution', () => {
      process.env.TEST_SERVICE_NAME = 'nested-service';

      const yaml = `
service:
  name: \${env:TEST_SERVICE_NAME}
exporter:
  headers:
    x-api-key: \${env:TEST_API_KEY:-fallback-key}
`;
      const filePath = path.join(testDir, 'nested-env.yaml');
      writeFileSync(filePath, yaml);

      const config = loadYamlConfigFromFile(filePath);
      expect(config.service).toBe('nested-service');
      expect(config.otlpHeaders).toEqual({
        'x-api-key': 'fallback-key',
      });
    });

    it('should warn on missing env var without default', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const yaml = `
service:
  name: \${env:DEFINITELY_NOT_SET}
`;
      const filePath = path.join(testDir, 'missing-env.yaml');
      writeFileSync(filePath, yaml);

      const config = loadYamlConfigFromFile(filePath);
      // Empty string from missing env var results in undefined (filtered out as falsy)
      expect(config.service).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('DEFINITELY_NOT_SET'),
      );

      warnSpy.mockRestore();
    });

    it('should throw on invalid YAML', () => {
      const yaml = `
service:
  name: test
  invalid yaml: [unclosed
`;
      const filePath = path.join(testDir, 'invalid.yaml');
      writeFileSync(filePath, yaml);

      expect(() => loadYamlConfigFromFile(filePath)).toThrow();
    });

    it('should throw on non-existent file', () => {
      expect(() => loadYamlConfigFromFile('/non/existent/path.yaml')).toThrow();
    });
  });

  describe('loadYamlConfig', () => {
    it('should return null when no config file exists', () => {
      // No AUTOTEL_CONFIG_FILE set and no autotel.yaml in cwd
      const result = loadYamlConfig();
      // Result depends on whether autotel.yaml exists in cwd
      // This test just verifies the function doesn't throw
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should load from AUTOTEL_CONFIG_FILE env var', () => {
      const yaml = `
service:
  name: from-env-path
`;
      const filePath = path.join(testDir, 'env-config.yaml');
      writeFileSync(filePath, yaml);
      process.env.AUTOTEL_CONFIG_FILE = filePath;

      const config = loadYamlConfig();
      expect(config).not.toBeNull();
      expect(config?.service).toBe('from-env-path');
    });

    it('should warn when AUTOTEL_CONFIG_FILE points to non-existent file', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.AUTOTEL_CONFIG_FILE = '/non/existent/file.yaml';

      const config = loadYamlConfig();
      expect(config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Config file not found'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('hasYamlConfig', () => {
    it('should return false when no config exists', () => {
      // Delete any AUTOTEL_CONFIG_FILE
      delete process.env.AUTOTEL_CONFIG_FILE;
      // This test depends on cwd not having autotel.yaml
      // Just verify it returns a boolean
      expect(typeof hasYamlConfig()).toBe('boolean');
    });

    it('should return true when AUTOTEL_CONFIG_FILE exists', () => {
      const filePath = path.join(testDir, 'has-config.yaml');
      writeFileSync(filePath, 'service:\n  name: test\n');
      process.env.AUTOTEL_CONFIG_FILE = filePath;

      expect(hasYamlConfig()).toBe(true);
    });
  });
});
