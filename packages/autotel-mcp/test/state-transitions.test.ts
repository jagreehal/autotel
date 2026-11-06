import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { DatadogBackend } from '../src/backends/datadog/index';
import { FixtureBackend } from '../src/backends/fixture/index';
import type { TelemetryBackend } from '../src/backends/telemetry';
import { registerSignalTools } from '../src/tools/signals';
import type { LogRecord, MetricSeries } from '../src/types';
import { installFetch } from './helpers/fetch';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const fixturePath = (name: string) =>
  new URL(`../fixtures/${name}.json`, import.meta.url).pathname;

/**
 * The fixture with its metric points moved to now. They are stored as offsets
 * from ten minutes ago, so a negative one falls before the default window.
 */
function fixture(): FixtureBackend {
  const data = JSON.parse(
    readFileSync(fixturePath('state-transitions'), 'utf8'),
  );
  const base = Date.now() - 10 * 60_000;
  // SAFETY: the fixture file holds MetricSeries in this key.
  for (const series of data.metrics as MetricSeries[]) {
    for (const point of series.points) point.timestampUnixMs += base;
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'state-transitions-'));
  const file = path.join(dir, 'fixture.json');
  writeFileSync(file, JSON.stringify(data));
  return new FixtureBackend(file);
}

type Handler = (input: object) => Promise<{
  content: Array<{ text: string }>;
}>;

/** Calls a tool's registered handler and parses the JSON it answers with. */
async function call(
  backend: TelemetryBackend,
  name: string,
  input: object = {},
  // oxlint-disable-next-line typescript/no-explicit-any -- each test asserts on its own tool's document.
): Promise<any> {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (tool: string, _config: object, handler: Handler) => {
      handlers.set(tool, handler);
    },
  };
  // SAFETY: registerSignalTools only calls registerTool on the server.
  registerSignalTools(server as unknown as McpServer, backend, {
    metrics: true,
    logs: true,
  });
  const result = await handlers.get(name)!(input);
  return JSON.parse(result.content[0]!.text);
}

/** A fixture answering these series and logs, for backend-specific shapes. */
function stub(
  respond: (name: string) => MetricSeries[],
  logs: LogRecord[] = [],
  extra: { unsupported?: boolean; detail?: string } = {},
): TelemetryBackend {
  // SAFETY: the tools under test reach only these members of the backend.
  return {
    kind: 'stub',
    getMetricSeries: async (name: string) => respond(name),
    searchLogs: async () => ({
      items: logs,
      totalCount: logs.length,
      ...extra,
    }),
  } as unknown as TelemetryBackend;
}

/** Timestamps either side of the start of the default 60-minute window. */
const inside = Date.now() - 10 * 60_000;
const before = Date.now() - 90 * 60_000;

function cumulative(points: number[][]): MetricSeries {
  return {
    metricName: 'autotel.state.transitions',
    points: points.map(([timestampUnixMs, value]) => ({
      timestampUnixMs: timestampUnixMs!,
      value: value!,
    })),
    attributes: {
      'state.entity': 'order',
      'state.field': 'status',
      'state.from': 'pending',
      'state.to': 'paid',
    },
  };
}

