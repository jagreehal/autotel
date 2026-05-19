import { describe, expect, it } from 'vitest';
import { parsePlan } from './plan';
import { AutotelError } from './errors';

describe('parsePlan', () => {
  it('accepts a well-formed plan', () => {
    const plan = parsePlan({
      v: 1,
      presets: ['hono', 'posthog'],
      packagesToInstall: { prod: ['autotel'], dev: [] },
      filesToWrite: [],
      envVars: [],
      nextSteps: [],
    });
    expect(plan.presets).toEqual(['hono', 'posthog']);
  });

  it('throws E_INVALID_PLAN for non-object input', () => {
    let thrown: unknown;
    try {
      parsePlan('not an object');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AutotelError);
    expect((thrown as AutotelError).code).toBe('AUTOTEL_E_INVALID_PLAN');
  });

  it('throws for unsupported version', () => {
    expect(() =>
      parsePlan({
        v: 2,
        presets: [],
        packagesToInstall: { prod: [], dev: [] },
        filesToWrite: [],
        envVars: [],
        nextSteps: [],
      })
    ).toThrowError(/Unsupported plan version/);
  });

  it('throws when presets is not an array', () => {
    expect(() =>
      parsePlan({
        v: 1,
        presets: 'hono',
        packagesToInstall: { prod: [], dev: [] },
        filesToWrite: [],
        envVars: [],
        nextSteps: [],
      })
    ).toThrowError(/presets must be an array/);
  });

  it('throws when packagesToInstall malformed', () => {
    expect(() =>
      parsePlan({
        v: 1,
        presets: [],
        packagesToInstall: { prod: 'x' },
        filesToWrite: [],
        envVars: [],
        nextSteps: [],
      })
    ).toThrowError(/packagesToInstall/);
  });
});
