import { beforeEach, describe, expect, it, vi } from 'vitest';

const { traceSpy } = vi.hoisted(() => ({ traceSpy: vi.fn() }));

vi.mock('autotel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('autotel')>()),
  trace: traceSpy,
}));

import { defineFrameworkIntegration } from './integration';

describe('framework integration route filtering', () => {
  beforeEach(() => {
    traceSpy.mockReset();
  });

  it('does not create a trace for excluded routes', async () => {
    const integration = defineFrameworkIntegration<{ path: string }>({
      name: 'test',
      extractRequest: (ctx) => ({ method: 'GET', path: ctx.path }),
      attachLogger: vi.fn(),
    });
    const handler = vi.fn(async (handle) => {
      expect(handle.skipped).toBe(true);
      return 'ok';
    });

    await expect(
      integration.runTraced(
        { path: '/health' },
        { exclude: ['/health'] },
        handler,
      ),
    ).resolves.toBe('ok');
    expect(traceSpy).not.toHaveBeenCalled();
  });
});
