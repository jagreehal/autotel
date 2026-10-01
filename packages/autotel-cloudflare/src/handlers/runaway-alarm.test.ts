import { describe, it, expect, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  checkRunawayAlarm,
  instrumentDO,
  RUNAWAY_ALARM_EXCEPTION,
} from './durable-objects';

const doId = (name: string) =>
  ({ toString: () => `id-${name}`, name }) as unknown as DurableObjectId;

describe('checkRunawayAlarm', () => {
  it('fires once per window past maxRuns, then resets', () => {
    const id = doId('window');
    const config = { maxRuns: 3, windowMs: 1000 };
    const fired = (t: number) => checkRunawayAlarm(id, config, t);

    expect([fired(0), fired(100), fired(200)]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    const runaway = fired(300);
    expect(runaway?.name).toBe(RUNAWAY_ALARM_EXCEPTION);
    expect(runaway?.message).toBe(
      'Durable Object window alarm ran 4 times in 1s',
    );
    // Still looping in the same window: no second report.
    expect(fired(400)).toBeUndefined();
    expect(fired(900)).toBeUndefined();
    // A new window of looping reports again.
    expect([fired(1100), fired(1200)]).toEqual([undefined, undefined]);
    expect(fired(1300)?.name).toBe(RUNAWAY_ALARM_EXCEPTION);
  });

  it('does not fire for spaced-out alarms or when disabled', () => {
    const id = doId('calm');
    for (let t = 0; t < 20_000; t += 1000) {
      expect(checkRunawayAlarm(id, { maxRuns: 3, windowMs: 1000 }, t)).toBe(
        undefined,
      );
    }
    for (let t = 0; t < 50; t++) {
      expect(checkRunawayAlarm(doId('off'), false, t)).toBeUndefined();
    }
  });
});

describe('instrumentDO alarm (OTLP mode)', () => {
  it('records the runaway exception on the alarm span', async () => {
    const span = {
      recordException: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const getTracer = vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: (...args: any[]) => args.at(-1)(span),
    } as any);

    class Looping {
      constructor(_state: unknown, _env: unknown) {}
      async alarm() {}
    }
    const Instrumented = instrumentDO(Looping, {
      service: { name: 'do' },
      runawayAlarm: { maxRuns: 2 },
    });
    const instance = new Instrumented({ id: doId('otlp') } as any, {});
    for (let i = 0; i < 5; i++) await instance.alarm();

    const recorded = span.recordException.mock.calls.map(([e]) => e);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      name: RUNAWAY_ALARM_EXCEPTION,
      message: 'Durable Object otlp alarm ran 3 times in 60s',
    });
    getTracer.mockRestore();
  });
});
