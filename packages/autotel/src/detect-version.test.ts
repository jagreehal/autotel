import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectVersion } from './config-resolution';

const VARS = [
  'SERVICE_VERSION',
  'DD_VERSION',
  'APP_VERSION',
  'COMMIT_SHA',
  'GIT_SHA',
  'GIT_COMMIT',
  'GITHUB_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'CF_PAGES_COMMIT_SHA',
  'RENDER_GIT_COMMIT',
  'RAILWAY_GIT_COMMIT_SHA',
  'HEROKU_SLUG_COMMIT',
  'SOURCE_VERSION',
];

describe('detectVersion', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Each test starts from a clean slate, whatever CI the suite runs in.
  const clear = () => {
    for (const name of VARS) vi.stubEnv(name, '');
  };

  it('reads package.json when no deploy variable is set', () => {
    clear();
    expect(detectVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('uses the deployed commit over package.json', () => {
    clear();
    vi.stubEnv('GIT_SHA', 'abc1234');
    expect(detectVersion()).toBe('abc1234');
  });

  it('prefers a version the deploy sets over the commit', () => {
    clear();
    vi.stubEnv('GITHUB_SHA', 'abc1234');
    vi.stubEnv('DD_VERSION', '2026.10.27');
    expect(detectVersion()).toBe('2026.10.27');
    vi.stubEnv('SERVICE_VERSION', 'v42');
    expect(detectVersion()).toBe('v42');
  });
});
