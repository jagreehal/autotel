import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollectorCatalogCache,
  getCollectorComponentSchema,
  listCollectorVersions,
} from '../src/modules/collector-catalog';
import {
  clearSemanticConventionCache,
  getSemanticConventionNamespace,
  listSemanticConventionNamespaces,
} from '../src/modules/semantic-conventions';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = {
    ...originalEnv,
    AUTOTEL_OFFLINE_MODE: 'true',
  };
  clearCollectorCatalogCache();
  clearSemanticConventionCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network unavailable');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
  clearCollectorCatalogCache();
  clearSemanticConventionCache();
});

describe('offline snapshots', () => {
  it('loads collector versions from bundled snapshots when offline', async () => {
    const versions = await listCollectorVersions(true);
    expect(versions[0]).toBe('0.147.0');
  });

  it('loads collector component schema from bundled snapshots when offline', async () => {
    const schema = await getCollectorComponentSchema(
      'receiver',
      'otlp',
      '0.147.0',
    );
    expect(schema).toMatchObject({
      type: 'object',
      required: ['protocols'],
    });
  });

  it('loads semantic convention namespaces and files from bundled snapshots when offline', async () => {
    const namespaces = await listSemanticConventionNamespaces(true);
    expect(namespaces).toContain('http');

    const file = await getSemanticConventionNamespace('http');
    expect(file.namespace).toBe('http');
    expect(file.conventions.length).toBeGreaterThan(0);
  });
});
