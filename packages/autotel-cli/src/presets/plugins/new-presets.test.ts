import { describe, expect, it } from 'vitest';
import { getPreset, listPresetSlugs } from '../index';

describe('new first-party presets', () => {
  it.each(['sentry', 'hono', 'mcp', 'tanstack'])(
    'registers %s as a plugin preset',
    (slug) => {
      const p = getPreset('plugin', slug);
      expect(p, `expected plugin preset "${slug}" to exist`).toBeDefined();
      expect(p?.type).toBe('plugin');
      expect(p?.packages.required.length).toBeGreaterThan(0);
    }
  );

  it('plugin slug list includes the new presets and the existing ones', () => {
    const slugs = listPresetSlugs('plugin');
    expect(slugs).toEqual(
      expect.arrayContaining([
        'mongoose',
        'drizzle',
        'sentry',
        'hono',
        'mcp',
        'tanstack',
      ])
    );
  });

  it('every new preset has at least one nextStep', () => {
    for (const slug of ['sentry', 'hono', 'mcp', 'tanstack']) {
      const p = getPreset('plugin', slug);
      expect(p?.nextSteps.length).toBeGreaterThan(0);
    }
  });

  it('sentry preset declares SENTRY_DSN as sensitive env var', () => {
    const p = getPreset('plugin', 'sentry');
    const dsn = p?.env.required.find((e) => e.name === 'SENTRY_DSN');
    expect(dsn?.sensitive).toBe(true);
  });
});
