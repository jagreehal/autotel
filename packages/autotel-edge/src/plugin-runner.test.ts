import { describe, expect, it, vi } from 'vitest';
import { createPluginRunner, definePlugin, getEmptyPluginRunner } from './plugin-runner';

describe('plugin-runner', () => {
  it('de-duplicates plugins by name, last wins', async () => {
    const seen: string[] = [];
    const runner = createPluginRunner([
      definePlugin({
        name: 'same',
        setup: async () => {
          seen.push('first');
        },
      }),
      definePlugin({
        name: 'same',
        setup: async () => {
          seen.push('second');
        },
      }),
    ]);

    await runner.runSetup({});
    expect(seen).toEqual(['second']);
  });

  it('isolates hook failures and continues running plugins', async () => {
    const logger = { error: vi.fn() };
    const calls: string[] = [];
    const runner = createPluginRunner(
      [
        definePlugin({
          name: 'broken',
          enrich: async () => {
            throw new Error('boom');
          },
        }),
        definePlugin({
          name: 'healthy',
          enrich: async () => {
            calls.push('healthy');
          },
        }),
      ],
      { logger },
    );

    await runner.runEnrich({});
    expect(calls).toEqual(['healthy']);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('runs drain hooks concurrently', async () => {
    const order: string[] = [];
    const runner = createPluginRunner([
      definePlugin({
        name: 'slow',
        drain: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push('slow');
        },
      }),
      definePlugin({
        name: 'fast',
        drain: async () => {
          order.push('fast');
        },
      }),
    ]);

    await runner.runDrain({});
    expect(order).toContain('fast');
    expect(order).toContain('slow');
  });

  it('tracks capability flags', () => {
    const runner = createPluginRunner([
      definePlugin({ name: 'base' }),
      definePlugin({ name: 'ext', extendLogger: () => {} }),
      definePlugin({ name: 'req', onRequestStart: () => {} }),
      definePlugin({ name: 'client', onClientLog: () => {} }),
      definePlugin({ name: 'keep', keep: async () => {} }),
      definePlugin({ name: 'enrich', enrich: async () => {} }),
      definePlugin({ name: 'drain', drain: async () => {} }),
    ]);

    expect(runner.hasExtendLogger).toBe(true);
    expect(runner.hasRequestLifecycle).toBe(true);
    expect(runner.hasClientLog).toBe(true);
    expect(runner.hasKeep).toBe(true);
    expect(runner.hasEnrich).toBe(true);
    expect(runner.hasDrain).toBe(true);
  });

  it('returns a stable empty runner', () => {
    const a = getEmptyPluginRunner();
    const b = getEmptyPluginRunner();
    expect(a).toBe(b);
    expect(a.plugins).toHaveLength(0);
  });
});
