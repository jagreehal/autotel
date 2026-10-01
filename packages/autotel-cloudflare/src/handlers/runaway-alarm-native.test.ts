import { describe, it, expect, vi } from 'vitest';

const nativeSpan = vi.hoisted(() => ({ recordException: vi.fn() }));
vi.mock('../native/native-tracing', () => ({
  platformNativeTracer: {
    enterSpan: (_name: string, fn: (s: unknown) => unknown) => fn(nativeSpan),
    getActiveSpan: () => nativeSpan,
  },
}));

import { instrumentDO, RUNAWAY_ALARM_EXCEPTION } from './durable-objects';

describe('instrumentDO alarm (native tracing mode)', () => {
  it('records on the native span and keeps the instance unproxied', async () => {
    class Looping {
      constructor(_state: unknown, _env: unknown) {}
      #runs = 0;
      async alarm() {
        this.#runs++;
        return this.#runs;
      }
    }
    const Instrumented = instrumentDO(Looping, {
      service: { name: 'do' },
      runawayAlarm: { maxRuns: 2 },
    });
    const id = { toString: () => 'native-id', name: '' };
    const instance = new Instrumented({ id } as any, {});

    expect(instance).toBeInstanceOf(Looping);
    let last = 0;
    for (let i = 0; i < 5; i++) last = await instance.alarm();

    expect(last).toBe(5); // private fields still work through the wrapper
    expect(nativeSpan.recordException).toHaveBeenCalledTimes(1);
    expect(nativeSpan.recordException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: RUNAWAY_ALARM_EXCEPTION,
        message: 'Durable Object native-id alarm ran 3 times in 60s',
      }),
    );
  });
});
