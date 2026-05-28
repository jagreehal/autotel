import { describe, it, expect } from 'vitest';
import { diffCatalogAgainstSnapshot, hasDrift, countDriftReport } from './diff';
import type { ArchitectureSnapshot } from './snapshot';
import type { CatalogState } from './catalog';

function snap(events: ArchitectureSnapshot['events']): ArchitectureSnapshot {
  return {
    spec: 'autotel-architecture/v0.1.0',
    generatedAt: '2026-05-21T18:04:00.000Z',
    service: 'example-eventcatalog',
    events,
  };
}

function catalog(opts: {
  events?: Array<{
    id: string;
    declaredFieldPaths?: string[];
    declaredSchemaConstraints?: Record<
      string,
      { types?: string[]; enumValues?: unknown[] }
    >;
  }>;
  services?: string[];
  channels?: string[];
}): CatalogState {
  return {
    events: new Map(
      (opts.events ?? []).map((e) => [
        e.id,
        {
          id: e.id,
          filePath: `mock/${e.id}.mdx`,
          declaredFieldPaths: e.declaredFieldPaths,
          declaredSchemaConstraints: e.declaredSchemaConstraints,
        },
      ]),
    ),
    services: new Map(
      (opts.services ?? []).map((id) => [
        id,
        { id, filePath: `mock/${id}.mdx` },
      ]),
    ),
    channels: new Map(
      (opts.channels ?? []).map((id) => [
        id,
        { id, filePath: `mock/${id}.mdx` },
      ]),
    ),
  };
}

const baseObservation = {
  observedCount: 5,
  firstSeen: '2026-05-21T18:00:00.000Z',
  lastSeen: '2026-05-21T18:04:00.000Z',
  sampleTraceIds: [],
};

describe('diffCatalogAgainstSnapshot; event existence', () => {
  it('matches dotted snapshot names to PascalCase catalog ids', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'order.placed': {
          ...baseObservation,
          name: 'order.placed',
          fieldPaths: ['orderId'],
        },
      }),
      catalog({ events: [{ id: 'OrderPlaced' }] }),
    );

    expect(report.events.observedButUndocumented).toEqual([]);
    expect(report.events.documentedButUnseen).toEqual([]);
  });

  it('reports events in the snapshot that have no catalog entry', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'order.placed': {
          ...baseObservation,
          name: 'order.placed',
          fieldPaths: [],
        },
        'order.cancelled': {
          ...baseObservation,
          name: 'order.cancelled',
          fieldPaths: [],
        },
      }),
      catalog({ events: [{ id: 'OrderPlaced' }] }),
    );

    expect(report.events.observedButUndocumented).toEqual(['order.cancelled']);
  });

  it('reports catalog entries that the snapshot never observed', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'order.placed': {
          ...baseObservation,
          name: 'order.placed',
          fieldPaths: [],
        },
      }),
      catalog({ events: [{ id: 'OrderPlaced' }, { id: 'PaymentCaptured' }] }),
    );

    expect(report.events.documentedButUnseen).toEqual(['PaymentCaptured']);
  });
});

describe('diffCatalogAgainstSnapshot; field drift', () => {
  it('reports extra field paths in the observed payload', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'recommendation.generated': {
          ...baseObservation,
          name: 'recommendation.generated',
          fieldPaths: ['orderId', 'model', 'personalization_seed'],
        },
      }),
      catalog({
        events: [
          {
            id: 'RecommendationGenerated',
            declaredFieldPaths: ['orderId', 'model'],
          },
        ],
      }),
    );

    expect(report.events.fieldDrift).toEqual([
      {
        event: 'recommendation.generated',
        extra: ['personalization_seed'],
        missing: [],
      },
    ]);
  });

  it('reports declared field paths that were never observed', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'order.placed': {
          ...baseObservation,
          name: 'order.placed',
          fieldPaths: ['orderId'],
        },
      }),
      catalog({
        events: [
          {
            id: 'OrderPlaced',
            declaredFieldPaths: ['orderId', 'customerId', 'totalCents'],
          },
        ],
      }),
    );

    expect(report.events.fieldDrift).toEqual([
      {
        event: 'order.placed',
        extra: [],
        missing: ['customerId', 'totalCents'],
      },
    ]);
  });

  it('skips events without a declared schema', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'order.placed': {
          ...baseObservation,
          name: 'order.placed',
          fieldPaths: ['orderId', 'extra'],
        },
      }),
      catalog({ events: [{ id: 'OrderPlaced' }] }),
    );

    expect(report.events.fieldDrift).toEqual([]);
  });
});

