import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArchitectureSnapshotSubscriber,
  extractFieldPaths,
  ARCHITECTURE_SNAPSHOT_SPEC,
} from './architecture-snapshot';
import type { EventPayload } from './event-subscriber-base';

const FIXED_NOW = () => new Date('2026-05-21T18:04:00.000Z');

function event(
  name: string,
  attributes: Record<string, unknown> = {},
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
    expect(
      extractFieldPaths({ a: { b: { c: 1 } } }),
    ).toEqual(['a', 'a.b', 'a.b.c']);
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

    const snap = sub.toSnapshot(FIXED_NOW);
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

  it('accumulates count, lastSeen, and merges field paths across calls', async () => {
    await sub.trackEvent('order.placed', { orderId: 'o-1' });
    // Second call adds a new field path.
    await sub.trackEvent('order.placed', {
      orderId: 'o-2',
      shipping: { addressId: 'addr_1' },
    });

    const obs = sub.toSnapshot(FIXED_NOW).events['order.placed'];
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

    const obs = sub.toSnapshot(FIXED_NOW).events['order.placed'];
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

    const obs = sub.toSnapshot(FIXED_NOW).events['order.placed'];
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
      await (limited as unknown as { sendToDestination(p: EventPayload): Promise<void> })
        .sendToDestination(event('order.placed', {}, { traceId: id }));
    }
    const obs = limited.toSnapshot(FIXED_NOW).events['order.placed'];
    expect(obs.sampleTraceIds).toEqual(['t-1', 't-2']);
  });

  it('ignores non-event payload types', async () => {
    await sub.trackEvent('order.placed', { orderId: 'o-1' });
    await sub.trackOutcome('checkout', 'success');
    await sub.trackValue('revenue', 99);

    const snap = sub.toSnapshot(FIXED_NOW);
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
      expect(JSON.stringify(a.toSnapshot(at))).toBe(
        JSON.stringify(b.toSnapshot(at)),
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
    expect(sub.toSnapshot(FIXED_NOW).events).toEqual({});
  });
});
