import { describe, expect, it } from 'vitest';
import { buildLiveMap } from './map';
import { normaliseEventId } from './diff';
import { renderLiveMapHtml } from './renderers/map-html';
import type { CatalogState } from './catalog';
import type { ArchitectureSnapshot } from './snapshot';

function catalog(
  overrides: Partial<{
    services: Array<Record<string, unknown>>;
    events: string[];
    channels: string[];
  }> = {},
): CatalogState {
  const state: CatalogState = {
    events: new Map(),
    services: new Map(),
    channels: new Map(),
  };
  for (const id of overrides.events ?? []) {
    state.events.set(id, {
      id,
      name: id,
      version: '1.0.0',
      filePath: '',
    } as never);
  }
  for (const id of overrides.channels ?? []) {
    state.channels.set(id, {
      id,
      name: id,
      version: '1.0.0',
      filePath: '',
    } as never);
  }
  for (const service of overrides.services ?? []) {
    state.services.set(
      service.id as string,
      {
        version: '1.0.0',
        filePath: '',
        ...service,
      } as never,
    );
  }
  return state;
}

function snapshot(
  events: Record<
    string,
    Partial<{
      observedCount: number;
      producer: string;
      channel: string;
      consumers: string[];
      sources: Array<Record<string, unknown>>;
    }>
  >,
): ArchitectureSnapshot {
  return {
    spec: 'autotel-architecture/v0.1.0',
    generatedAt: '2026-09-07T00:00:00.000Z',
    service: 'shop',
    events: Object.fromEntries(
      Object.entries(events).map(([name, value]) => [
        name,
        {
          name,
          observedCount: value.observedCount ?? 1,
          firstSeen: '2026-09-07T00:00:00.000Z',
          lastSeen: '2026-09-07T00:00:00.000Z',
          fieldPaths: [],
          sampleTraceIds: [],
          ...value,
        },
      ]),
    ),
  } as ArchitectureSnapshot;
}

const ORDERS = {
  id: 'OrdersService',
  name: 'Orders Service',
  sends: [{ id: 'OrderPlaced', to: [{ id: 'orders.events' }] }],
};

