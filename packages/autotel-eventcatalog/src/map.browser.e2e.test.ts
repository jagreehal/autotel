/// <reference lib="dom" />
// The live map, driven in a real browser.
//
// The rest of the renderer suite asserts on the emitted source — that a guard
// is present, that a config field is set. That checks the code was written, not
// that it behaves, and every live defect found in review was behavioural:
// a consumer credited for a producer's frame, an unknown producer slipping past
// the counter, an event stuck at zero. String assertions caught none of them.
//
// These drive the real page in Chromium with a controllable `EventSource`
// installed before any page script runs, so a frame can be delivered exactly
// and the resulting DOM read back. `getPointAtLength` and friends are the real
// implementations, which is the point: the marker path is exercised rather than
// stubbed.
//
// Excluded from `pnpm test` by the `*.e2e.test.ts` convention; run with
// `pnpm test:browser`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { buildLiveMap } from './map';
import { renderLiveMapHtml } from './renderers/map-html';
import type { CatalogState } from './catalog';
import type { ArchitectureSnapshot } from './snapshot';

type Frame = {
  name: string;
  producer?: string;
  channel?: string;
};

/**
 * A hand-controlled `EventSource`.
 *
 * Installed through `addInitScript` so it exists before the page's own script
 * runs — reverse that order and the page captures the real constructor and
 * nothing can be delivered to it.
 */
const INSTALL_FAKE_EVENT_SOURCE = `
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      window.__eventSource = this;
    }
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    close() {}
  }
  window.EventSource = FakeEventSource;
  window.__emit = (type, data) => {
    const source = window.__eventSource;
    if (!source) throw new Error('page never opened an EventSource');
    for (const fn of source.listeners[type] || []) {
      fn({ data: typeof data === 'string' ? data : JSON.stringify(data) });
    }
  };
`;

