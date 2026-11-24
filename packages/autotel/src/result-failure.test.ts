import { SpanStatusCode } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { trace } from './functional';
import { createTraceCollector } from './testing';

describe('trace({ result: true })', () => {
  it('marks a returned err Result as failed with result: true', async () => {
    const collector = createTraceCollector();
    const run = async (
      name: string,
      value: { ok: boolean; value?: number; error?: Error | string },
      result = true,
    ) => {
      const returned = await trace({ name, result }, async () => value)();
      expect(returned).toBe(value);
      return collector.getSpansByName(name)[0]!;
    };

    class OrderRejected extends Error {
      readonly type = 'OrderRejected';
    }
    const tagged = await run('result.tagged', {
      ok: false,
      error: new OrderRejected('card declined'),
    });
    expect(tagged.status).toMatchObject({
      code: SpanStatusCode.ERROR,
      message: 'card declined',
    });
    expect(tagged.attributes).toMatchObject({
      'error.type': 'OrderRejected',
      'operation.success': false,
    });

    const text = await run('result.text', { ok: false, error: 'NOT_FOUND' });
    expect(text.attributes['error.type']).toBe('NOT_FOUND');

    const ok = await run('result.ok', { ok: true, value: 1 });
    expect(ok.status.code).toBe(SpanStatusCode.OK);
    const off = await run('result.off', { ok: false, error: 'x' }, false);
    expect(off.status.code).toBe(SpanStatusCode.OK);
  });

  it('keeps a status the function set over its err Result', async () => {
    const collector = createTraceCollector();
    await trace.run({ name: 'result.explicit', result: true }, async (c) => {
      c.setStatus({ code: SpanStatusCode.OK });
      return { ok: false, error: 'EXPECTED' };
    });
    const [span] = collector.getSpansByName('result.explicit');
    expect(span!.status.code).toBe(SpanStatusCode.OK);
    expect(span!.attributes['error.type']).toBeUndefined();
  });
});
