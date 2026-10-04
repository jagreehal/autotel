import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareBackend, rowsToTraces, rowToLog } from './index';

// Row shapes as Cloudflare's SQL API returned them (Oct 2026), trimmed.
const ROOT = {
  traceId: 'd1a69dd815f98110b4ed9b07d4bb40f4',
  spanId: '37ce944d',
  parentSpanId: '',
  spanName: 'GET',
  serviceName: 'probe',
  startTime: '2026-10-04 08:14:59.583',
  durationMs: 321,
  httpStatus: 500,
  error: "Cannot read properties of undefined (reading 'traceId')",
  sampleInterval: 1,
  attributes: { 'cloudflare.ray_id': 'a452bc74ea480c36' },
};
const CHILD = {
  ...ROOT,
  spanId: '8d2f349c',
  parentSpanId: '37ce944d',
  spanName: 'otel.api.active',
  httpStatus: null,
  error: '',
  sampleInterval: 10,
  attributes: { 'lib.attr': 1 },
};

type Body = {
  query: string;
  params: Record<string, string>;
  time_range: { start: string; end: string };
};

function stubSql(respond: (body: Body) => Response) {
  const bodies: Body[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      // SAFETY: the backend under test built this body with these fields.
      const body = JSON.parse(String(init.body)) as Body;
      bodies.push(body);
      return respond(body);
    }),
  );
  return bodies;
}

const json = (data: unknown[]) => Response.json({ data, rows: data.length });
const backend = () =>
  new CloudflareBackend({ accountId: 'acct', apiToken: 'tok' });

afterEach(() => vi.unstubAllGlobals());

describe('CloudflareBackend', () => {
  it('maps rows: zone-less UTC times, empty parent, error text, sampling', () => {
    const [trace] = rowsToTraces([ROOT, CHILD]);
    const [root, child] = trace!.spans;
    expect(root).toMatchObject({
      parentSpanId: null,
      startTimeUnixMs: Date.parse('2026-10-04T08:14:59.583Z'),
      hasError: true,
      statusCode: 'ERROR',
    });
    expect(root!.tags['otel.status_description']).toBe(ROOT.error);
    expect(root!.tags['http.response.status_code']).toBe(500);
    expect(child).toMatchObject({ parentSpanId: '37ce944d', hasError: false });
    expect(child!.tags['cloudflare.sample_interval']).toBe(10);
    expect(root!.tags['cloudflare.sample_interval']).toBeUndefined();
  });

  it('binds caller input as parameters and always sends a time range', async () => {
    const bodies = stubSql(() => json([]));
    await backend().searchTraces({ service: "x' OR 1=1 --", limit: 5 });
    expect(bodies[0]!.query).not.toContain("x'");
    expect(bodies[0]!.params.service).toBe("x' OR 1=1 --");
    expect(bodies[0]!.time_range.start).toMatch(/Z$/);
  });

  it('hydrates matched traces in a tight window, not the search window', async () => {
    const bodies = stubSql((body) =>
      json(
        body.query.startsWith('SELECT traceId, startTime')
          ? [ROOT]
          : [ROOT, CHILD],
      ),
    );
    const week = Date.now() - 7 * 86_400_000;
    const result = await backend().searchTraces({ startTimeUnixMs: week });
    expect(result.items[0]!.spans).toHaveLength(2);
    const hydrate = bodies[1]!.time_range;
    expect(
      Date.parse(hydrate.end) - Date.parse(hydrate.start),
    ).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
  });

  it("surfaces the API's own explanation of a bad query", async () => {
    stubSql(
      () =>
        new Response('Input was invalid: Schema error: No field named nope.', {
          status: 422,
        }),
    );
    await expect(backend().listServices()).rejects.toThrow(
      /No field named nope/,
    );
  });

  it('maps a Workers log row, keeping the ray id', () => {
    expect(
      rowToLog({
        timestamp: '2026-10-04 08:14:59.676',
        level: 'info',
        message: 'GET /api',
        scriptName: 'probe',
        traceId: ROOT.traceId,
        spanId: '',
        rayId: 'a452bc74ea480c36',
        attributes: {},
      }),
    ).toEqual({
      timestampUnixMs: Date.parse('2026-10-04T08:14:59.676Z'),
      severityText: 'INFO',
      body: 'GET /api',
      serviceName: 'probe',
      traceId: ROOT.traceId,
      attributes: { 'cloudflare.ray_id': 'a452bc74ea480c36' },
    });
  });
});
