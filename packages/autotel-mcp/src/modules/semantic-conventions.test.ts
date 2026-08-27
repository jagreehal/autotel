import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  clearSemanticConventionCache,
  getSemanticConventionNamespace,
} from './semantic-conventions';

describe('getSemanticConventionNamespace() when the namespace is missing', () => {
  beforeEach(() => {
    process.env.AUTOTEL_OFFLINE_MODE = '1';
    clearSemanticConventionCache();
  });

  afterEach(() => {
    delete process.env.AUTOTEL_OFFLINE_MODE;
    clearSemanticConventionCache();
  });

  it('names the namespaces that do exist', async () => {
    // 'db' is the attribute prefix; the namespace is called 'database'. The old
    // message said only "not found" and left you to guess.
    await expect(getSemanticConventionNamespace('db')).rejects.toThrow(
      /database/,
    );
  });

  it('names the tool that refreshes the cache', async () => {
    await expect(getSemanticConventionNamespace('db')).rejects.toThrow(
      /semconv_refresh_cache/,
    );
  });
});