describe('diffCatalogAgainstSnapshot; type/value drift', () => {
  it('reports type drift and enum value drift against declared schema constraints', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'order.placed': {
          ...baseObservation,
          name: 'order.placed',
          fieldPaths: ['amountCents', 'status'],
          fieldStats: {
            amountCents: {
              types: ['string'],
              sampleValues: ['1299'],
            },
            status: {
              types: ['string'],
              sampleValues: ['placed'],
            },
          },
        },
      }),
      catalog({
        events: [
          {
            id: 'OrderPlaced',
            declaredFieldPaths: ['amountCents', 'status'],
            declaredSchemaConstraints: {
              amountCents: { types: ['number'] },
              status: { types: ['string'], enumValues: ['pending', 'paid'] },
            },
          },
        ],
      }),
    );

    expect(report.events.typeDrift).toEqual([
      {
        event: 'order.placed',
        path: 'amountCents',
        declared: ['number'],
        observed: ['string'],
      },
    ]);
    expect(report.events.valueDrift).toEqual([
      {
        event: 'order.placed',
        path: 'status',
        declared: ['pending', 'paid'],
        observed: ['placed'],
      },
    ]);
  });
});

describe('diffCatalogAgainstSnapshot; services and channels', () => {
  it('reports producers that are not declared as services', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'order.placed': {
          ...baseObservation,
          name: 'order.placed',
          fieldPaths: [],
          producer: 'OrdersService',
        },
        'payment.captured': {
          ...baseObservation,
          name: 'payment.captured',
          fieldPaths: [],
          producer: 'GhostService',
        },
      }),
      catalog({
        events: [{ id: 'OrderPlaced' }, { id: 'PaymentCaptured' }],
        services: ['OrdersService'],
      }),
    );

    expect(report.services.observedButUndocumented).toEqual(['GhostService']);
  });

  it('reports channels that are not declared in the catalog', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'order.placed': {
          ...baseObservation,
          name: 'order.placed',
          fieldPaths: [],
          channel: 'orders.events',
        },
        'payment.captured': {
          ...baseObservation,
          name: 'payment.captured',
          fieldPaths: [],
          channel: 'rogue.events',
        },
      }),
      catalog({
        events: [{ id: 'OrderPlaced' }, { id: 'PaymentCaptured' }],
        channels: ['orders.events'],
      }),
    );

    expect(report.channels.observedButUndocumented).toEqual(['rogue.events']);
  });
});

describe('hasDrift', () => {
  it('returns false when every category is empty', () => {
    const report = diffCatalogAgainstSnapshot(snap({}), catalog({}));
    expect(hasDrift(report)).toBe(false);
  });

  it('returns true when any category has drift', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'new.event': { ...baseObservation, name: 'new.event', fieldPaths: [] },
      }),
      catalog({}),
    );
    expect(hasDrift(report)).toBe(true);
  });
});

describe('countDriftReport', () => {
  it('zero everywhere on a clean report', () => {
    const c = countDriftReport(
      diffCatalogAgainstSnapshot(snap({}), catalog({})),
    );
    expect(c.total).toBe(0);
    expect(c.observedButUndocumentedEvents).toBe(0);
    expect(c.documentedButUnseenEvents).toBe(0);
    expect(c.fieldDriftEvents).toBe(0);
    expect(c.fieldDriftPaths).toBe(0);
    expect(c.undocumentedServices).toBe(0);
    expect(c.undocumentedChannels).toBe(0);
  });

  it('distinguishes fieldDrift events from fieldDrift paths', () => {
    const report = diffCatalogAgainstSnapshot(
      snap({
        'recommendation.generated': {
          ...baseObservation,
          name: 'recommendation.generated',
          fieldPaths: ['a', 'b', 'c'],
        },
      }),
      catalog({
        events: [
          {
            id: 'RecommendationGenerated',
            declaredFieldPaths: ['a', 'd'], // observed: a,b,c → extras b,c; declared: a,d → missing d
          },
        ],
      }),
    );
    const c = countDriftReport(report);
    expect(c.fieldDriftEvents).toBe(1); // one event with drift
    expect(c.fieldDriftPaths).toBe(3); // b extra + c extra + d missing
    expect(c.total).toBe(3); // only field drift contributes
  });

  it('total matches the dashboard `countDrift` semantics', () => {
    // Hand-build a report with one item in every category so total has
    // an unambiguous expected value.
    const report = diffCatalogAgainstSnapshot(
      snap({
        'a.new': {
          ...baseObservation,
          name: 'a.new',
          fieldPaths: ['x'],
          producer: 'NewService',
          channel: 'new.events',
        },
        'b.match': {
          ...baseObservation,
          name: 'b.match',
          fieldPaths: ['z', 'q'],
        },
      }),
      catalog({
        events: [
          { id: 'BMatch', declaredFieldPaths: ['z', 'p'] }, // extra q, missing p
          { id: 'LegacyEvent' }, // documented but unseen
        ],
        services: [],
        channels: [],
      }),
    );
    const c = countDriftReport(report);
    // 1 observed-but-undoc (a.new) + 1 doc-but-unseen (LegacyEvent)
    //   + 2 field paths (q extra, p missing) + 1 service + 1 channel
    expect(c.total).toBe(6);
    expect(c.observedButUndocumentedEvents).toBe(1);
    expect(c.documentedButUnseenEvents).toBe(1);
    expect(c.fieldDriftPaths).toBe(2);
    expect(c.undocumentedServices).toBe(1);
    expect(c.undocumentedChannels).toBe(1);
  });
});