function catalogOf(
  services: Array<Record<string, unknown>>,
  events: string[],
  channels: string[] = [],
): CatalogState {
  const state: CatalogState = {
    events: new Map(),
    services: new Map(),
    channels: new Map(),
  };
  for (const id of events) {
    state.events.set(id, {
      id,
      name: id,
      version: '1.0.0',
      filePath: '',
    } as never);
  }
  for (const id of channels) {
    state.channels.set(id, {
      id,
      name: id,
      version: '1.0.0',
      filePath: '',
    } as never);
  }
  for (const service of services) {
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

function snapshotOf(
  events: Record<string, Record<string, unknown>> = {},
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
          observedCount: 1,
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
  name: 'OrdersService',
  sends: [{ id: 'OrderPlaced', to: [{ id: 'orders.events' }] }],
};
const PAYMENTS = {
  id: 'PaymentService',
  name: 'PaymentService',
  receives: [{ id: 'OrderPlaced', from: [{ id: 'orders.events' }] }],
};

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const PAGE_URL = 'http://map.test/map';

/**
 * Load a generated map with the fake stream installed.
 *
 * Served through a route and a real navigation rather than `setContent`:
 * `addInitScript` does not run for `setContent`, so the page would capture the
 * real `EventSource` and nothing could be delivered to it.
 */
async function open(html: string): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript(INSTALL_FAKE_EVENT_SOURCE);
  await page.route(PAGE_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => Boolean(window.__eventSource));
  return page;
}

/** The same navigation without the fake, for modes that open no stream. */
async function openStatic(html: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route(PAGE_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(PAGE_URL);
  return page;
}

/** `CSS.escape` is a browser API; edge ids contain `:` and `>`. */
const byId = (page: Page, id: string) => page.locator(`[id="${id}"]`);

const nodeCount = (page: Page, id: string) =>
  page
    .locator(`[data-node-id="${id}"] .meta`)
    .getAttribute('data-count')
    .then(Number);

const nodeClass = (page: Page, id: string) =>
  page.locator(`[data-node-id="${id}"]`).getAttribute('class');

const statusText = (page: Page) => page.locator('#live-status').innerText();

const stat = (page: Page, id: string) =>
  page.locator(`#${id}`).innerText().then(Number);

/** Deliver one frame and report how many markers it put in flight. */
async function emit(page: Page, frame: Frame): Promise<number> {
  return page.evaluate((payload) => {
    const before = document.getElementById('markers')!.childElementCount;
    window.__emit('track', { type: 'event', ...payload });
    return document.getElementById('markers')!.childElementCount - before;
  }, frame);
}

const liveMap = (
  snapshot: ArchitectureSnapshot,
  catalog: CatalogState,
): string =>
  renderLiveMapHtml(buildLiveMap(snapshot, catalog), {
    mode: 'live',
    liveUrl: '/events',
    liveEventName: 'track',
  });

describe('live map in a browser', () => {
  /**
   * The reported defect: a producer's frame credited both endpoints of every
   * matched edge, turning a consumer blue with "1 seen" on no delivery
   * evidence whatsoever.
   */
  it('credits the producer and event but never the consumer', async () => {
    const page = await open(
      liveMap(
        snapshotOf(),
        catalogOf([ORDERS, PAYMENTS], ['OrderPlaced'], ['orders.events']),
      ),
    );

    expect(await nodeCount(page, 'service:PaymentService')).toBe(0);

    await emit(page, {
      name: 'order.placed',
      producer: 'OrdersService',
      channel: 'orders.events',
    });

    expect(await nodeCount(page, 'service:OrdersService')).toBe(1);
    expect(await nodeCount(page, 'event:OrderPlaced')).toBe(1);
    expect(await nodeCount(page, 'channel:orders.events')).toBe(1);
    // Delivery is never observable from a producer's telemetry.
    expect(await nodeCount(page, 'service:PaymentService')).toBe(0);
    expect(await nodeClass(page, 'service:PaymentService')).toContain(
      'liveness-declared-only',
    );

    await page.close();
  }, 20_000);

  /** Consumer arrows still move — the event travelled — with a hollow marker. */
  it('animates the consumer edge with a hollow marker', async () => {
    const page = await open(
      liveMap(
        snapshotOf(),
        catalogOf([ORDERS, PAYMENTS], ['OrderPlaced'], ['orders.events']),
      ),
    );

    const inFlight = await emit(page, {
      name: 'order.placed',
      producer: 'OrdersService',
      channel: 'orders.events',
    });
    expect(inFlight).toBeGreaterThan(0);
    expect(await page.locator('#markers circle.asserted').count()).toBe(1);

    await page.close();
  }, 20_000);

  /**
   * Consumer edges match on the event alone, so folding them in with the rest
   * let a frame from a service nobody declared find something and pass unseen.
   */
  it('counts an unknown producer instead of silently matching', async () => {
    const page = await open(
      liveMap(
        snapshotOf(),
        catalogOf([ORDERS, PAYMENTS], ['OrderPlaced'], ['orders.events']),
      ),
    );

    await emit(page, { name: 'order.placed', producer: 'NobodyDeclaredMe' });

    expect(await statusText(page)).toContain('1 unknown producer');
    expect(await nodeCount(page, 'service:OrdersService')).toBe(0);
    // The event still happened, whoever sent it.
    expect(await nodeCount(page, 'event:OrderPlaced')).toBe(1);

    await page.close();
  }, 20_000);

  /**
   * A map opened before the first event has nothing observed. Freezing the
   * movable set at load left it still forever while reporting itself live.
   */
  it('promotes a never-seen edge when evidence arrives', async () => {
    const page = await open(
      liveMap(
        snapshotOf(),
        catalogOf([ORDERS], ['OrderPlaced'], ['orders.events']),
      ),
    );

    const edge = 'produces:service:OrdersService->event:OrderPlaced';
    expect(await byId(page, edge).count()).toBe(1);
    expect(await stat(page, 'stat-observed')).toBe(0);
    const declaredBefore = await stat(page, 'stat-declared');
    expect(declaredBefore).toBeGreaterThan(0);

    // Nothing may move before there is evidence for it.
    expect(await page.locator('#markers circle').count()).toBe(0);

    await emit(page, {
      name: 'order.placed',
      producer: 'OrdersService',
      channel: 'orders.events',
    });

    expect(await stat(page, 'stat-observed')).toBeGreaterThan(0);
    expect(await stat(page, 'stat-declared')).toBeLessThan(declaredBefore);
    const classes = await byId(page, edge).getAttribute('class');
    expect(classes).toContain('liveness-observed');
    expect(classes).not.toContain('liveness-declared-only');

    await page.close();
  }, 20_000);

  /** An event a catalog declares but nothing sends or receives has no edges. */
  it('updates an event with no relationships at all', async () => {
    const page = await open(
      liveMap(snapshotOf(), catalogOf([], ['OrderPlaced'])),
    );

    await emit(page, { name: 'order.placed' });

    expect(await nodeCount(page, 'event:OrderPlaced')).toBe(1);
    expect(await nodeClass(page, 'event:OrderPlaced')).toContain(
      'liveness-observed',
    );
    // On the map, so not off-map.
    expect(await statusText(page)).not.toContain('off-map');

    await page.close();
  }, 20_000);

  it('reports a genuinely unknown event as off-map', async () => {
    const page = await open(
      liveMap(snapshotOf(), catalogOf([], ['OrderPlaced'])),
    );

    await emit(page, { name: 'something.nobody.declared' });

    expect(await statusText(page)).toContain('1 off-map');
    expect(await nodeCount(page, 'event:OrderPlaced')).toBe(0);

    await page.close();
  }, 20_000);

  /** Stillness is the finding: an edge with no evidence must never move. */
  it('never animates a declared-only edge in replay', async () => {
    const html = renderLiveMapHtml(
      buildLiveMap(
        snapshotOf(),
        catalogOf([ORDERS], ['OrderPlaced'], ['orders.events']),
      ),
      { mode: 'replay' },
    );
    const page = await openStatic(html);

    // Replay schedules on a timer; give it well past the fastest interval.
    await page.waitForTimeout(3000);
    expect(await page.locator('#markers circle').count()).toBe(0);

    await page.close();
  }, 20_000);

  it('survives a malformed frame without breaking the stream', async () => {
    const page = await open(
      liveMap(snapshotOf(), catalogOf([ORDERS], ['OrderPlaced'])),
    );

    await page.evaluate(() => window.__emit('track', 'not json at all'));
    await page.evaluate(() => window.__emit('track', { nameless: true }));

    // Still working afterwards.
    await emit(page, { name: 'order.placed', producer: 'OrdersService' });
    expect(await nodeCount(page, 'event:OrderPlaced')).toBe(1);

    await page.close();
  }, 20_000);
});

declare global {
  interface Window {
    __eventSource?: { listeners: Record<string, Array<(e: unknown) => void>> };
    __emit: (type: string, data: unknown) => void;
  }
}
