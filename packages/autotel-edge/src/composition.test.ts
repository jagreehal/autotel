import { describe, it, expect, vi } from 'vitest';
import {
  composePostProcessors,
  composeSpanProcessors,
  composeSubscribers,
  defineConfig,
} from './composition';
import type { EdgeEvent, EdgeSubscriber, PostProcessorFn, ReadableSpan } from './types';

function makeSpan(name: string): ReadableSpan {
  return { name } as unknown as ReadableSpan;
}

describe('defineConfig', () => {
  it('returns its argument unchanged', () => {
    const config = defineConfig({
      service: { name: 'svc' },
      exporter: { url: 'https://otlp.example' },
    });
    expect(config.service.name).toBe('svc');
  });
});

describe('composeSubscribers', () => {
  it('runs subscribers in order', async () => {
    const calls: string[] = [];
    const a: EdgeSubscriber = () => {
      calls.push('a');
    };
    const b: EdgeSubscriber = () => {
      calls.push('b');
    };

    await composeSubscribers([a, b])({ kind: 'span.start' } as EdgeEvent);
    expect(calls).toEqual(['a', 'b']);
  });

  it('isolates errors so later subscribers still run', async () => {
    const calls: string[] = [];
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const a: EdgeSubscriber = () => {
      throw new Error('boom');
    };
    const b: EdgeSubscriber = () => {
      calls.push('b');
    };

    await composeSubscribers([a, b])({ kind: 'span.start' } as EdgeEvent);

    expect(calls).toEqual(['b']);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('composePostProcessors', () => {
  it('threads spans through each processor', () => {
    const tag: PostProcessorFn = (spans) =>
      spans.map((s) => ({ ...s, name: `${s.name}!` } as ReadableSpan));
    const drop: PostProcessorFn = (spans) => spans.filter((s) => s.name !== 'b!');

    const result = composePostProcessors([tag, drop])([
      makeSpan('a'),
      makeSpan('b'),
    ]);

    expect(result.map((s) => s.name)).toEqual(['a!']);
  });

  it('skips a failing processor and continues with the previous output', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok: PostProcessorFn = (spans) => spans;
    const broken: PostProcessorFn = () => {
      throw new Error('bad');
    };

    const result = composePostProcessors([ok, broken, ok])([makeSpan('keep')]);

    expect(result.map((s) => s.name)).toEqual(['keep']);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('composeSpanProcessors', () => {
  it('forwards onStart/onEnd to every processor', () => {
    const a = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      forceFlush: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const b = { ...a, onStart: vi.fn(), onEnd: vi.fn() };

    const composed = composeSpanProcessors([a as any, b as any]);
    composed.onStart({} as any, {} as any);
    composed.onEnd({} as any);

    expect(a.onStart).toHaveBeenCalled();
    expect(b.onStart).toHaveBeenCalled();
    expect(a.onEnd).toHaveBeenCalled();
    expect(b.onEnd).toHaveBeenCalled();
  });

  it('awaits all forceFlush results even when one rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const a = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      forceFlush: vi.fn().mockRejectedValue(new Error('flush fail')),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const b = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      forceFlush: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    const composed = composeSpanProcessors([a as any, b as any]);
    await composed.forceFlush!();

    expect(a.forceFlush).toHaveBeenCalled();
    expect(b.forceFlush).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