describe('get_state_transitions', () => {
  it('returns exactly the autotel-transitions document', async () => {
    const document = await call(fixture(), 'get_state_transitions');

    expect(Object.keys(document)).toEqual([
      'spec',
      'window',
      'source',
      'instrumented',
      'transitions',
    ]);
    expect(document).toEqual({
      spec: 'autotel-transitions/v0.1.0',
      window: {
        from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      },
      source: 'fixture',
      instrumented: [
        { entity: 'invoice', field: 'state' },
        { entity: 'order', field: 'status' },
      ],
      transitions: [
        {
          entity: 'order',
          field: 'status',
          from: 'paid',
          to: 'shipped',
          via: 'fulfilment',
          service: 'api',
          // Instance one gained 3, restarted and reached 2; instance two gained 1.
          count: 6,
        },
        {
          entity: 'order',
          field: 'status',
          from: 'pending',
          to: 'paid',
          via: 'checkout',
          service: 'api',
          count: 12,
        },
      ],
    });
  });

  it('sets the window from lookbackMinutes', async () => {
    const { window } = await call(fixture(), 'get_state_transitions', {
      lookbackMinutes: 90,
    });
    expect(Date.parse(window.to) - Date.parse(window.from)).toBe(90 * 60_000);
  });

  it('keeps an entity instrumented when no transition matches', async () => {
    const document = await call(fixture(), 'get_state_transitions', {
      entity: 'invoice',
      from: 'draft',
    });

    expect(document.instrumented).toEqual([
      { entity: 'invoice', field: 'state' },
    ]);
    expect(document.transitions).toEqual([]);
  });

  it('filters by state, entity and service', async () => {
    const byState = await call(fixture(), 'get_state_transitions', {
      from: 'pending',
      to: 'paid',
    });
    expect(byState.transitions).toHaveLength(1);
    expect(byState.instrumented).toHaveLength(2);

    const byService = await call(fixture(), 'get_state_transitions', {
      serviceName: 'billing',
    });
    expect(byService.instrumented).toEqual([
      { entity: 'invoice', field: 'state' },
    ]);
  });

  it('answers empty, not with an error, where nothing is instrumented', async () => {
    const backend = new FixtureBackend(fixturePath('telemetry'));
    const document = await call(backend, 'get_state_transitions');

    expect(document.instrumented).toEqual([]);
    expect(document.transitions).toEqual([]);
  });

  it('reads the Prometheus name and labels', async () => {
    const backend = stub((name) =>
      name === 'autotel_state_transitions_total'
        ? [
            {
              metricName: name,
              points: [
                { timestampUnixMs: before, value: 3 },
                { timestampUnixMs: inside, value: 8 },
              ],
              attributes: {
                service_name: 'api',
                state_entity: 'order',
                state_field: 'status',
                state_from: 'pending',
                state_to: 'paid',
                state_via: 'checkout',
              },
            },
          ]
        : [],
    );

    const { transitions } = await call(backend, 'get_state_transitions');

    expect(transitions).toEqual([
      {
        entity: 'order',
        field: 'status',
        from: 'pending',
        to: 'paid',
        via: 'checkout',
        service: 'api',
        count: 5,
      },
    ]);
  });

  it.each([
    [
      'moved once and stayed there',
      [
        [inside, 3],
        [inside + 1, 3],
      ],
      3,
    ],
    ['exported a single point', [[inside, 4]], 4],
    [
      'ran before the window and went quiet',
      [
        [before, 9],
        [inside, 9],
      ],
      0,
    ],
    [
      'ran before the window and moved',
      [
        [before, 9],
        [inside, 12],
      ],
      3,
    ],
  ])('counts a cumulative series that %s', async (_, points, count) => {
    const backend = stub(() => [cumulative(points)]);

    const { transitions } = await call(backend, 'get_state_transitions');

    expect(transitions).toEqual(
      count === 0 ? [] : [expect.objectContaining({ count })],
    );
  });

  it('fills via and service it cannot read', async () => {
    const backend = stub(() => [cumulative([[inside, 1]])]);

    const { transitions } = await call(backend, 'get_state_transitions');

    expect(transitions).toMatchObject([{ via: 'unknown', service: 'unknown' }]);
  });

  it('ignores delta points from before the window', async () => {
    const backend = stub(() => [
      {
        ...cumulative([
          [before, 50],
          [inside, 2],
        ]),
        temporality: 'delta',
      },
    ]);

    const { transitions } = await call(backend, 'get_state_transitions');

    expect(transitions).toMatchObject([{ count: 2 }]);
  });

  it('leaves out a series with no point in the window', async () => {
    const backend = stub(() => [cumulative([[before, 50]])]);

    const document = await call(backend, 'get_state_transitions');

    expect(document.instrumented).toEqual([]);
    expect(document.transitions).toEqual([]);
  });

  it('reads back far enough to find a baseline', async () => {
    const getMetricSeries = vi.fn().mockResolvedValue([]);
    // SAFETY: only getMetricSeries is reached on the way to this assertion.
    const backend = { kind: 'stub', getMetricSeries } as never;

    await call(backend, 'get_state_transitions', { lookbackMinutes: 30 });

    const [, query] = getMetricSeries.mock.calls[0]!;
    expect(query.endTimeUnixMs - query.startTimeUnixMs).toBe(60 * 60_000);
  });

  it('groups by every state tag on Datadog and sums counts', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        series: [
          {
            metric: 'autotel.state.transitions',
            scope:
              'service:api,state.entity:order,state.field:status,state.from:pending,state.to:paid,state.via:checkout',
            pointlist: [
              [inside, 5],
              [inside + 60_000, null],
              [inside + 120_000, 7],
            ],
          },
        ],
      }),
    });
    installFetch(fetchSpy);
    const backend = new DatadogBackend({
      baseUrl: 'https://api.datadoghq.example',
      apiKey: 'api',
      appKey: 'app',
    });

    const document = await call(backend, 'get_state_transitions', {
      serviceName: 'api',
    });

    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.searchParams.get('query')).toBe(
      'sum:autotel.state.transitions{service:api} by {service,state.entity,state.field,state.from,state.to,state.via}.as_count()',
    );
    expect(document.source).toBe('datadog');
    expect(document.instrumented).toEqual([
      { entity: 'order', field: 'status' },
    ]);
    expect(document.transitions).toEqual([
      {
        entity: 'order',
        field: 'status',
        from: 'pending',
        to: 'paid',
        via: 'checkout',
        service: 'api',
        count: 12,
      },
    ]);
  });

  it('reports a backend failure as an error envelope', async () => {
    const backend = stub(() => {
      throw new Error('upstream down');
    });

    const result = await call(backend, 'get_state_transitions');

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('upstream down');
  });
});

