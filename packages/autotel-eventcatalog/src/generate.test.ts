import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import utils from '@eventcatalog/sdk';
import {
  buildGenerateSummary,
  generateCatalogFromSnapshot,
  inferJsonSchemaFromObservation,
} from './generate';
import type { ArchitectureSnapshot, EventObservation } from './snapshot';

function obs(overrides: Partial<EventObservation> = {}): EventObservation {
  return {
    name: 'order.placed',
    observedCount: 2,
    firstSeen: '2026-05-22T00:00:00.000Z',
    lastSeen: '2026-05-22T00:00:01.000Z',
    fieldPaths: ['orderId', 'items', 'items[].sku'],
    sampleTraceIds: [],
    producer: 'OrdersService',
    consumers: ['PaymentService'],
    channel: 'orders.events',
    fieldStats: {
      orderId: { types: ['string'], sampleValues: ['o-1'] },
      items: { types: ['array'], sampleValues: [] },
      'items[].sku': { types: ['string'], sampleValues: ['sku-1'] },
    },
    ...overrides,
  };
}

function snap(events: ArchitectureSnapshot['events']): ArchitectureSnapshot {
  return {
    spec: 'autotel-architecture/v0.1.0',
    generatedAt: '2026-05-22T00:00:02.000Z',
    service: 'fixture',
    events,
  };
}

describe('inferJsonSchemaFromObservation', () => {
  it('builds nested object/array schema from field paths + field stats', () => {
    const schema = inferJsonSchemaFromObservation(obs()) as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties.orderId).toEqual({ type: 'string' });
    expect(schema.properties.items).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sku: { type: 'string' },
        },
      },
    });
  });
});

describe('generateCatalogFromSnapshot', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'autotel-generate-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('plans scaffold + edge generation in dry-run mode', async () => {
    const result = await generateCatalogFromSnapshot({
      snapshot: snap({ 'order.placed': obs() }),
      catalogPath: dir,
      dryRun: true,
    });
    expect(result.operations.some((o) => o.kind === 'service')).toBe(true);
    expect(result.operations.some((o) => o.kind === 'event')).toBe(true);
    expect(result.operations.some((o) => o.kind === 'channel')).toBe(true);
    expect(result.operations.some((o) => o.kind === 'service-edge')).toBe(true);
    expect(result.operations.some((o) => o.kind === 'channel-edge')).toBe(true);
    expect(
      result.operations.some((o) => o.id === 'PaymentService<-OrderPlaced'),
    ).toBe(true);
  });

  it('creates resources and wires edges when not dry-run', async () => {
    await generateCatalogFromSnapshot({
      snapshot: snap({ 'order.placed': obs() }),
      catalogPath: dir,
      dryRun: false,
    });
    const sdk = utils(dir);
    const event = await sdk.getEvent('OrderPlaced');
    const service = await sdk.getService('OrdersService');
    const consumer = await sdk.getService('PaymentService');
    const channel = await sdk.getChannel('orders.events');
    expect(event?.id).toBe('OrderPlaced');
    expect(service?.sends?.some((m) => m.id === 'OrderPlaced')).toBe(true);
    expect(consumer?.receives?.some((m) => m.id === 'OrderPlaced')).toBe(true);
    expect(channel?.id).toBe('orders.events');
  });

  it('writes obs.schema.jsonSchema verbatim when present, in preference to inference', async () => {
    const declared = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      title: 'OrderPlacedDeclared',
      properties: {
        orderId: { type: 'string', format: 'uuid' },
        totalCents: { type: 'integer', minimum: 0 },
      },
      required: ['orderId', 'totalCents'],
    };
    await generateCatalogFromSnapshot({
      snapshot: snap({
        'order.placed': obs({
          schema: {
            source: 'zod',
            jsonSchema: declared,
            hash: 'deadbeef',
          },
        }),
      }),
      catalogPath: dir,
      dryRun: false,
    });
    const sdk = utils(dir);
    const event = await sdk.getEvent('OrderPlaced', undefined, {
      attachSchema: true,
    });
    expect((event as { schema?: unknown })?.schema).toEqual(declared);
  });

  it('marks operations with their schemaSource', async () => {
    const declared = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { orderId: { type: 'string' } },
    };
    const result = await generateCatalogFromSnapshot({
      snapshot: snap({
        'order.placed': obs({
          schema: {
            source: 'zod',
            jsonSchema: declared,
            hash: 'h1',
          },
        }),
        'payment.captured': obs({
          name: 'payment.captured',
          producer: 'PaymentService',
          channel: 'payments.events',
          fieldStats: { orderId: { types: ['string'], sampleValues: ['o-1'] } },
        }),
      }),
      catalogPath: dir,
      dryRun: true,
    });
    const eventOps = result.operations.filter((o) => o.kind === 'event');
    const byId = Object.fromEntries(eventOps.map((o) => [o.id, o]));
    expect(byId.OrderPlaced.schemaSource).toBe('declared');
    expect(byId.PaymentCaptured.schemaSource).toBe('inferred');
  });

  it('produces a versioned summary envelope', async () => {
    const result = await generateCatalogFromSnapshot({
      snapshot: snap({ 'order.placed': obs() }),
      catalogPath: dir,
      dryRun: true,
    });
    const summary = buildGenerateSummary(result, {
      dryRun: true,
      edgesOnly: false,
    });
    expect(summary.spec).toBe('autotel-eventcatalog-generate-summary/v0.1.0');
    expect(summary.attempted).toBeGreaterThan(0);
    expect(summary.totals.created).toBeGreaterThan(0);
    expect(summary.created.services).toContain('OrdersService');
    expect(summary.created.events).toContain('OrderPlaced');
    expect(summary.created.channels).toContain('orders.events');
    expect(summary.edges.sends).toContainEqual({
      service: 'OrdersService',
      event: 'OrderPlaced',
    });
    expect(summary.edges.receives).toContainEqual({
      service: 'PaymentService',
      event: 'OrderPlaced',
    });
    expect(summary.edges.messages).toContainEqual({
      channel: 'orders.events',
      event: 'OrderPlaced',
    });
    expect(summary.schemaSources.inferred).toBe(1);
    expect(summary.schemaSources.declared).toBe(0);
  });
});
