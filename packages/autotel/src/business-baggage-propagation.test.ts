/**
 * Schema writes through the real OpenTelemetry API and async context manager:
 * set() and clear() must change what the request reads and propagates.
 */
import {
  baggageEntryMetadataFromString,
  context,
  ROOT_CONTEXT,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CBaggagePropagator } from '@opentelemetry/core';
import { propagation } from '@opentelemetry/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BusinessBaggage,
  createSafeBaggageSchema,
  type BaggageError,
  type BaggageFieldValue,
} from './business-baggage';
import { getActiveTraceContext, trace } from './functional';
import {
  getActiveContextWithBaggage,
  type TraceContext,
} from './trace-context';

/** A `key=value` header pair, split at its first `=`. */
function splitPair(pair: string): [string, string] {
  const at = pair.indexOf('=');
  return [pair.slice(0, at), pair.slice(at + 1)];
}

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  propagation.setGlobalPropagator(new W3CBaggagePropagator());
});
afterAll(() => {
  context.disable();
  propagation.disable();
});

const Order = createSafeBaggageSchema(
  { orderId: { type: 'string' }, priority: { type: 'string' } },
  { prefix: 'order' },
);

describe('safe baggage schema writes', () => {
  it('set() is read back, seen by ctx and propagated', async () => {
    await trace.run('request', async (ctx) => {
      Order.set(ctx, { orderId: 'ord-1' });
      expect(Order.get(ctx)).toEqual({ orderId: 'ord-1' });
      expect(ctx.getBaggage('order.orderId')).toBe('ord-1');
      expect(Order.toHeaders(ctx).baggage).toContain('order.orderId=ord-1');
      await trace.run('child', async () => {
        expect(Order.getValue('orderId')).toBe('ord-1');
      });
    });
  });

  it('clear() removes only the schema keys', async () => {
    await trace.run('request', async (ctx) => {
      ctx.setBaggage('tenant', 't_1');
      Order.set(ctx, { orderId: 'ord-1', priority: 'high' });
      expect(Order.get(ctx)).toEqual({ orderId: 'ord-1', priority: 'high' });
      Order.clear(ctx);
      expect(Order.get(ctx)).toEqual({});
      expect(ctx.getBaggage('order.orderId')).toBeUndefined();
      const propagated = propagation.getBaggage(getActiveContextWithBaggage());
      expect(propagated?.getEntry('tenant')?.value).toBe('t_1');
    });
  });

  it('refuses a write outside a trace, so the next trace starts clean', async () => {
    const errors: BaggageError[] = [];
    const Leaky = createSafeBaggageSchema(
      { orderId: { type: 'string' } },
      { prefix: 'order', onError: (e) => errors.push(e) },
    );
    Leaky.set(undefined, { orderId: 'ord-leak' });
    Leaky.clear();
    expect(errors.map((e) => e.type)).toEqual(['no_trace', 'no_trace']);
    await trace.run('next request', async (ctx) => {
      expect(Leaky.get(ctx)).toEqual({});
      expect(Leaky.toHeaders(ctx).baggage).toBeUndefined();
    });
  });

  it('keeps a hashed identifier unchanged across a hop', async () => {
    const headers = await trace.run('sender', async (ctx) => {
      BusinessBaggage.set(ctx, { userId: 'user-123' });
      return BusinessBaggage.toHeaders(ctx);
    });
    const sent = await trace.run('sender', async (ctx) => {
      BusinessBaggage.set(ctx, { userId: 'user-123' });
      return BusinessBaggage.getValue('userId');
    });
    expect(sent).toMatch(/^h_/);
    await context.with(ROOT_CONTEXT, () =>
      trace.run('receiver', async (ctx) => {
        BusinessBaggage.fromHeaders(headers, ctx);
        expect(BusinessBaggage.getValue('userId')).toBe(sent);
      }),
    );
  });

  it('accepts a replacement that fits within the size limit', async () => {
    const Small = createSafeBaggageSchema(
      { key: { type: 'string' } },
      { maxTotalSize: 5 }, // `key=a`
    );
    await trace.run('request', async (ctx) => {
      Small.set(ctx, { key: 'a' });
      Small.set(ctx, { key: 'b' });
      expect(Small.getValue('key')).toBe('b');
    });
  });

  describe('every path a value takes', () => {
    const errors: BaggageError[] = [];
    const User = createSafeBaggageSchema(
      {
        userId: {
          type: 'string',
          hash: true,
          validate: (v) => String(v).startsWith('user-'),
        },
        tenant: { type: 'string', validate: (v) => String(v).startsWith('t_') },
        count: { type: 'number' },
        phone: { type: 'number', defaultValue: 0 },
      },
      { prefix: 'u', redactPII: true, onError: (e) => errors.push(e) },
    );
    const sent = (values: Parameters<typeof User.set>[1]) =>
      trace.run('sender', async (ctx) => {
        User.set(ctx, values);
        return User.toHeaders(ctx);
      });
    const received = (headers: Record<string, string>) =>
      context.with(ROOT_CONTEXT, () =>
        trace.run('receiver', async (ctx) => {
          User.fromHeaders(headers, ctx);
          return User.get(ctx);
        }),
      );

    it('keeps a validated, hashed id the same across hops', async () => {
      errors.length = 0;
      const first = await sent({ userId: 'user-123' });
      const hop1 = await received(first);
      expect(hop1.userId).toMatch(/^h_/);
      const second = await context.with(ROOT_CONTEXT, () =>
        trace.run('relay', async (ctx) => {
          User.fromHeaders(first, ctx);
          return User.toHeaders(ctx);
        }),
      );
      const hop2 = await received(second);
      expect(hop2.userId).toBe(hop1.userId);
      expect(errors).toEqual([]);
    });

    it('always hashes a direct write, even one that looks hashed', async () => {
      const Plain = createSafeBaggageSchema({
        id: { type: 'string', hash: true },
      });
      const stored = await trace.run('request', async (ctx) => {
        Plain.set(ctx, { id: 'h_deadbeef' });
        return Plain.getValue('id');
      });
      expect(stored).toMatch(/^h_/);
      expect(stored).not.toBe('h_deadbeef');
    });

    it('hashes a raw id a sender did not hash', async () => {
      const got = await received({ baggage: 'u.userId=user-9' });
      expect(got.userId).toMatch(/^h_/);
      expect(got.userId).not.toBe('user-9');
    });

    it('validates imported values that are not a hash', async () => {
      errors.length = 0;
      const got = await received({ baggage: 'u.tenant=x_1,u.count=abc' });
      expect(got.tenant).toBeUndefined();
      expect(got.count).toBeUndefined();
      expect(errors.map((e) => [e.key, e.type])).toEqual([
        ['tenant', 'validation'],
        ['count', 'validation'],
      ]);
    });

    it('reads a redacted number as its default, never NaN', async () => {
      const got = await trace.run('request', async (ctx) => {
        User.set(ctx, { phone: 5_551_234_567 });
        return User.get(ctx);
      });
      expect(got.phone).toBe(0);
    });

    it.each([
      [
        'hashHighCardinality',
        { hashHighCardinality: true },
        '0b6f8a2e-4c1d-4e5f-9a3b-7c8d9e0f1a2b',
        (v: BaggageFieldValue) => /^[\da-f-]{36}$/.test(String(v)),
      ],
      [
        'redactPII',
        { redactPII: true },
        'ada@example.com',
        (v: BaggageFieldValue) => String(v).includes('@'),
      ],
    ])(
      'keeps a value %s hashed the same across a hop',
      async (_, options, raw, validate) => {
        const errs: BaggageError[] = [];
        const Auto = createSafeBaggageSchema(
          { ref: { type: 'string', validate } },
          { ...options, onError: (e) => errs.push(e) },
        );
        const [headers, hashed] = await trace.run('sender', async (ctx) => {
          Auto.set(ctx, { ref: raw });
          return [Auto.toHeaders(ctx), Auto.getValue('ref')] as const;
        });
        expect(hashed).toMatch(/^h_/);
        const got = await context.with(ROOT_CONTEXT, () =>
          trace.run('receiver', async (ctx) => {
            Auto.fromHeaders(headers, ctx);
            return Auto.getValue('ref');
          }),
        );
        expect(got).toBe(hashed);
        expect(errs.filter((e) => e.type !== 'pii')).toEqual([]);
      },
    );

    it('imports nothing from headers without baggage', async () => {
      await trace.run('request', async (ctx) => {
        const scoped = propagation.setBaggage(
          context.active(),
          propagation.createBaggage({ 'u.tenant': { value: 't_scoped' } }),
        );
        await context.with(scoped, async () => {
          User.fromHeaders({}, ctx);
        });
        expect(User.get(ctx).tenant).toBeUndefined();
      });
    });
  });

  it.each([[{ a: 'www', b: 'x' }], [{ b: 'x', a: 'www' }]])(
    'applies a batch that fits whatever its key order (%o)',
    async (swap) => {
      const errs: BaggageError[] = [];
      const Tight = createSafeBaggageSchema(
        { a: { type: 'string' }, b: { type: 'string' } },
        { maxTotalSize: 9, onError: (e) => errs.push(e) }, // `a=x,b=www`
      );
      const got = await trace.run('request', async (ctx) => {
        Tight.set(ctx, { a: 'x', b: 'www' });
        Tight.set(ctx, swap);
        return Tight.get(ctx);
      });
      expect(got).toEqual({ a: 'www', b: 'x' });
      expect(errs).toEqual([]);
    },
  );

  it('counts the limit in header bytes, URI-encoded with separators', async () => {
    const errs: BaggageError[] = [];
    const Wire = createSafeBaggageSchema(
      { x: { type: 'string' }, y: { type: 'string' } },
      { maxTotalSize: 7, onError: (e) => errs.push(e) },
    );
    const got = await trace.run('request', async (ctx) => {
      Wire.set(ctx, { x: 'éé' }); // x=%C3%A9%C3%A9: 14 bytes
      Wire.set(ctx, { x: 'ab' }); // x=ab: 4
      Wire.set(ctx, { y: 'cd' }); // x=ab,y=cd: 9
      return [Wire.get(ctx), Wire.toHeaders(ctx).baggage] as const;
    });
    expect(got[0]).toEqual({ x: 'ab' });
    expect(got[1]!.length).toBeLessThanOrEqual(7);
    expect(errs.map((e) => e.key)).toEqual(['x', 'y']);
  });

  it('takes a shrinking batch even when the baggage arrived over the limit', async () => {
    const errs: BaggageError[] = [];
    const Tight = createSafeBaggageSchema(
      { a: { type: 'string' }, b: { type: 'string' } },
      // Arrives over the limit and stays over it: each write still shrinks it
      { maxTotalSize: 4, onError: (e) => errs.push(e) },
    );
    const inherited = propagation.setBaggage(
      ROOT_CONTEXT,
      propagation.createBaggage({ a: { value: 'xxx' }, b: { value: 'yyy' } }),
    );
    const got = await context.with(inherited, () =>
      trace.run('request', async (ctx) => {
        Tight.set(ctx, { a: 'x', b: 'x' });
        return Tight.get(ctx);
      }),
    );
    expect(got).toEqual({ a: 'x', b: 'x' });
    expect(errs).toEqual([]);
  });

  it('accepts a hash on import only where the schema could have made one', async () => {
    const errs: BaggageError[] = [];
    const Mixed = createSafeBaggageSchema(
      {
        priority: { type: 'enum', values: ['low', 'high'] },
        flag: { type: 'boolean' },
        ref: { type: 'string' },
        at: { type: 'number' },
      },
      {
        redactPII: true,
        hashHighCardinality: true,
        onError: (e) => errs.push(e),
      },
    );
    const header = await context.with(ROOT_CONTEXT, () =>
      trace.run('receiver', async (ctx) => {
        Mixed.fromHeaders(
          { baggage: 'priority=h_deadbeef,flag=h_1,ref=h_2,at=h_3' },
          ctx,
        );
        return Mixed.toHeaders(ctx).baggage;
      }),
    );
    expect(header?.split(',').toSorted()).toEqual(['at=h_3', 'ref=h_2']);
    expect(errs.map((e) => e.key)).toEqual(['priority', 'flag']);
  });

  describe('never throws from a write', () => {
    const errs: BaggageError[] = [];
    const Text = createSafeBaggageSchema(
      {
        one: { type: 'string', maxLength: 1 },
        two: { type: 'string', maxLength: 3 },
        free: { type: 'string' },
        checked: {
          type: 'string',
          validate: () => {
            throw new Error('validator failed');
          },
        },
      },
      { onError: (e) => errs.push(e) },
    );
    const write = (
      values: Parameters<typeof Text.set>[1],
      before?: () => void,
    ) =>
      trace.run('request', async (ctx) => {
        before?.();
        Text.set(ctx, values);
        return [Text.get(ctx), Text.toHeaders(ctx).baggage] as const;
      });

    it('truncates at a code point, dropping a value with none left', async () => {
      errs.length = 0;
      const [got] = await write({ one: '😀', two: '😀😀' });
      expect(got).toEqual({ two: '😀' });
      expect(errs.map((e) => [e.key, e.type])).toEqual([
        ['one', 'value_length'],
        ['two', 'value_length'],
      ]);
    });

    it('rejects a value that is not valid Unicode', async () => {
      errs.length = 0;
      const [got] = await write({ free: 'a\uD83D' });
      expect(got).toEqual({});
      expect(errs.map((e) => [e.key, e.type])).toEqual([
        ['free', 'validation'],
      ]);
    });

    it('still writes beside malformed baggage another writer set', async () => {
      const [got, header] = await write({ free: 'ok' }, () =>
        getActiveTraceContext()!.setBaggage('junk', '\uDC00'),
      );
      expect(got).toEqual({ free: 'ok' });
      // ctx's write stored U+FFFD, which the propagator can encode
      expect(header?.split(',').toSorted()).toEqual([
        'free=ok',
        'junk=%EF%BF%BD',
      ]);
    });

    it('treats a validator that throws as a failed validation', async () => {
      errs.length = 0;
      const [got] = await write({ checked: 'x' });
      expect(got).toEqual({});
      expect(errs.map((e) => [e.key, e.type])).toEqual([
        ['checked', 'validation'],
      ]);
    });

    it('rejects a schema whose names are not valid Unicode', () => {
      expect(() =>
        createSafeBaggageSchema({ ['k\uD800']: { type: 'string' } }),
      ).toThrow(/not valid Unicode/);
    });
  });

  describe('the header as the propagator sends it', () => {
    const inherit = (
      entries: Record<
        string,
        {
          value: string;
          metadata?: ReturnType<typeof baggageEntryMetadataFromString>;
        }
      >,
    ) =>
      propagation.setBaggage(ROOT_CONTEXT, propagation.createBaggage(entries));
    const run = <R>(
      entries: Parameters<typeof inherit>[0],
      fn: (ctx: TraceContext) => R,
    ) =>
      context.with(inherit(entries), () =>
        trace.run('request', async (ctx) => fn(ctx)),
      );

    it('counts the `;` of metadata that reads as empty', async () => {
      const errs: BaggageError[] = [];
      const S = createSafeBaggageSchema(
        { x: { type: 'string' } },
        { maxTotalSize: 7, onError: (e) => errs.push(e) },
      );
      const header = await run(
        { a: { value: 'b', metadata: baggageEntryMetadataFromString('') } },
        (ctx) => {
          S.set(ctx, { x: 'y' }); // a=b;,x=y: 8 bytes
          return S.toHeaders(ctx).baggage;
        },
      );
      expect(header).toBe('a=b;');
      expect(errs.map((e) => e.key)).toEqual(['x']);
    });

    it('rejects a pair the propagator would drop for its length', async () => {
      const errs: BaggageError[] = [];
      const S = createSafeBaggageSchema(
        { k: { type: 'string', maxLength: 5000 } },
        { maxTotalSize: 20_000, onError: (e) => errs.push(e) },
      );
      const got = await run({}, (ctx) => {
        S.set(ctx, { k: 'v'.repeat(4095) }); // k=…: 4097 bytes
        return S.get(ctx);
      });
      expect(got).toEqual({});
      expect(errs.map((e) => e.type)).toEqual(['size']);
    });

    it('holds a larger configured limit to the 8192 bytes the propagator sends', async () => {
      const errs: BaggageError[] = [];
      const S = createSafeBaggageSchema(
        {
          a: { type: 'string', maxLength: 3000 },
          b: { type: 'string', maxLength: 3000 },
          c: { type: 'string', maxLength: 3000 },
        },
        { maxTotalSize: 12_000, onError: (e) => errs.push(e) },
      );
      const v = 'v'.repeat(3000);
      const [got, header] = await run({}, (ctx) => {
        S.set(ctx, { a: v, b: v, c: v });
        return [S.get(ctx), S.toHeaders(ctx).baggage] as const;
      });
      expect(Object.keys(got)).toEqual(['a', 'b']);
      expect(header!.length).toBeLessThanOrEqual(8192);
      expect(header).toContain(`b=${v}`);
      expect(errs.map((e) => e.key)).toEqual(['c']);
    });

    it('takes a shrinking write only once the propagator would send it', async () => {
      const errs: BaggageError[] = [];
      const S = createSafeBaggageSchema(
        { c: { type: 'string', maxLength: 5000 } },
        { onError: (e) => errs.push(e) },
      );
      const big = 'v'.repeat(4088); // `x=` + 4088: a 4090-byte pair
      const inherited = {
        a: { value: big },
        b: { value: big },
        c: { value: big },
      };
      const [still, fits] = await run(inherited, (ctx) => {
        S.set(ctx, { c: 'v'.repeat(4000) }); // smaller, still left out
        const first = S.getValue('c');
        S.set(ctx, { c: 'x' }); // a=…,b=…,c=x: 8185 bytes, sent
        return [first, S.getValue('c')];
      });
      expect(still).toBe(big);
      expect(fits).toBe('x');
      expect(errs.map((e) => e.key)).toEqual(['c']);
    });

    // Against the real propagator, not a model of it: whatever the schema
    // accepts must be in the header OpenTelemetry sends.
    it('only accepts writes the propagator sends (200 seeded scenarios)', async () => {
      let seed = 42;
      const rand = (n: number) => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return Math.floor((seed / 2_147_483_648) * n); // high bits: the low ones cycle
      };
      const fields = Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          `f${i}`,
          { type: 'string' as const, maxLength: 5000 },
        ]),
      );
      for (let round = 0; round < 200; round++) {
        const S = createSafeBaggageSchema(fields, {
          maxTotalSize: [500, 8192, 20_000][rand(3)]!,
          onError: () => {},
        });
        const inherited = Object.fromEntries(
          Array.from({ length: rand(200) }, (_, i) => [
            rand(4) === 0 ? `f${rand(6)}` : `i${i}`,
            { value: 'v'.repeat(1 + rand(rand(4) === 0 ? 4500 : 60)) },
          ]),
        );
        const writes = Object.fromEntries(
          Array.from({ length: 1 + rand(6) }, () => [
            `f${rand(6)}`,
            'w'.repeat(1 + rand(rand(3) === 0 ? 4500 : 40)),
          ]),
        );
        const [accepted, header, headerBefore] = await run(inherited, (ctx) => {
          const before = S.toHeaders(ctx).baggage ?? '';
          S.set(ctx, writes);
          const got = S.get(ctx);
          const kept = Object.keys(writes).filter((k) => got[k] === writes[k]);
          return [kept, S.toHeaders(ctx).baggage ?? '', before] as const;
        });
        const sent = new Map(
          header
            .split(',')
            .filter(Boolean)
            .map((pair) => splitPair(pair)),
        );
        for (const key of accepted) expect(sent.get(key)).toBe(writes[key]);
        for (const pair of headerBefore.split(',').filter(Boolean)) {
          const key = pair.split('=')[0]!;
          if (!accepted.includes(key)) expect(sent.has(key)).toBe(true);
        }
        expect(header.length).toBeLessThanOrEqual(8192);
      }
    }, 30_000);

    describe('judges a batch on its final header', () => {
      const v = (n: number) => 'v'.repeat(n);
      const sentPairs = (header: string | undefined) =>
        new Map(
          (header ?? '')
            .split(',')
            .filter(Boolean)
            .map((pair) => splitPair(pair)),
        );
      const batch = (
        inherited: Record<string, { value: string }>,
        writes: Record<string, string>,
      ) => {
        const errs: BaggageError[] = [];
        const S = createSafeBaggageSchema(
          Object.fromEntries(
            ['a', 'b', 'c', 'x'].map((k) => [
              k,
              { type: 'string' as const, maxLength: 5000 },
            ]),
          ),
          { onError: (e) => errs.push(e) },
        );
        return run(inherited, (ctx) => {
          S.set(ctx, writes);
          const got = S.get(ctx);
          const header = S.toHeaders(ctx).baggage;
          return { got, sent: sentPairs(header), errs };
        });
      };

      it('never accepts a write a later shrink pushes out', async () => {
        // a arrives too long to send. Shrinking it makes it eligible, and
        // then the shrunk c no longer fits: keep c, give up a.
        const { got, sent, errs } = await batch(
          {
            a: { value: v(4500) },
            b: { value: v(3000) },
            c: { value: v(3000) },
          },
          { c: v(2500), a: v(3500) },
        );
        expect(got.c).toBe(v(2500));
        expect(sent.get('c')).toBe(v(2500));
        expect(got.a).toBe(v(4500));
        expect(errs.map((e) => e.key)).toEqual(['a']);
      });

      it('keeps 12 small writes over a shrink that would displace baggage', async () => {
        const errs: BaggageError[] = [];
        const keys = Array.from({ length: 12 }, (_, i) => `t${i}`);
        const S = createSafeBaggageSchema(
          Object.fromEntries(
            ['a', ...keys].map((k) => [
              k,
              { type: 'string' as const, maxLength: 5000 },
            ]),
          ),
          { onError: (e) => errs.push(e) },
        );
        const got = await run(
          {
            a: { value: v(5000) },
            x1: { value: v(4000) },
            x2: { value: v(4000) },
          },
          (ctx) => {
            S.set(ctx, {
              a: v(3900),
              ...Object.fromEntries(keys.map((k) => [k, 'x'])),
            });
            return S.get(ctx);
          },
        );
        expect(keys.every((k) => got[k] === 'x')).toBe(true);
        expect(errs.map((e) => e.key)).toEqual(['a']);
      });

      it('rejects a replacement too long to send without costing the rest', async () => {
        const { got, sent, errs } = await batch(
          { a: { value: v(5000) } },
          { a: v(4500), b: 'x' },
        );
        expect(got.b).toBe('x');
        expect(sent.get('b')).toBe('x');
        expect(errs.map((e) => e.key)).toEqual(['a']);
      });

      it('accepts a write that fits once a later write shrinks', async () => {
        const { got, sent, errs } = await batch(
          { a: { value: v(3000) }, b: { value: v(3000) } },
          { c: 'w'.repeat(2500), a: 'x' },
        );
        expect([got.a, got.c]).toEqual(['x', 'w'.repeat(2500)]);
        expect(sent.get('c')).toBe('w'.repeat(2500));
        expect(errs).toEqual([]);
      });

      it('never pushes out baggage another writer set', async () => {
        // x arrives too long to send while y and z are sent; shrinking x
        // would make it eligible and push z out.
        const { got, sent, errs } = await batch(
          {
            x: { value: v(4500) },
            y: { value: v(3000) },
            z: { value: v(3000) },
          },
          { x: v(3000) },
        );
        expect(got.x).toBe(v(4500));
        expect([...sent.keys()]).toEqual(['y', 'z']);
        expect(errs.map((e) => e.key)).toEqual(['x']);
      });
    });

    it('rejects an entry past the 180 the propagator sends', async () => {
      const errs: BaggageError[] = [];
      const S = createSafeBaggageSchema(
        { e0: { type: 'string' }, extra: { type: 'string' } },
        { maxTotalSize: 20_000, onError: (e) => errs.push(e) },
      );
      const full = Object.fromEntries(
        Array.from({ length: 180 }, (_, i) => [`e${i}`, { value: 'v' }]),
      );
      const got = await run(full, (ctx) => {
        S.set(ctx, { e0: 'w', extra: 'x' });
        return S.get(ctx);
      });
      expect(got).toEqual({ e0: 'w' });
      expect(errs.map((e) => e.key)).toEqual(['extra']);
    });
  });
});
