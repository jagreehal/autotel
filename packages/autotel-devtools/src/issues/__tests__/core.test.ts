import { createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import {
  buildRequest,
  culpritOf,
  deliver,
  fingerprintOf,
  firesOn,
  groupOccurrences,
  normalizeMessage,
  occurrenceFromLog,
  occurrenceFromTrace,
  type Automation,
  type Destination,
  type IssuePayload,
  type IssueSpanInput,
} from '..';

const stackIn = (dir: string, line: number) =>
  [
    'TypeError: card declined for order 812',
    `    at chargeCard (file://${dir}/src/payments.ts:${line}:11)`,
    `    at async checkout (file://${dir}/src/routes.ts:${line + 10}:3)`,
    '    at async run (file:///app/node_modules/router/index.js:9:3)',
  ].join('\n');

function span(overrides: Partial<IssueSpanInput>): IssueSpanInput {
  return {
    spanId: 's',
    name: 'op',
    service: 'checkout',
    startTime: 1000,
    status: 'OK',
    attributes: {},
    ...overrides,
  };
}

describe('fingerprint', () => {
  it('ignores directories and line numbers, so rebuilds and edits keep the issue', () => {
    const a = fingerprintOf({
      service: 'api',
      type: 'TypeError',
      message: 'card declined for order 1',
      stack: stackIn('/tmp/dev-AAA', 42),
    });
    const b = fingerprintOf({
      service: 'api',
      type: 'TypeError',
      message: 'card declined for order 2',
      stack: stackIn('/tmp/dev-BBB', 97),
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('separates services, and honours an explicit exception.fingerprint', () => {
    const base = { type: 'E', message: 'm', stack: stackIn('/x', 1) };
    expect(fingerprintOf({ ...base, service: 'a' })).not.toBe(
      fingerprintOf({ ...base, service: 'b' }),
    );
    expect(fingerprintOf({ ...base, service: 'a', override: 'mine' })).toBe(
      'mine',
    );
  });

  it('falls back to the normalised message without a stack', () => {
    expect(
      normalizeMessage(
        'user 42 took 412ms (id 3f2a1b4c-1111-2222-3333-444455556666)',
      ),
    ).toBe('user [N] took [N]ms (id [UUID])');
    const fp = (message: string) =>
      fingerprintOf({ service: 's', message, operation: 'GET /x' });
    expect(fp('timeout after 30s')).toBe(fp('timeout after 45s'));
    expect(fp('timeout after 30s')).not.toBe(fp('connection refused'));
  });

  it('names the culprit by function and file only', () => {
    expect(culpritOf(stackIn('/deep/dir', 5))).toBe('chargeCard (payments.ts)');
    expect(culpritOf('Error: x\n    at file:///b/index.js:9:1')).toBe(
      'index.js',
    );
    expect(culpritOf('boom@https://app.example/assets/app.js:1:200')).toBe(
      'boom (app.js)',
    );
  });
});

describe('occurrenceFromTrace', () => {
  it('folds the throw site and the 500 its handler returned into one exception', () => {
    const occurrence = occurrenceFromTrace('t1', [
      span({
        spanId: 'root',
        name: 'GET /pay',
        attributes: {
          'http.response.status_code': 500,
          'user.id': 'u1',
          'service.version': '1.4.2',
        },
      }),
      span({
        spanId: 'mid',
        parentSpanId: 'root',
        name: 'checkout',
        status: 'ERROR',
        attributes: { 'exception.type': 'TypeError' },
      }),
      span({
        spanId: 'leaf',
        parentSpanId: 'mid',
        name: 'payment.charge',
        status: 'ERROR',
        events: [
          {
            name: 'exception',
            attributes: {
              'exception.type': 'TypeError',
              'exception.message': 'card declined',
              'exception.stacktrace': stackIn('/x', 1),
            },
          },
        ],
      }),
    ]);
    expect(occurrence).toMatchObject({
      id: 't1',
      source: 'exception',
      spanId: 'leaf',
      type: 'TypeError',
      message: 'card declined',
      culprit: 'chargeCard (payments.ts)',
      userId: 'u1',
      version: '1.4.2',
    });
  });

  it('classifies handled errors, bare 5xx and autotel detector reports', () => {
    const handled = occurrenceFromTrace('t', [
      span({
        events: [
          {
            name: 'exception',
            attributes: { 'exception.message': 'fallback used' },
          },
        ],
      }),
    ]);
    expect(handled?.source).toBe('handled_exception');

    const bare = occurrenceFromTrace('t', [
      span({ attributes: { 'http.response.status_code': 503 } }),
    ]);
    expect(bare).toMatchObject({ source: 'http_5xx', message: 'HTTP 503' });

    const flood = occurrenceFromTrace('t', [
      span({
        events: [
          {
            name: 'exception',
            attributes: {
              'exception.type': 'autotel.LogFlood',
              'exception.message': '"tick" logged 100+ times in one invocation',
            },
          },
        ],
      }),
    ]);
    expect(flood?.source).toBe('log_flood');
    // Keyed by its template, not autotel's own (release-specific) frame.
    const floodIn = (file: string) =>
      occurrenceFromTrace('t', [
        span({
          events: [
            {
              name: 'exception',
              attributes: {
                'exception.type': 'autotel.LogFlood',
                'exception.message':
                  '"tick" logged 100+ times in one invocation',
                'exception.stacktrace': `Error\n    at logFloodException (file:///app/dist/${file}:1:1)`,
              },
            },
          ],
        }),
      ])!;
    expect(floodIn('native-bridge-AAA.js').fingerprint).toBe(
      floodIn('native-bridge-BBB.js').fingerprint,
    );
    expect(floodIn('x.js').culprit).toBeUndefined();
    expect(
      occurrenceFromTrace('t', [
        span({
          status: 'ERROR',
          attributes: { 'exception.type': 'autotel.RunawayAlarm' },
        }),
      ])?.source,
    ).toBe('runaway_alarm');

    expect(occurrenceFromTrace('t', [span({})])).toBeUndefined();

    // A handled error and then a log flood on one span: the detector wins.
    const both = occurrenceFromTrace('t', [
      span({
        events: [
          {
            name: 'exception',
            attributes: {
              'exception.type': 'Error',
              'exception.message': 'fallback',
            },
          },
          {
            name: 'exception',
            attributes: {
              'exception.type': 'autotel.LogFlood',
              'exception.message': '"x" logged 100+ times in one invocation',
            },
          },
        ],
      }),
    ]);
    expect(both?.source).toBe('log_flood');

    // Backends that flatten the event into span attributes still count.
    expect(
      occurrenceFromTrace('t', [
        span({
          attributes: {
            'exception.type': 'TypeError',
            'exception.message': 'handled',
          },
        }),
      ]),
    ).toMatchObject({ source: 'handled_exception', type: 'TypeError' });
    expect(
      occurrenceFromTrace('t', [
        span({
          attributes: {
            'exception.type': 'autotel.RunawayAlarm',
            'exception.message': 'alarm loop',
          },
        }),
      ])?.source,
    ).toBe('runaway_alarm');
    expect(
      occurrenceFromTrace('t', [
        span({ attributes: { 'cloudflare.outcome': 'exceededCpu' } }),
      ]),
    ).toMatchObject({ source: 'exception', message: 'op failed' });
    expect(
      occurrenceFromTrace('t', [
        span({ attributes: { 'cloudflare.outcome': 'ok' } }),
      ]),
    ).toBeUndefined();
  });
});

describe('occurrenceFromLog', () => {
  it('counts error logs outside a trace only', () => {
    const base = {
      id: '1',
      service: 'worker',
      body: 'queue crashed',
      timestamp: 5,
    };
    expect(occurrenceFromLog({ ...base, severityText: 'ERROR' })).toMatchObject(
      {
        id: 'log:1',
        source: 'error_log',
        message: 'queue crashed',
      },
    );
    expect(occurrenceFromLog({ ...base, severityNumber: 17 })).toBeDefined();
    expect(
      occurrenceFromLog({ ...base, severityText: 'WARN' }),
    ).toBeUndefined();
    expect(
      occurrenceFromLog({ ...base, severityText: 'ERROR', traceId: 'abc' }),
    ).toBeUndefined();
  });
});

describe('groupOccurrences', () => {
  it('counts, trends and flags a return after quiet', () => {
    const occ = (id: string, timestamp: number) =>
      occurrenceFromTrace(id, [
        span({
          status: 'ERROR',
          startTime: timestamp,
          attributes: { 'user.id': id },
        }),
      ])!;
    const [issue] = groupOccurrences(
      [occ('a', 0), occ('b', 10), occ('c', 100), occ('c', 100)],
      { start: 0, end: 120, quietMs: 50, buckets: 4 },
    );
    expect(issue).toMatchObject({
      count: 3,
      trend: [2, 0, 0, 1],
      regression: true,
      affected: { users: 3, accounts: 0, sessions: 0 },
      sampleTraceIds: ['c', 'b', 'a'],
      status: 'active',
    });
  });
});

describe('firesOn', () => {
  const automation = (
    trigger: Automation['trigger'],
    extra: Partial<Automation> = {},
  ): Automation => ({
    id: 'a',
    name: 'a',
    trigger,
    destinationId: 'd',
    enabled: true,
    ...extra,
  });
  const step = { service: 'api', status: 'active' as const, timestamp: 10_000 };

  it('threshold fires only on the crossing occurrence', () => {
    const at3 = automation({ type: 'threshold', count: 3 });
    expect(firesOn(at3, { ...step, previousCount: 1 })).toBe(false);
    expect(firesOn(at3, { ...step, previousCount: 2 })).toBe(true);
    expect(firesOn(at3, { ...step, previousCount: 3 })).toBe(false);
  });

  it('recurrence needs an earlier occurrence and the full quiet period', () => {
    const hourly = automation({ type: 'recurrence', inactiveMs: 1000 });
    expect(firesOn(hourly, { ...step, previousCount: 0 })).toBe(false);
    expect(
      firesOn(hourly, { ...step, previousCount: 4, previousLastSeen: 9500 }),
    ).toBe(false);
    expect(
      firesOn(hourly, { ...step, previousCount: 4, previousLastSeen: 9000 }),
    ).toBe(true);
  });

  it('skips ignored issues, disabled automations and other services', () => {
    const once = automation({ type: 'threshold', count: 1 });
    const first = { ...step, previousCount: 0 };
    expect(firesOn(once, { ...first, status: 'ignored' })).toBe(false);
    expect(firesOn({ ...once, enabled: false }, first)).toBe(false);
    expect(firesOn({ ...once, services: ['web'] }, first)).toBe(false);
    expect(firesOn({ ...once, services: ['api'] }, first)).toBe(true);
  });
});

const payload: IssuePayload = {
  trigger: 'threshold',
  issue: groupOccurrences(
    [
      occurrenceFromTrace('trace-1', [
        span({
          status: 'ERROR',
          attributes: {
            'exception.type': 'TypeError',
            'exception.message': 'card declined',
            'exception.stacktrace': stackIn('/x', 1),
          },
        }),
      ])!,
    ],
    { start: 0, end: 2000, quietMs: 1000 },
  )[0]!,
  url: 'http://127.0.0.1:4318/?issue=x',
};

describe('buildRequest', () => {
  it('Claude Code: the routine /fire endpoint with the brief as text', async () => {
    const request = await buildRequest(
      {
        type: 'claude-code',
        id: 'c',
        name: 'c',
        routineId: 'trig_1',
        token: 'sk-ant-oat01-x',
      },
      payload,
    );
    expect(request.url).toBe(
      'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire',
    );
    expect(request.headers).toMatchObject({
      authorization: 'Bearer sk-ant-oat01-x',
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'anthropic-version': '2023-06-01',
    });
    const { text } = JSON.parse(request.body) as { text: string };
    expect(text).toContain('TypeError: card declined');
    expect(text).toContain('chargeCard (payments.ts)');
    expect(text).toContain('Stack trace:');
  });

  it('Devin v3 session, Slack message, PagerDuty event, Cursor webhook', async () => {
    const devin = await buildRequest(
      {
        type: 'devin',
        id: 'd',
        name: 'd',
        orgId: 'org 1',
        token: 'cog_x',
        repos: ['acme/api'],
        playbookId: 'pb',
      },
      payload,
    );
    expect(devin.url).toBe(
      'https://api.devin.ai/v3/organizations/org%201/sessions',
    );
    expect(JSON.parse(devin.body)).toMatchObject({
      repos: ['acme/api'],
      playbook_id: 'pb',
    });

    const slack = await buildRequest(
      { type: 'slack', id: 's', name: 's', url: 'https://hooks.slack.com/x' },
      payload,
    );
    expect(JSON.parse(slack.body).text).toContain('*TypeError: card declined*');

    const pd = JSON.parse(
      (
        await buildRequest(
          { type: 'pagerduty', id: 'p', name: 'p', routingKey: 'rk' },
          payload,
        )
      ).body,
    );
    expect(pd).toMatchObject({
      routing_key: 'rk',
      event_action: 'trigger',
      dedup_key: `autotel-issue-${payload.issue.fingerprint}`,
    });

    const cursor = await buildRequest(
      {
        type: 'cursor',
        id: 'u',
        name: 'u',
        url: 'https://api.cursor.com/hook',
        authorization: 'Bearer k',
      },
      payload,
    );
    expect(cursor.headers.authorization).toBe('Bearer k');
    expect(JSON.parse(cursor.body).issue.fingerprint).toBe(
      payload.issue.fingerprint,
    );
  });

  it('signs webhooks so the receiver can verify body and timestamp', async () => {
    const request = await buildRequest(
      {
        type: 'webhook',
        id: 'w',
        name: 'w',
        url: 'https://example.com/hook',
        secret: 's3cret',
      },
      payload,
      1_700_000_000_000,
    );
    const timestamp = request.headers['x-autotel-timestamp'];
    expect(timestamp).toBe('1700000000');
    const expected = createHmac('sha256', 's3cret')
      .update(`${timestamp}.${request.body}`)
      .digest('hex');
    expect(request.headers['x-autotel-signature']).toBe(`sha256=${expected}`);
  });
});

describe('deliver', () => {
  const webhook: Destination = {
    type: 'webhook',
    id: 'w',
    name: 'w',
    url: 'https://example.com',
  };

  it('retries server errors and network failures, up to three attempts', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await expect(
      deliver(webhook, payload, { fetch, backoffMs: 0 }),
    ).resolves.toEqual({
      ok: true,
      attempts: 3,
      status: 200,
    });
  });

  it('does not retry a refusal, and reports the last failure', async () => {
    const refused = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('', { status: 401 }));
    expect(
      await deliver(webhook, payload, { fetch: refused, backoffMs: 0 }),
    ).toMatchObject({
      ok: false,
      attempts: 1,
      status: 401,
    });
    const down = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('', { status: 503 }));
    expect(
      await deliver(webhook, payload, { fetch: down, backoffMs: 0 }),
    ).toMatchObject({
      ok: false,
      attempts: 3,
    });
  });
});
