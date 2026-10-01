/**
 * Issues end to end over HTTP: OTLP in, grouped issues out, status changes,
 * destinations with redacted credentials, automations that fire exactly when
 * Cloudflare's rules say, manual sends, and recorded runs.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachDevtoolsRoutes } from '../http';
import { DevtoolsServer } from '../server';

let server: Server | null = null;
let devtools: DevtoolsServer | null = null;

afterEach(async () => {
  if (devtools) await devtools.close();
  server = null;
  devtools = null;
});

async function start(fetchImpl: typeof fetch = vi.fn()) {
  server = createServer();
  devtools = new DevtoolsServer({
    server,
    issueFetch: fetchImpl,
    issueBackoffMs: 0,
    retentionIntervalMs: 0,
  });
  attachDevtoolsRoutes(server, devtools);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const api = async (
    path: string,
    init?: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    },
  ) => {
    const res = await fetch(`${base}${path}`, {
      method: init?.method ?? (init?.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...init?.headers },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, any>,
    };
  };
  return { base, api, devtools: devtools! };
}

const nano = (ms: number) => String(BigInt(Math.round(ms)) * 1_000_000n);
let counter = 0;
const hex = (n: number, len: number) => n.toString(16).padStart(len, '0');

async function fail(
  base: string,
  opts: { at?: number; user?: string; traceId?: string; message?: string } = {},
) {
  counter += 1;
  const at = opts.at ?? Date.now();
  const traceId = opts.traceId ?? hex(counter, 32);
  const body = JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'api' } },
            { key: 'service.version', value: { stringValue: '1.4.2' } },
          ],
        },
        scopeSpans: [
          {
            scope: {},
            spans: [
              {
                traceId,
                spanId: hex(counter * 2, 16),
                name: 'POST /pay',
                kind: 2,
                startTimeUnixNano: nano(at),
                endTimeUnixNano: nano(at + 5),
                status: {
                  code: 2,
                  message: opts.message ?? 'card declined for 42',
                },
                attributes: [
                  {
                    key: 'http.response.status_code',
                    value: { intValue: 500 },
                  },
                  { key: 'user.id', value: { stringValue: opts.user ?? 'u1' } },
                ],
                events: [
                  {
                    name: 'exception',
                    timeUnixNano: nano(at + 4),
                    attributes: [
                      {
                        key: 'exception.type',
                        value: { stringValue: 'TypeError' },
                      },
                      {
                        key: 'exception.message',
                        value: {
                          stringValue: opts.message ?? 'card declined for 42',
                        },
                      },
                      {
                        key: 'exception.stacktrace',
                        value: {
                          stringValue:
                            'TypeError: card declined\n    at chargeCard (file:///app/src/payments.ts:3:9)',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const res = await fetch(`${base}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  expect(res.status).toBe(200);
  return traceId;
}

describe('issues API', () => {
  it('groups occurrences into one issue, idempotently', async () => {
    const { base, api } = await start();
    const traceId = await fail(base, { user: 'u1' });
    await fail(base, { traceId, user: 'u1' }); // exporter retry of the same trace
    await fail(base, { user: 'u2', message: 'card declined for 99' });

    const { body } = await api('/api/issues');
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0]).toMatchObject({
      service: 'api',
      source: 'exception',
      type: 'TypeError',
      culprit: 'chargeCard (payments.ts)',
      status: 'active',
      count: 2,
      versions: ['1.4.2'],
      affected: { users: 2 },
    });

    const detail = await api(`/api/issues/${body.issues[0].fingerprint}`);
    expect(detail.body.issue.latestStack).toContain('chargeCard');
    expect(detail.body.trace.spans[0].name).toBe('POST /pay');
    expect(detail.body.occurrences).toHaveLength(2);
  });

  it('resolve → a newer occurrence reopens; ignore sticks', async () => {
    const { base, api } = await start();
    await fail(base, { at: Date.now() - 60_000 });
    const [issue] = (await api('/api/issues')).body.issues;
    const fp = issue.fingerprint;

    expect(
      (await api(`/api/issues/${fp}/status`, { body: { status: 'resolved' } }))
        .status,
    ).toBe(200);
    expect((await api('/api/issues?status=resolved')).body.issues).toHaveLength(
      1,
    );
    // A late batch from before the resolve does not reopen it.
    await fail(base, { at: Date.now() - 120_000 });
    expect((await api(`/api/issues/${fp}`)).body.issue.status).toBe('resolved');

    await fail(base, { at: Date.now() + 1000 });
    expect((await api(`/api/issues/${fp}`)).body.issue.status).toBe('active');

    await api(`/api/issues/${fp}/status`, { body: { status: 'ignored' } });
    await fail(base, { at: Date.now() + 2000 });
    expect((await api(`/api/issues/${fp}`)).body.issue.status).toBe('ignored');

    expect(
      (await api(`/api/issues/${fp}/status`, { body: { status: 'nope' } }))
        .status,
    ).toBe(400);
    expect((await api('/api/issues/missing')).status).toBe(404);
  });

  it('keeps destination credentials server-side, even across edits', async () => {
    const { api, devtools } = await start();
    const saved = await api('/api/issue-destinations', {
      body: {
        type: 'claude-code',
        name: 'Fixer',
        routineId: 'trig_1',
        token: 'sk-ant-oat01-secret',
      },
    });
    expect(saved.body.destination.token).toBe('••••');
    const id = saved.body.destination.id;

    const listed = await api('/api/issue-destinations');
    expect(JSON.stringify(listed.body)).not.toContain('sk-ant-oat01-secret');

    // The UI edits the name and posts back the redacted token it was shown.
    await api('/api/issue-destinations', {
      body: { ...listed.body.destinations[0], name: 'Renamed' },
    });
    expect(devtools.issueStore.getDestination(id)).toMatchObject({
      name: 'Renamed',
      token: 'sk-ant-oat01-secret',
    });

    expect(
      (
        await api('/api/issue-destinations', {
          body: { type: 'webhook', url: 'http://evil.example/x' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('/api/issue-destinations', {
          body: { type: 'devin', orgId: 'o' },
        })
      ).status,
    ).toBe(400);
  });

  it('never returns webhook headers or URL tokens, and keeps them across edits', async () => {
    const { api, devtools } = await start();
    const saved = await api('/api/issue-destinations', {
      body: {
        type: 'webhook',
        name: 'ops',
        url: 'https://hooks.example/in?token=t0p-s3cret&team=core',
        headers: {
          Authorization: 'Bearer hdr-s3cret',
          'X-Api-Key': 'key-s3cret',
        },
      },
    });
    const listed = await api('/api/issue-destinations');
    for (const body of [saved.body, listed.body]) {
      expect(JSON.stringify(body)).not.toMatch(/s3cret/);
    }
    const shown = listed.body.destinations[0];
    expect(Object.keys(shown.headers)).toEqual(['Authorization', 'X-Api-Key']);

    // Edit: rename, change one header, keep the other redacted, add one.
    await api('/api/issue-destinations', {
      body: {
        ...shown,
        name: 'ops renamed',
        headers: {
          ...shown.headers,
          'X-Api-Key': 'key-rotated',
          'X-Team': 'core',
        },
      },
    });
    expect(
      devtools.issueStore.getDestination(saved.body.destination.id),
    ).toMatchObject({
      name: 'ops renamed',
      url: 'https://hooks.example/in?token=t0p-s3cret&team=core',
      headers: {
        Authorization: 'Bearer hdr-s3cret',
        'X-Api-Key': 'key-rotated',
        'X-Team': 'core',
      },
    });
  });

  it('runs a threshold automation once, records the run, and sends on demand', async () => {
    const sent: Array<{
      url: string;
      body: any;
      headers: Record<string, string>;
    }> = [];
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          headers: init?.headers as Record<string, string>,
        });
        return new Response('{}', { status: 200 });
      },
    );
    const { base, api, devtools } = await start(
      fetchMock as unknown as typeof fetch,
    );
    const destination = (
      await api('/api/issue-destinations', {
        body: {
          type: 'webhook',
          name: 'hook',
          url: 'https://hooks.example/issues',
          secret: 'shh',
        },
      })
    ).body.destination;
    const automation = await api('/api/issue-automations', {
      body: {
        name: 'three strikes',
        trigger: { type: 'threshold', count: 3 },
        destinationId: destination.id,
      },
    });
    expect(automation.status).toBe(200);

    for (let i = 0; i < 5; i += 1) await fail(base, { user: `u${i}` });
    await devtools.issueEngine.idle();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://hooks.example/issues');
    expect(sent[0]!.body).toMatchObject({
      trigger: 'threshold',
      issue: { count: 3 },
    });
    expect(sent[0]!.headers['x-autotel-signature']).toMatch(
      /^sha256=[0-9a-f]{64}$/,
    );

    const fp = sent[0]!.body.issue.fingerprint;
    const runs = (await api(`/api/issue-runs?fingerprint=${fp}`)).body.runs;
    expect(runs).toMatchObject([
      { trigger: 'threshold', status: 'succeeded', attempts: 1 },
    ]);

    const manual = await api(`/api/issues/${fp}/send`, {
      body: { destinationId: destination.id },
    });
    expect(manual.body.run).toMatchObject({
      trigger: 'manual',
      status: 'succeeded',
    });
    expect(sent).toHaveLength(2);

    expect(
      (
        await api('/api/issue-automations', {
          body: {
            trigger: { type: 'recurrence', inactiveMs: 5 },
            destinationId: destination.id,
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(`/api/issue-destinations/${destination.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(400);
  });

  it('runs a recurrence automation when an issue returns after the quiet period', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    const { base, api, devtools } = await start(
      fetchMock as unknown as typeof fetch,
    );
    const destination = (
      await api('/api/issue-destinations', {
        body: { type: 'slack', url: 'https://hooks.slack.com/services/x' },
      })
    ).body.destination;
    await api('/api/issue-automations', {
      body: {
        trigger: { type: 'recurrence', inactiveMs: 3_600_000 },
        destinationId: destination.id,
      },
    });
    const now = Date.now();
    await fail(base, { at: now - 3 * 3_600_000 });
    await fail(base, { at: now - 3 * 3_600_000 + 1000 });
    await devtools.issueEngine.idle();
    expect(fetchMock).not.toHaveBeenCalled();

    await fail(base, { at: now });
    await devtools.issueEngine.idle();
    // Destination down: three attempts, then a failed run on record.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const runs = (await api('/api/issue-runs')).body.runs;
    expect(runs).toMatchObject([
      {
        trigger: 'recurrence',
        status: 'failed',
        attempts: 3,
        error: 'HTTP 500',
      },
    ]);
  });

  it('counts error logs outside traces', async () => {
    const { base, api } = await start();
    await fetch(`${base}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'worker' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: nano(Date.now()),
                    severityText: 'ERROR',
                    severityNumber: 17,
                    body: { stringValue: 'queue consumer crashed' },
                  },
                  {
                    timeUnixNano: nano(Date.now()),
                    severityText: 'INFO',
                    severityNumber: 9,
                    body: { stringValue: 'fine' },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    const { body } = await api('/api/issues');
    expect(body.issues).toMatchObject([
      {
        service: 'worker',
        source: 'error_log',
        message: 'queue consumer crashed',
      },
    ]);
  });

  it('every stored issue is in the Errors tab too, live and windowed', async () => {
    const { base, api, devtools } = await start();
    const now = Date.now();
    await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'api' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'f1'.repeat(16),
                    spanId: 'f1'.repeat(8),
                    name: 'GET /items',
                    startTimeUnixNano: nano(now),
                    endTimeUnixNano: nano(now + 5),
                    status: { code: 1 },
                    events: [
                      {
                        name: 'exception',
                        timeUnixNano: nano(now + 1),
                        attributes: [
                          {
                            key: 'exception.type',
                            value: { stringValue: 'autotel.LogFlood' },
                          },
                          {
                            key: 'exception.message',
                            value: {
                              stringValue:
                                '"item <n>" logged 100+ times in one invocation',
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    await fetch(`${base}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'worker' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: nano(now),
                    severityText: 'ERROR',
                    severityNumber: 17,
                    body: { stringValue: 'queue consumer crashed' },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    const stored = (await api('/api/issues')).body.issues
      .map((i: { fingerprint: string }) => i.fingerprint)
      .sort();
    const live = devtools
      .getCurrentData()
      .errors.map((g) => g.fingerprint)
      .sort();
    expect(live).toEqual(stored);
    expect(stored).toHaveLength(2);

    const windowed = await api('/api/query/errors', {
      body: { query: '', window: { start: now - 60_000, end: now + 60_000 } },
    });
    expect(
      windowed.body.errors.map((g: { source: string }) => g.source).sort(),
    ).toEqual(['error_log', 'log_flood']);
  });

  it('windowed errors count every error log, by the shared severity rules', async () => {
    const { base, api } = await start();
    const now = Date.now();
    const records = [
      // Text-only severity: no severityNumber at all.
      {
        timeUnixNano: nano(now),
        severityText: 'ERROR',
        body: { stringValue: 'text only' },
      },
      ...Array.from({ length: 1100 }, (_, i) => ({
        timeUnixNano: nano(now + i),
        severityText: 'ERROR',
        severityNumber: 17,
        body: { stringValue: `disk full on node ${i}` },
      })),
    ];
    await fetch(`${base}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'worker' } },
              ],
            },
            scopeLogs: [{ logRecords: records }],
          },
        ],
      }),
    });
    const windowed = await api('/api/query/errors', {
      body: { query: '', window: { start: now - 60_000, end: now + 60_000 } },
    });
    const byMessage = Object.fromEntries(
      windowed.body.errors.map((g: { message: string; count: number }) => [
        g.message.replace(/\d+/, 'N'),
        g.count,
      ]),
    );
    expect(byMessage).toEqual({ 'text only': 1, 'disk full on node N': 1100 });
  });

  it('refuses cross-origin callers', async () => {
    const { api } = await start();
    const res = await api('/api/issues', {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});
