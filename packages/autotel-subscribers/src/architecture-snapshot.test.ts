import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { EventAttributes } from 'autotel/event-subscriber';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { init, shutdown, trace } from 'autotel';
import { traceStep, traceWorkflow } from 'autotel/workflow';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArchitectureSnapshotSubscriber,
  extractFieldPaths,
  ARCHITECTURE_SNAPSHOT_SPEC,
} from './architecture-snapshot';
import type { EventPayload } from './event-subscriber-base';

const FIXED_NOW = () => new Date('2026-05-21T18:04:00.000Z');

function event(
  name: string,
  attributes: EventAttributes = {},
  options: { traceId?: string; at?: string } = {},
): EventPayload {
  return {
    type: 'event',
    name,
    attributes,
    timestamp: options.at ?? '2026-05-21T18:00:00.000Z',
    autotel: options.traceId
      ? { trace_id: options.traceId, correlation_id: 'corr-1' }
      : undefined,
  };
}

describe('extractFieldPaths', () => {
  it('collapses array items under `[]`', () => {
    expect(
      extractFieldPaths({
        items: [{ sku: 'a', quantity: 1 }, { sku: 'b' }],
      }),
    ).toEqual(['items', 'items[].quantity', 'items[].sku']);
  });

  it('returns empty for primitives at the root', () => {
    expect(extractFieldPaths('x')).toEqual([]);
    expect(extractFieldPaths(42)).toEqual([]);
    expect(extractFieldPaths(null)).toEqual([]);
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(extractFieldPaths(undefined)).toEqual([]);
  });

  it('handles nested objects', () => {
    expect(extractFieldPaths({ a: { b: { c: 1 } } })).toEqual([
      'a',
      'a.b',
      'a.b.c',
    ]);
  });
});

