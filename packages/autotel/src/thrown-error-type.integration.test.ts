import { runInNewContext } from 'node:vm';
import { SpanStatusCode } from '@opentelemetry/api';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';
import { ctx } from './functional';
import { trace } from './trace-hybrid';
import { init } from './init';
import { instrument } from './functional';
import { silentLogger } from './init-logger';
import {
  AdaptiveSampler,
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_TAIL_KEEP,
  type Sampler,
} from './sampling';
import { createStructuredError } from './structured-error';

/**
 * A thrown error and one passed to ctx.recordError() must carry the same
 * `error.type`, so a backend groups them alike. Real `init()` pipeline: the
 * check for an `error.type` the function already set reads the SDK span.
 */
describe('error.type on an error thrown out of trace()', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    init({
      service: 'thrown-error-type-test',
      sampling: 'development',
      spanProcessor: new SimpleSpanProcessor({ exporter }),
    });
  });

  beforeEach(() => exporter.reset());

  const finishedSpan = async () => {
    await expect
      .poll(() => exporter.getFinishedSpans().length, { timeout: 1000 })
      .toBe(1);
    return exporter.getFinishedSpans()[0]!;
  };

  it('sets error.type to the error class', async () => {
    class LookupError extends Error {}
    const fn = trace('lookup', async () => {
      throw new LookupError('timed out');
    });

    await expect(fn()).rejects.toThrow('timed out');

    const span = await finishedSpan();
    expect(span.attributes['error.type']).toBe('LookupError');
  });

  it('keeps an error.type the function set before throwing', async () => {
    const fn = trace('lookup', async () => {
      ctx.setAttribute('error.type', 'timeout');
      throw new Error('timed out');
    });

    await expect(fn()).rejects.toThrow('timed out');

    const span = await finishedSpan();
    expect(span.attributes['error.type']).toBe('timeout');
  });

  it('gives a structured error the same error.type thrown or recorded', async () => {
    const make = () =>
      createStructuredError({
        message: 'card declined',
        why: 'insufficient funds',
      });

    await expect(
      trace('thrown', async () => {
        throw make();
      })(),
    ).rejects.toThrow('card declined');
    const thrown = await finishedSpan();
    exporter.reset();

    await trace('recorded', async () => {
      ctx.recordError(make());
    })();
    const recorded = await finishedSpan();

    expect(thrown.attributes['error.type']).toBe('StructuredError');
    expect(thrown.attributes['exception.type']).toBe('StructuredError');
    expect(recorded.attributes['error.type']).toBe(
      thrown.attributes['error.type'],
    );
  });

  it('gives a cross-realm error the same error.type thrown or recorded', async () => {
    // SAFETY: the evaluated source is a TypeError constructor call.
    const make = () => runInNewContext("new TypeError('bad input')") as Error;

    await expect(
      trace('thrown', async () => {
        throw make();
      })(),
    ).rejects.toThrow('bad input');
    const thrown = await finishedSpan();
    exporter.reset();

    await trace('recorded', async () => {
      ctx.recordError(make());
    })();
    const recorded = await finishedSpan();

    expect(thrown.attributes['error.type']).toBe('TypeError');
    expect(thrown.attributes['exception.message']).toBe('bad input');
    expect(thrown.attributes['exception.stack']).toContain('TypeError');
    expect(recorded.attributes['error.type']).toBe('TypeError');
  });

  const throwing = (): never => {
    throw new Error('getter blew up');
  };
  const withGetter = <T extends object>(target: T, key: PropertyKey): T =>
    Object.defineProperty(target, key, { get: throwing, configurable: true });

  // Each value reads as hostile from a different angle. Inspecting it must
  // never replace the failure, throw out of recordError(), or leave the span open.
  const hostile: Array<[string, () => object]> = [
    [
      'an Error whose name getter throws',
      () => withGetter(new Error('x'), 'name'),
    ],
    [
      'an Error whose message getter throws',
      () => withGetter(new Error('x'), 'message'),
    ],
    [
      'an Error whose stack getter throws',
      () => withGetter(new Error('x'), 'stack'),
    ],
    ['an object whose name getter throws', () => withGetter({}, 'name')],
    [
      'an object whose Symbol.toStringTag getter throws',
      () =>
        withGetter({ toString: () => 'still recordable' }, Symbol.toStringTag),
    ],
    ['an object whose toString throws', () => ({ toString: throwing })],
    [
      'a Proxy whose every trap throws',
      () =>
        new Proxy(
          {},
          {
            get: throwing,
            getPrototypeOf: throwing,
            has: throwing,
            ownKeys: throwing,
          },
        ),
    ],
  ];

  it.each(hostile)(
    'rethrows %s unchanged and ends the span',
    async (_, make) => {
      const original = make();

      await expect(
        trace('thrown', async () => {
          throw original;
        })(),
      ).rejects.toBe(original);

      const span = await finishedSpan();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    },
  );

  it.each(hostile)(
    'records %s as a failure, though the handler returns normally',
    async (_, make) => {
      await trace('recorded', async () => {
        ctx.recordError(make());
      })();

      const span = await finishedSpan();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.attributes['error.type']).toEqual(expect.any(String));
    },
  );

  it('records an object with a throwing Symbol.toStringTag by its toString', async () => {
    await trace('recorded', async () => {
      ctx.recordError(
        withGetter({ toString: () => 'still recordable' }, Symbol.toStringTag),
      );
    })();

    const span = await finishedSpan();
    expect(span.attributes['error.message']).toBe('still recordable');
  });

  const keepEverything: Sampler = {
    shouldSample: () => true,
    needsTailSampling: () => true,
    shouldKeepTrace: () => true,
  };

  it.each(['message', 'stack', 'name'])(
    'reaches a tail-sampling verdict when the error %s getter throws',
    async (field) => {
      const original = withGetter(new Error('x'), field);
      const fn = instrument({
        key: 'tail.sampled',
        fn: async () => {
          throw original;
        },
        sampler: keepEverything,
      });

      await expect(fn()).rejects.toBe(original);

      const span = await finishedSpan();
      expect(span.attributes[AUTOTEL_SAMPLING_TAIL_EVALUATED]).toBe(true);
      expect(span.attributes[AUTOTEL_SAMPLING_TAIL_KEEP]).toBe(true);
      expect(span.attributes['error.type']).toBe('Error');
    },
  );

  it.each(['message', 'stack', 'name'])(
    'AdaptiveSampler keeps an error whose %s getter throws',
    async (field) => {
      // Zero baseline with a logger: the error path logs the error's message.
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0,
        logger: silentLogger,
      });
      const original = withGetter(new Error('x'), field);
      const fn = instrument({
        key: 'adaptive.sampled',
        fn: async () => {
          throw original;
        },
        sampler,
      });

      await expect(fn()).rejects.toBe(original);

      const span = await finishedSpan();
      expect(span.attributes[AUTOTEL_SAMPLING_TAIL_EVALUATED]).toBe(true);
      expect(span.attributes[AUTOTEL_SAMPLING_TAIL_KEEP]).toBe(true);
    },
  );

  it('gives a plain object with a name the same error.type thrown or recorded', async () => {
    const make = () => ({ name: 'Timeout' });

    await expect(
      trace('thrown', async () => {
        throw make();
      })(),
    ).rejects.toEqual(make());
    const thrown = await finishedSpan();
    exporter.reset();

    await trace('recorded', async () => {
      ctx.recordError(make());
    })();
    const recorded = await finishedSpan();

    expect(thrown.attributes['error.type']).toBe('Timeout');
    expect(recorded.attributes['error.type']).toBe('Timeout');
  });

  it('hands a custom sampler the original error, class and code intact', async () => {
    class RetryableError extends Error {
      code = 'ECONNRESET';
    }
    const original = new RetryableError('reset');
    const received: Array<Error | undefined> = [];
    const keepRetryable: Sampler = {
      shouldSample: () => true,
      needsTailSampling: () => true,
      shouldKeepTrace: (_, result) => {
        received.push(result.error);
        return result.error instanceof RetryableError;
      },
    };
    const fn = instrument({
      key: 'custom.sampled',
      fn: async () => {
        throw original;
      },
      sampler: keepRetryable,
    });

    await expect(fn()).rejects.toBe(original);

    const span = await finishedSpan();
    expect(received).toEqual([original]);
    expect(received[0]).toBe(original);
    expect(span.attributes[AUTOTEL_SAMPLING_TAIL_KEEP]).toBe(true);
  });

  it('keeps the error code as the exception event type, as the SDK records it', async () => {
    const original = Object.assign(new Error('reset'), { code: 'ECONNRESET' });

    await expect(
      trace('coded', async () => {
        throw original;
      })(),
    ).rejects.toBe(original);

    const span = await finishedSpan();
    const event = span.events.find((e) => e.name === 'exception');
    expect(event?.attributes?.['exception.type']).toBe('ECONNRESET');
    expect(event?.attributes?.['exception.message']).toBe('reset');
  });

  it.each([0, false, null, ''])(
    'falls back to the name for a falsy code (%j), as the SDK does',
    async (code) => {
      class LookupError extends Error {}
      const original = Object.assign(new LookupError('x'), { code });

      await expect(
        trace('falsy-code', async () => {
          throw original;
        })(),
      ).rejects.toBe(original);

      const span = await finishedSpan();
      const event = span.events.find((e) => e.name === 'exception');
      expect(event?.attributes?.['exception.type']).toBe('LookupError');
    },
  );
});
