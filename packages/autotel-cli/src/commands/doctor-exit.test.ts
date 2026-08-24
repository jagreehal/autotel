import { describe, expect, it } from 'vitest';
import { getExitCode } from './doctor';
import { captureCoverageChecks } from '../lib/capture-coverage';
import type { Check } from '../types/check';

const ok: Check = {
  id: 'a',
  title: 'a',
  level: 'info',
  status: 'ok',
  message: '',
};

describe('getExitCode', () => {
  it('still fails on a real warning or error', () => {
    expect(getExitCode([ok, { ...ok, id: 'b', status: 'warn' }])).toBe(1);
    expect(getExitCode([ok, { ...ok, id: 'c', status: 'error' }])).toBe(2);
  });

  it('does not fail on capture coverage alone', () => {
    // Every project has unobserved surfaces — file writes and IDE context are
    // unobservable by anything in the toolchain. Reporting a permanent fact of
    // the world must not break `autotel doctor` in CI.
    const checks = [ok, ...captureCoverageChecks({ autotel: '1' })];

    expect(checks.some((c) => c.status === 'warn')).toBe(true);
    expect(getExitCode(checks)).toBe(0);
  });

  it('still fails when a real warning sits alongside capture coverage', () => {
    const checks = [
      { ...ok, id: 'real', status: 'warn' as const },
      ...captureCoverageChecks({ autotel: '1' }),
    ];

    expect(getExitCode(checks)).toBe(1);
  });
});