describe('ArchitectureSnapshotSubscriber', () => {
  let sub: ArchitectureSnapshotSubscriber;

  beforeEach(() => {
    sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
  });

  it('records a new event on first observation', async () => {
    await sub.trackEvent('order.placed', {
      orderId: 'o-1',
      items: [{ sku: 'sku-1', quantity: 2 }],
    });

    const snap = sub.toSnapshot({ now: FIXED_NOW });
    expect(snap.spec).toBe(ARCHITECTURE_SNAPSHOT_SPEC);
    expect(snap.service).toBe('orders');
    expect(snap.events['order.placed']).toMatchObject({
      name: 'order.placed',
      observedCount: 1,
      fieldPaths: ['items', 'items[].quantity', 'items[].sku', 'orderId'],
      fieldStats: {
        orderId: { types: ['string'], sampleValues: ['o-1'] },
        items: { types: ['array'], sampleValues: [] },
        'items[].sku': { types: ['string'], sampleValues: ['sku-1'] },
        'items[].quantity': { types: ['number'], sampleValues: [2] },
      },
    });
  });

  /**
   * `producer` and `channel` are first-write-wins and `observedCount` is an
   * event-level total, so two services publishing the same event name collapse
   * into one. Anything attributing a count to a specific relationship has to
   * read `sources`, or it credits the second producer's traffic to the first.
   */
  it('keeps a per-relationship count when two producers share an event name', async () => {
    await sub.trackEvent('order.placed', {
      orderId: 'o-1',
      _autotel: { producer: 'ServiceA', channel: 'topic-a' },
    });
    await sub.trackEvent('order.placed', {
      orderId: 'o-2',
      _autotel: { producer: 'ServiceB', channel: 'topic-b' },
    });

    const observation = sub.toSnapshot({ now: FIXED_NOW }).events[
      'order.placed'
    ];

    // The flat fields still answer first-wins, unchanged.
    expect(observation?.observedCount).toBe(2);
    expect(observation?.producer).toBe('ServiceA');

    // ...and the second producer is no longer invisible.
    expect(observation?.sources).toEqual([
      expect.objectContaining({
        producer: 'ServiceA',
        channel: 'topic-a',
        count: 1,
      }),
      expect.objectContaining({
        producer: 'ServiceB',
        channel: 'topic-b',
        count: 1,
      }),
    ]);
  });

  /**
   * Both fields come from caller metadata and may contain any character, so a
   * joined key is ambiguous: ('A|B', 'C') and ('A', 'B|C') collapse into one.
   */
  it('keeps pairs distinct when a name contains the separator character', async () => {
    await sub.trackEvent('e', { _autotel: { producer: 'A|B', channel: 'C' } });
    await sub.trackEvent('e', { _autotel: { producer: 'A', channel: 'B|C' } });

    const sources = sub.toSnapshot({ now: FIXED_NOW }).events['e']?.sources;
    expect(sources).toHaveLength(2);
    expect(sources?.every((source) => source.count === 1)).toBe(true);
  });

  it('accumulates a repeated relationship into one source entry', async () => {
    for (const orderId of ['o-1', 'o-2', 'o-3']) {
      await sub.trackEvent('order.placed', {
        orderId,
        _autotel: { producer: 'ServiceA', channel: 'topic-a' },
      });
    }

    const sources = sub.toSnapshot({ now: FIXED_NOW }).events['order.placed']
      ?.sources;
    expect(sources).toHaveLength(1);
    expect(sources?.[0]?.count).toBe(3);
  });

  it('freezes and sorts sources so a committed snapshot is byte-stable', async () => {
    await sub.trackEvent('e', { _autotel: { producer: 'Z', channel: 'z' } });
    await sub.trackEvent('e', { _autotel: { producer: 'A', channel: 'a' } });

    const snap = sub.toSnapshot({
      freezeTimestamps: '2026-01-01T00:00:00.000Z',
    });
    const sources = snap.events['e']?.sources ?? [];
    expect(sources.map((source) => source.producer)).toEqual(['A', 'Z']);
    expect(
      sources.every((s) => s.firstSeen === '2026-01-01T00:00:00.000Z'),
    ).toBe(true);
  });

  it('accumulates count, lastSeen, and merges field paths across calls', async () => {
    await sub.trackEvent('order.placed', { orderId: 'o-1' });
    // Second call adds a new field path.
    await sub.trackEvent('order.placed', {
      orderId: 'o-2',
      shipping: { addressId: 'addr_1' },
    });

    const obs = sub.toSnapshot({ now: FIXED_NOW }).events['order.placed'];
    expect(obs.observedCount).toBe(2);
    expect(obs.fieldPaths).toEqual([
      'orderId',
      'shipping',
      'shipping.addressId',
    ]);
  });

  it('reads channel and producer from the _autotel namespace', async () => {
    await sub.trackEvent('order.placed', {
      orderId: 'o-1',
      _autotel: {
        channel: 'orders.events',
        producer: 'OrdersService',
        consumers: ['PaymentService'],
      },
    });

    const obs = sub.toSnapshot({ now: FIXED_NOW }).events['order.placed'];
    expect(obs.channel).toBe('orders.events');
    expect(obs.producer).toBe('OrdersService');
    expect(obs.consumers).toEqual(['PaymentService']);
    // _autotel must not leak into the captured field paths.
    expect(obs.fieldPaths).toEqual(['orderId']);
  });

  it('captures schema metadata passed at track() call sites', async () => {
    await sub.trackEvent(
      'order.placed',
      { orderId: 'o-1' },
      {
        schema: {
          source: 'zod',
          jsonSchema: {
            type: 'object',
            properties: { orderId: { type: 'string' } },
            required: ['orderId'],
          },
          hash: 'abc123',
        },
      },
    );

    const obs = sub.toSnapshot({ now: FIXED_NOW }).events['order.placed'];
    expect(obs.schema).toEqual({
      source: 'zod',
      jsonSchema: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
      hash: 'abc123',
    });
  });

  it('collects up to maxSampleTraceIds distinct trace ids', async () => {
    const limited = new ArchitectureSnapshotSubscriber({
      service: 'orders',
      maxSampleTraceIds: 2,
    });
    for (const id of ['t-1', 't-2', 't-3', 't-1']) {
      await // SAFETY: the snapshot is read back for the fields the assertions below
      // name; the subscriber's own type describes far more of it.
      (
        limited as unknown as {
          sendToDestination(p: EventPayload): Promise<void>;
        }
      ).sendToDestination(event('order.placed', {}, { traceId: id }));
    }
    const obs = limited.toSnapshot({ now: FIXED_NOW }).events['order.placed'];
    expect(obs.sampleTraceIds).toEqual(['t-1', 't-2']);
  });

  it('ignores non-event payload types', async () => {
    await sub.trackEvent('order.placed', { orderId: 'o-1' });
    await sub.trackOutcome('checkout', 'success');
    await sub.trackValue('revenue', 99);

    const snap = sub.toSnapshot({ now: FIXED_NOW });
    expect(Object.keys(snap.events)).toEqual(['order.placed']);
  });

  it('produces deterministic output for identical inputs', async () => {
    // Freeze the clock so the firstSeen/lastSeen timestamps assigned to
    // subscriber `b`'s events match subscriber `a`'s exactly. Without this
    // the two subscribers can land in different ms ticks and the byte-for-
    // byte JSON comparison flakes in CI.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T18:00:00.000Z'));
    try {
      const a = new ArchitectureSnapshotSubscriber({ service: 'orders' });
      const b = new ArchitectureSnapshotSubscriber({ service: 'orders' });
      const payload = { orderId: 'o-1', items: [{ sku: 'a' }, { sku: 'b' }] };

      await a.trackEvent('order.placed', payload);
      await a.trackEvent('payment.captured', { orderId: 'o-1' });
      // Same events, reversed order.
      await b.trackEvent('payment.captured', { orderId: 'o-1' });
      await b.trackEvent('order.placed', payload);

      const at = () => new Date('2026-05-21T18:04:00.000Z');
      expect(JSON.stringify(a.toSnapshot({ now: at }))).toBe(
        JSON.stringify(b.toSnapshot({ now: at })),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('writeToFile creates parent dirs and writes JSON with trailing newline', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'autotel-arch-snap-'));
    try {
      const target = path.join(dir, 'nested', 'snap.json');
      const fresh = new ArchitectureSnapshotSubscriber({ service: 'orders' });
      await fresh.trackEvent('order.placed', { orderId: 'o-1' });
      await fresh.writeToFile(target, { now: FIXED_NOW });

      const body = await readFile(target, 'utf8');
      expect(body.endsWith('\n')).toBe(true);
      expect(JSON.parse(body)).toMatchObject({
        spec: ARCHITECTURE_SNAPSHOT_SPEC,
        service: 'orders',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reset() clears all accumulated observations', async () => {
    await sub.trackEvent('order.placed', { orderId: 'o-1' });
    sub.reset();
    expect(sub.toSnapshot({ now: FIXED_NOW }).events).toEqual({});
  });
});

describe('ArchitectureSnapshotSubscriber consumer measurement', () => {
  const consumerSpan = (
    link: { traceId: string; spanId: string },
    consumer: string,
    channel = 'orders.events',
    kind = 4,
  ) => ({
    kind,
    attributes: {
      'messaging.destination.name': channel,
      'messaging.consumer.group.name': consumer,
    },
    links: [{ context: link }],
    endTime: [1_779_386_400, 0] as [number, number],
  });

  const send = (sub: ArchitectureSnapshotSubscriber, payload: EventPayload) =>
    // SAFETY: sendToDestination is protected; the test drives it directly so
    // the payload carries trace context, which trackEvent cannot supply.
    (
      sub as unknown as { sendToDestination(p: EventPayload): Promise<void> }
    ).sendToDestination(payload);

  /** An event tracked inside producer span `spanId` of trace `traceId`. */
  const tracked = (
    name: string,
    link: { traceId: string; spanId: string },
    channel = 'orders.events',
  ): EventPayload => ({
    ...event(name, { _autotel: { channel, producer: 'OrdersService' } }),
    autotel: {
      trace_id: link.traceId,
      span_id: link.spanId,
      correlation_id: 'c',
    },
  });

  const P1 = { traceId: 't-1', spanId: 's-1' };
  const P2 = { traceId: 't-2', spanId: 's-2' };

  it('credits a consumer whichever side of the join arrives first', async () => {
    const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
    const processor = sub.spanProcessor;

    await send(sub, tracked('order.placed', P1));
    processor.onEnd(consumerSpan(P1, 'PaymentService'));

    processor.onEnd(consumerSpan(P2, 'PaymentService'));
    await send(sub, tracked('order.placed', P2));

    const snap = sub.toSnapshot({ now: FIXED_NOW });
    expect(snap.consumersMeasured).toBe(true);
    expect(snap.events['order.placed'].observedConsumers).toEqual([
      {
        consumer: 'PaymentService',
        channel: 'orders.events',
        count: 2,
        firstSeen: '2026-05-21T18:00:00.000Z',
        lastSeen: '2026-05-21T18:00:00.000Z',
      },
    ]);
  });

  /** Two messages on one channel in one trace are two producer spans. */
  it('credits only the message the consumer linked to', async () => {
    const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
    const processor = sub.spanProcessor;
    await send(sub, tracked('order.placed', { traceId: 't-1', spanId: 'a' }));
    await send(sub, tracked('order.updated', { traceId: 't-1', spanId: 'b' }));

    processor.onEnd(
      consumerSpan({ traceId: 't-1', spanId: 'a' }, 'PaymentService'),
    );

    const snap = sub.toSnapshot({ now: FIXED_NOW });
    expect(snap.events['order.placed'].observedConsumers?.[0]?.count).toBe(1);
    expect(snap.events['order.updated'].observedConsumers).toBeUndefined();
  });

  it('joins on the destination template when the span has one', async () => {
    const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
    await send(sub, tracked('order.placed', P1));
    const span = consumerSpan(P1, 'PaymentService', 'orders.events-run-42');
    sub.spanProcessor.onEnd({
      ...span,
      attributes: {
        ...span.attributes,
        'messaging.destination.template': 'orders.events',
      },
    });

    const snap = sub.toSnapshot({ now: FIXED_NOW });
    expect(snap.events['order.placed'].observedConsumers?.[0]).toMatchObject({
      consumer: 'PaymentService',
      channel: 'orders.events',
    });
  });

  it('ignores other channels, other spans and non-consumer spans', async () => {
    const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
    const processor = sub.spanProcessor;
    await send(sub, tracked('order.placed', P1));

    processor.onEnd(consumerSpan(P1, 'Audit', 'payments.events'));
    processor.onEnd(consumerSpan({ traceId: 't-1', spanId: 'x' }, 'Audit'));
    processor.onEnd(consumerSpan(P1, 'Audit', 'orders.events', 3));

    const snap = sub.toSnapshot({ now: FIXED_NOW });
    expect(snap.events['order.placed'].observedConsumers).toBeUndefined();
  });

  it('bounds what one producer span can buffer', async () => {
    const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
    const processor = sub.spanProcessor;
    for (let i = 0; i < 100; i++) {
      processor.onEnd(consumerSpan(P1, 'PaymentService'));
    }
    await send(sub, tracked('order.placed', P1));

    const snap = sub.toSnapshot({ now: FIXED_NOW });
    expect(snap.events['order.placed'].observedConsumers?.[0]?.count).toBe(16);
  });

  it('reports each measured receipt to onConsumerObserved', async () => {
    const seen: unknown[] = [];
    const sub = new ArchitectureSnapshotSubscriber({
      service: 'orders',
      onConsumerObserved: (receipt) => seen.push(receipt),
    });
    await send(sub, tracked('order.placed', P1));
    sub.spanProcessor.onEnd(consumerSpan(P1, 'PaymentService'));

    expect(seen).toEqual([
      {
        event: 'order.placed',
        consumer: 'PaymentService',
        channel: 'orders.events',
        at: '2026-05-21T18:00:00.000Z',
      },
    ]);
  });

  it('keeps a throwing onConsumerObserved out of span.end()', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sub = new ArchitectureSnapshotSubscriber({
      service: 'orders',
      onConsumerObserved: () => {
        throw new Error('sse writer closed');
      },
    });
    await send(sub, tracked('order.placed', P1));

    expect(() =>
      sub.spanProcessor.onEnd(consumerSpan(P1, 'PaymentService')),
    ).not.toThrow();
    // The receipt is still recorded; only the notification failed.
    const snap = sub.toSnapshot({ now: FIXED_NOW });
    expect(snap.events['order.placed'].observedConsumers?.[0]?.count).toBe(1);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('keeps a malformed consumer span out of span.end()', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
    const span = {
      ...consumerSpan(P1, 'PaymentService'),
      endTime: [Number.NaN, 0] as [number, number],
    };

    expect(() => sub.spanProcessor.onEnd(span)).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  /** A consumer span that recorded `attributes` and ended with `code`. */
  const outcomeSpan = (
    link: { traceId: string; spanId: string },
    attributes: Record<string, string | number | boolean>,
    code = 1,
  ) => {
    const span = consumerSpan(link, 'PaymentService');
    return {
      ...span,
      attributes: { ...span.attributes, ...attributes },
      status: { code },
    };
  };

  it('records what happened to each delivery', async () => {
    const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
    const processor = sub.spanProcessor;
    const P3 = { traceId: 't-3', spanId: 's-3' };
    const P4 = { traceId: 't-4', spanId: 's-4' };
    await send(sub, tracked('order.placed', P1));
    await send(sub, tracked('order.placed', P2));

    processor.onEnd(outcomeSpan(P1, { 'messaging.retry.count': 1 }, 2));
    processor.onEnd(outcomeSpan(P1, { 'messaging.retry.count': 2 }, 2));
    const timeout = {
      'messaging.dlq.reason': 'Payment gateway timeout',
      'messaging.dlq.reason_category': 'timeout',
      'messaging.dlq.name': 'orders-dlq',
    };
    processor.onEnd(outcomeSpan(P1, timeout, 2));
    processor.onEnd(
      outcomeSpan(P2, { 'messaging.dlq.reason': 'x'.repeat(300) }, 2),
    );
    // Receipts that arrive before their event carry the outcome with them.
    processor.onEnd(outcomeSpan(P3, { 'messaging.replay': true }));
    processor.onEnd(outcomeSpan(P4, timeout));
    await send(sub, tracked('order.placed', P3));
    await send(sub, tracked('order.placed', P4));

    const [entry] = sub.toSnapshot({ now: FIXED_NOW }).events['order.placed']
      .observedConsumers!;
    expect(entry).toEqual({
      consumer: 'PaymentService',
      channel: 'orders.events',
      count: 6,
      firstSeen: '2026-05-21T18:00:00.000Z',
      lastSeen: '2026-05-21T18:00:00.000Z',
      failed: 4,
      retried: 2,
      deadLettered: 3,
      replayed: 1,
      deadLetterReasons: [
        {
          reason: 'Payment gateway timeout',
          category: 'timeout',
          queue: 'orders-dlq',
          count: 2,
        },
        { reason: 'x'.repeat(200), count: 1 },
      ],
    });
  });

  it('writes no outcome keys when every delivery succeeds', async () => {
    const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
    await send(sub, tracked('order.placed', P1));
    sub.spanProcessor.onEnd(outcomeSpan(P1, {}));

    const [entry] = sub.toSnapshot({ now: FIXED_NOW }).events['order.placed']
      .observedConsumers!;
    expect(Object.keys(entry)).toEqual([
      'consumer',
      'channel',
      'count',
      'firstSeen',
      'lastSeen',
    ]);
  });

  it('marks a snapshot unmeasured when no span processor was taken', async () => {
    const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
    await send(sub, tracked('order.placed', P1));
    expect(
      sub.toSnapshot({ now: FIXED_NOW }).consumersMeasured,
    ).toBeUndefined();
  });
});

describe('ArchitectureSnapshotSubscriber workflow measurement', () => {
  const sub = new ArchitectureSnapshotSubscriber({ service: 'orders' });
  init({ service: 'orders', spanProcessors: [sub.spanProcessor] });
  afterAll(() => shutdown());
  beforeEach(() => sub.reset());

  const step = (name: string, fail = false) =>
    traceStep({ name, compensate: async () => {} })(async () => {
      if (fail) throw new Error(`${name} failed`);
    });

  type Order = { id: string; failShipping: boolean };
  const fulfilOrder = traceWorkflow({
    name: 'FulfilOrder',
    workflowId: (order: Order) => order.id,
  })(() => async ({ failShipping }: Order) => {
    await step('ReserveStock')();
    await step('ChargePayment')();
    await step('ShipOrder', failShipping)();
  });

  it('counts how each run and step ended', async () => {
    await fulfilOrder({ id: 'o-1', failShipping: false });
    await expect(
      fulfilOrder({ id: 'o-2', failShipping: true }),
    ).rejects.toThrow('ShipOrder failed');

    const snap = sub.toSnapshot({ freezeTimestamps: 'frozen' });
    const workflow = snap.workflows?.FulfilOrder;
    expect(workflow).toEqual({
      name: 'FulfilOrder',
      runs: 2,
      firstSeen: 'frozen',
      lastSeen: 'frozen',
      completed: 1,
      compensated: 1,
      steps: [
        { name: 'ReserveStock', count: 2, compensated: 1 },
        { name: 'ChargePayment', count: 2, compensated: 1 },
        { name: 'ShipOrder', count: 2, failed: 1 },
      ],
      sampleTraceIds: expect.any(Array),
    });
    expect(workflow?.sampleTraceIds).toHaveLength(2);
  });

  it('counts a step that runs inside another span of the workflow', async () => {
    const settle = traceWorkflow({ name: 'Settle', workflowId: 'w-1' })(
      () => async () => {
        await trace.run('load', async () => step('Post')());
      },
    );
    await settle();

    const snap = sub.toSnapshot({ freezeTimestamps: 'frozen' });
    expect(snap.workflows?.Settle?.steps).toEqual([{ name: 'Post', count: 1 }]);
  });

  it('writes no workflows key when no workflow ran', async () => {
    await sub.trackEvent('order.placed', { orderId: 'o-1' });
    expect(sub.toSnapshot({ now: FIXED_NOW })).not.toHaveProperty('workflows');
  });
});