describe('get_entity_history', () => {
  it('returns one instance oldest first', async () => {
    const { data } = await call(fixture(), 'get_entity_history', {
      entity: 'order',
      id: '123',
    });

    expect(data.history).toEqual([
      {
        timestamp: new Date(1793000000000).toISOString(),
        field: 'status',
        from: 'pending',
        to: 'paid',
        via: 'checkout',
        service: 'api',
      },
      {
        timestamp: new Date(1793000060000).toISOString(),
        field: 'status',
        from: 'paid',
        to: 'shipped',
        via: 'fulfilment',
        service: 'api',
        traceId: 'fixture-trace-2',
      },
    ]);
    expect(data.message).toBeUndefined();
  });

  it('says plainly when the backend has no records', async () => {
    const { data } = await call(fixture(), 'get_entity_history', {
      entity: 'order',
      id: 'nope',
    });

    expect(data.history).toEqual([]);
    expect(data.message).toContain('has no state.transition log records');
    expect(data.message).toContain('history: true');
  });

  it('says plainly when the backend cannot search logs', async () => {
    const backend = stub(() => [], [], {
      unsupported: true,
      detail: 'Serves traces only',
    });

    const { data } = await call(backend, 'get_entity_history', {
      entity: 'order',
      id: '123',
    });

    expect(data.history).toEqual([]);
    expect(data.message).toBe(
      'The stub backend cannot search logs, so it has no history for order 123. Serves traces only',
    );
  });

  it('drops records a backend returned without applying the filter', async () => {
    const record = (id: string): LogRecord => ({
      timestampUnixMs: 1,
      severityText: 'INFO',
      body: 'state.transition',
      attributes: { 'state.entity': 'order', 'state.id': id },
    });
    const backend = stub(() => [], [record('123'), record('456')]);

    const { data } = await call(backend, 'get_entity_history', {
      entity: 'order',
      id: '123',
    });

    expect(data.history).toHaveLength(1);
  });

  it('notes a full page, whose oldest records are cut off', async () => {
    const records = Array.from({ length: 1000 }, (_, index): LogRecord => ({
      timestampUnixMs: index,
      severityText: 'INFO',
      body: 'state.transition',
      attributes: { 'state.entity': 'order', 'state.id': '123' },
    }));

    const { data } = await call(
      stub(() => [], records),
      'get_entity_history',
      {
        entity: 'order',
        id: '123',
      },
    );

    expect(data.hint).toContain('newest 1000');
  });
});