describe('buildLiveMap', () => {
  it('matches a dotted track() name to a PascalCase catalog id', () => {
    const map = buildLiveMap(
      snapshot({
        'order.placed': { observedCount: 7, producer: 'OrdersService' },
      }),
      catalog({ services: [ORDERS], events: ['OrderPlaced'] }),
    );

    const event = map.nodes.find((node) => node.id === 'event:OrderPlaced');
    expect(event?.liveness).toBe('observed');
    expect(event?.count).toBe(7);
    // One event, not one declared plus one undocumented.
    expect(map.nodes.filter((node) => node.kind === 'event')).toHaveLength(1);
  });

  /** The feature: an arrow four teams believe in that carried nothing. */
  it('marks a declared relationship that never fired as declared-only', () => {
    const map = buildLiveMap(
      snapshot({}),
      catalog({
        services: [ORDERS],
        events: ['OrderPlaced'],
        channels: ['orders.events'],
      }),
    );

    const edge = map.edges.find((e) => e.kind === 'produces');
    expect(edge?.liveness).toBe('declared-only');
    expect(edge?.count).toBe(0);
    expect(map.summary.declaredOnlyEdges).toBeGreaterThan(0);
    expect(map.summary.observedEdges).toBe(0);
  });

  it('marks an event that ran but is absent from the catalog as undocumented', () => {
    const map = buildLiveMap(
      snapshot({ 'order.cancelled': { producer: 'OrdersService' } }),
      catalog({ services: [ORDERS], events: ['OrderPlaced'] }),
    );

    const node = map.nodes.find((n) => n.id === 'event:order.cancelled');
    expect(node?.liveness).toBe('undocumented');
    expect(map.summary.undocumentedEdges).toBeGreaterThan(0);
  });

  /**
   * The honesty rule. A producer's telemetry proves an event fired; it cannot
   * prove anyone received it. If consumer edges could ever read as `observed`
   * evidence, the picture would claim a measurement it never took.
   */
  it('never marks a consumer edge as observed evidence, however busy', () => {
    const map = buildLiveMap(
      snapshot({
        'order.placed': {
          observedCount: 5000,
          producer: 'OrdersService',
          consumers: ['PaymentService'],
        },
      }),
      catalog({
        services: [
          ORDERS,
          {
            id: 'PaymentService',
            name: 'Payment Service',
            receives: [{ id: 'OrderPlaced', from: [{ id: 'orders.events' }] }],
          },
        ],
        events: ['OrderPlaced'],
      }),
    );

    const consumerEdges = map.edges.filter((e) => e.kind === 'consumed-by');
    expect(consumerEdges.length).toBeGreaterThan(0);
    expect(consumerEdges.every((e) => e.evidence === 'asserted')).toBe(true);

    const producerEdges = map.edges.filter((e) => e.kind === 'produces');
    expect(producerEdges.every((e) => e.evidence === 'observed')).toBe(true);
  });

  /**
   * The report said OrdersService publishes it; telemetry says PaymentService
   * did. Keying evidence on the event name alone would corroborate the wrong
   * arrow — the exact false confidence this map exists to remove.
   */
  it('does not corroborate a declared producer that telemetry contradicts', () => {
    const map = buildLiveMap(
      snapshot({ 'order.placed': { producer: 'PaymentService' } }),
      catalog({
        services: [ORDERS, { id: 'PaymentService', name: 'Payment Service' }],
        events: ['OrderPlaced'],
      }),
    );

    const declaredButUnproven = map.edges.find(
      (e) => e.id === 'produces:service:OrdersService->event:OrderPlaced',
    );
    expect(declaredButUnproven?.liveness).toBe('declared-only');

    const actuallyRan = map.edges.find(
      (e) => e.id === 'produces:service:PaymentService->event:OrderPlaced',
    );
    expect(actuallyRan?.liveness).toBe('undocumented');
  });

  it('does not corroborate a declared channel the event did not use', () => {
    const map = buildLiveMap(
      snapshot({
        'order.placed': { producer: 'OrdersService', channel: 'legacy.events' },
      }),
      catalog({
        services: [ORDERS],
        events: ['OrderPlaced'],
        channels: ['orders.events'],
      }),
    );

    expect(
      map.edges.find(
        (e) => e.id === 'publishes-to:event:OrderPlaced->channel:orders.events',
      )?.liveness,
    ).toBe('declared-only');
    expect(
      map.edges.find(
        (e) => e.id === 'publishes-to:event:OrderPlaced->channel:legacy.events',
      )?.liveness,
    ).toBe('undocumented');
  });

  /**
   * Both endpoints are documented; the relationship between them is not. A
   * service that quietly starts publishing an existing event is drift worth
   * seeing, and checking only that the nodes exist would hide it.
   */
  it('flags an undeclared relationship between two documented resources', () => {
    const map = buildLiveMap(
      snapshot({ 'order.placed': { producer: 'PaymentService' } }),
      catalog({
        services: [ORDERS, { id: 'PaymentService', name: 'Payment Service' }],
        events: ['OrderPlaced'],
      }),
    );

    const edge = map.edges.find(
      (e) => e.id === 'produces:service:PaymentService->event:OrderPlaced',
    );
    expect(edge?.liveness).toBe('undocumented');
    expect(map.summary.undocumentedEdges).toBeGreaterThan(0);
  });

  /**
   * `_autotel.consumers` is the producer asserting who listens. That the named
   * service exists in the catalog does not mean the catalog documents this
   * relationship, and treating it as declared hides drift between two
   * documented resources.
   */
  it('does not treat a runtime-asserted consumer as documented', () => {
    const map = buildLiveMap(
      snapshot({
        'order.placed': {
          producer: 'OrdersService',
          consumers: ['PaymentService'],
        },
      }),
      catalog({
        services: [
          ORDERS,
          // Exists, but declares no `receives` for this event.
          { id: 'PaymentService', name: 'Payment Service' },
        ],
        events: ['OrderPlaced'],
      }),
    );

    const edge = map.edges.find(
      (e) => e.id === 'consumed-by:event:OrderPlaced->service:PaymentService',
    );
    expect(edge?.liveness).toBe('undocumented');
  });

  it('still treats a catalog receives declaration as documented', () => {
    const map = buildLiveMap(
      snapshot({ 'order.placed': { producer: 'OrdersService' } }),
      catalog({
        services: [
          ORDERS,
          {
            id: 'PaymentService',
            name: 'Payment Service',
            receives: [{ id: 'OrderPlaced', from: [{ id: 'orders.events' }] }],
          },
        ],
        events: ['OrderPlaced'],
      }),
    );

    expect(
      map.edges.find(
        (e) => e.id === 'consumed-by:event:OrderPlaced->service:PaymentService',
      )?.liveness,
    ).toBe('observed');
  });

  /**
   * The snapshot aggregates by event name, keeping only the first producer and
   * an event-level total. Attributing that total to one relationship credits a
   * second producer's traffic to the first, so the map reads `sources`.
   */
  it('attributes counts per relationship, not per event name', () => {
    const map = buildLiveMap(
      snapshot({
        'order.placed': {
          observedCount: 2,
          producer: 'ServiceA',
          channel: 'topic-a',
          sources: [
            {
              producer: 'ServiceA',
              channel: 'topic-a',
              count: 1,
              lastSeen: 'T',
            },
            {
              producer: 'ServiceB',
              channel: 'topic-b',
              count: 1,
              lastSeen: 'T',
            },
          ],
        },
      }),
      catalog({ events: ['OrderPlaced'] }),
    );

    const a = map.edges.find(
      (e) => e.id === 'produces:service:ServiceA->event:OrderPlaced',
    );
    const b = map.edges.find(
      (e) => e.id === 'produces:service:ServiceB->event:OrderPlaced',
    );

    // Both producers exist, each with its own count — not 2 credited to A.
    expect(a?.count).toBe(1);
    expect(b?.count).toBe(1);
    expect(b?.liveness).toBe('undocumented');
    expect(a?.exactCount).toBe(true);
  });

  it('marks a legacy snapshot count as inexact rather than claiming precision', () => {
    const map = buildLiveMap(
      snapshot({
        'order.placed': { observedCount: 2, producer: 'ServiceA' },
      }),
      catalog({ events: ['OrderPlaced'] }),
    );

    const edge = map.edges.find((e) => e.kind === 'produces');
    expect(edge?.count).toBe(2);
    // No `sources`, so the total cannot be attributed to this relationship.
    expect(edge?.exactCount).toBe(false);
  });

  /**
   * Several sources feed one relation — a producer publishing on two channels
   * hits the same `produces` edge twice — and sources are ordered by name, not
   * by time. Assigning each in turn let an older one win.
   */
  it('takes the latest timestamp across sources, never an earlier one', () => {
    const map = buildLiveMap(
      snapshot({
        'order.placed': {
          observedCount: 2,
          producer: 'ServiceA',
          sources: [
            {
              producer: 'ServiceA',
              channel: 'a-channel',
              count: 1,
              lastSeen: '2026-09-07T12:00:00.000Z',
            },
            {
              producer: 'ServiceA',
              channel: 'b-channel',
              count: 1,
              lastSeen: '2026-09-07T10:00:00.000Z',
            },
          ],
        },
      }),
      catalog({ events: ['OrderPlaced'] }),
    );

    const produces = map.edges.find((e) => e.kind === 'produces');
    expect(produces?.count).toBe(2);
    expect(produces?.lastSeen).toBe('2026-09-07T12:00:00.000Z');
  });

  it('is deterministic, so a committed map diffs cleanly', () => {
    const build = () =>
      buildLiveMap(
        snapshot({ 'order.placed': { producer: 'OrdersService' } }),
        catalog({ services: [ORDERS], events: ['OrderPlaced'] }),
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe('renderLiveMapHtml', () => {
  // OrdersService declares it sends both; only one fired. The still edge is
  // the whole point of the picture.
  const map = buildLiveMap(
    snapshot({
      'order.placed': { observedCount: 4, producer: 'OrdersService' },
    }),
    catalog({
      services: [
        {
          ...ORDERS,
          sends: [
            { id: 'OrderPlaced', to: [{ id: 'orders.events' }] },
            { id: 'OrderCancelled', to: [{ id: 'orders.events' }] },
          ],
        },
      ],
      events: ['OrderPlaced', 'OrderCancelled'],
      channels: ['orders.events'],
    }),
  );

  it('produces one self-contained file with no external references', () => {
    const html = renderLiveMapHtml(map);
    expect(html).toContain('<!doctype html>');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });

  /** Stillness is the finding, so nothing without evidence may move. */
  it('refuses to animate an edge that has no evidence', () => {
    const html = renderLiveMapHtml(map, { mode: 'replay' });
    const config = JSON.parse(
      html
        .match(/const config = (\{.*?\});/s)?.[1]
        .replaceAll(String.raw`\\u003c`, '<') ?? '{}',
    );
    const declaredOnly = config.edges.filter(
      (edge: { liveness: string }) => edge.liveness === 'declared-only',
    );
    // The data the page needs to withhold them. That it actually withholds
    // them is asserted against a real page in `map.browser.e2e.test.ts`.
    expect(declaredOnly.length).toBeGreaterThan(0);
  });

  /**
   * A map opened before the first event has no observed edges. If the movable
   * set were frozen at load it would sit still forever while reporting itself
   * live, so evidence has to be able to promote an edge after render.
   */
  it('indexes every edge so live evidence can reach a never-seen one', () => {
    const html = renderLiveMapHtml(map, {
      mode: 'live',
      liveUrl: '/events',
      liveEventName: 'track',
    });
    const config = JSON.parse(
      html
        .match(/const config = (\{.*?\});/s)?.[1]
        .replaceAll(String.raw`\\u003c`, '<') ?? '{}',
    );

    // Declared-only edges are present in the index...
    expect(
      config.edges.some(
        (edge: { liveness: string }) => edge.liveness === 'declared-only',
      ),
    ).toBe(true);
    // ...and every edge carries a match key, not just the observed ones.
    expect(
      config.edges.every((edge: { matchKey: string }) =>
        Boolean(edge.matchKey),
      ),
    ).toBe(true);
    // Promotion behaviour itself is asserted in `map.browser.e2e.test.ts`.
  });

  /** A frame corroborates the producer it names, never a different one. */
  it('carries the producer and channel each edge answers to', () => {
    const html = renderLiveMapHtml(map, { mode: 'live', liveUrl: '/events' });
    const config = JSON.parse(
      html
        .match(/const config = (\{.*?\});/s)?.[1]
        .replaceAll(String.raw`\\u003c`, '<') ?? '{}',
    );
    const produces = config.edges.find((edge: { id: string }) =>
      edge.id.startsWith('produces:'),
    );
    expect(produces.producer).toBe('OrdersService');
    const publishes = config.edges.find((edge: { id: string }) =>
      edge.id.startsWith('publishes-to:'),
    );
    expect(publishes.channel).toBe('orders.events');
  });

  // What a frame credits, what an unknown producer does, and whether a
  // never-seen edge can move are behaviour, not text. They are asserted against
  // a real page in `map.browser.e2e.test.ts`; asserting the source here only
  // proved the lines had been typed.

  /** Advice the code cannot deliver is the failure this whole map is about. */
  it('does not promise measured consumption it cannot produce', () => {
    const withConsumer = buildLiveMap(
      snapshot({ 'order.placed': { producer: 'OrdersService' } }),
      catalog({
        services: [
          ORDERS,
          {
            id: 'PaymentService',
            name: 'Payment Service',
            receives: [{ id: 'OrderPlaced', from: [{ id: 'orders.events' }] }],
          },
        ],
        events: ['OrderPlaced'],
      }),
    );
    expect(withConsumer.summary.assertedEdges).toBeGreaterThan(0);

    const html = renderLiveMapHtml(withConsumer);
    expect(html).toContain('cannot be confirmed');
    // Nothing reads consumer spans, so pointing at traceConsumer promised a
    // result the code cannot produce.
    expect(html).not.toContain('traceConsumer');
    expect(html).toContain('Measured consumption is not supported yet');
  });

  /**
   * A frame proves the event occurred whether or not its producer is on this
   * map. Updating the event node only through a matched producer edge left a
   * known event grey at zero while the page was watching it fire.
   */
  it('credits the event node even when the producer is unknown', () => {
    const html = renderLiveMapHtml(map, { mode: 'live', liveUrl: '/events' });
    const config = JSON.parse(
      html
        .match(/const config = (\{.*?\});/s)?.[1]
        .replaceAll(String.raw`\u003c`, '<') ?? '{}',
    );
    // The event node is reached by name, not through a matched edge.
    expect(config.eventNodes.orderplaced).toBe('event:OrderPlaced');
  });

  /**
   * A catalog can declare an event that no service sends or receives. Reaching
   * event nodes through edges left it at zero and counted the frame as off-map.
   */
  it('indexes event nodes even when nothing is wired to them', () => {
    const orphan = buildLiveMap(
      snapshot({}),
      // Declared, with no service sending or receiving it.
      catalog({ events: ['OrderPlaced'] }),
    );
    expect(orphan.edges).toHaveLength(0);

    const html = renderLiveMapHtml(orphan, {
      mode: 'live',
      liveUrl: '/events',
    });
    const config = JSON.parse(
      html
        .match(/const config = (\{.*?\});/s)?.[1]
        .replaceAll(String.raw`\u003c`, '<') ?? '{}',
    );

    // An event with no edges is still indexed, which is what lets the page
    // update it; that it does is asserted in `map.browser.e2e.test.ts`.
    expect(config.eventNodes).toEqual({ orderplaced: 'event:OrderPlaced' });
  });

  /**
   * The page normalises incoming event names with its own copy of the rule in
   * `normaliseEventId`. Two copies are fine only while a check catches them
   * drifting — if they diverge, a live frame silently stops finding its edge.
   */
  it('emits a normaliser that agrees with normaliseEventId', () => {
    const html = renderLiveMapHtml(map, { mode: 'live', liveUrl: '/events' });
    const source = html.match(/const normalise = (.*);/)?.[1];
    expect(source).toBeDefined();
    const clientNormalise = new Function(`return ${source}`)() as (
      id: string,
    ) => string;

    for (const sample of [
      'order.placed',
      'OrderPlaced',
      'order_placed',
      'Order Placed',
      'order-placed',
      'INVENTORY.reserved',
    ]) {
      expect(clientNormalise(sample)).toBe(normaliseEventId(sample));
    }
  });

  it('listens on the SSE event name it was given', () => {
    const html = renderLiveMapHtml(map, {
      mode: 'live',
      liveUrl: '/events',
      liveEventName: 'track',
    });
    expect(html).toContain('"liveEventName":"track"');
    expect(html).toContain('new EventSource(config.liveUrl)');
  });

  /**
   * An HTML parser ends a script block at the first `</script`, including one
   * inside a JSON string — so an event name is an injection vector into the
   * embedded config, not just into the markup.
   */
  it('cannot be broken out of the embedded script by a catalog name', () => {
    const hostile = buildLiveMap(
      snapshot({}),
      catalog({
        services: [
          {
            id: 'S',
            name: 'S',
            sends: [{ id: '</script><img src=x onerror=alert(1)>' }],
          },
        ],
      }),
    );
    const html = renderLiveMapHtml(hostile, { mode: 'replay' });

    expect(html).not.toContain('</script><img');
    expect(html).toContain(String.raw`\u003c/script`);
    // Still valid JSON, and the escape round-trips to the original character.
    const config = JSON.parse(
      html
        .match(/const config = (\{.*?\});/s)?.[1]
        .replaceAll(String.raw`\u003c`, '<') ?? '{}',
    );
    expect(
      config.edges.some((edge: { id: string }) => edge.id.includes('<script')),
    ).toBe(false);
    // Exactly one closing tag: the page's own.
    expect(html.split('</script>').length - 1).toBe(1);
  });

  it('escapes catalog text rather than interpolating it into markup', () => {
    const hostile = buildLiveMap(
      snapshot({}),
      catalog({ events: ['<img src=x onerror=alert(1)>'] }),
    );
    const html = renderLiveMapHtml(hostile);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
