import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevtoolsServer } from '../server';
import { startOtlpGrpcReceiver, type GrpcReceiver } from '../grpc';
import {
  createValidator,
  exportOverGrpc,
  parseWeaverOutput,
  resolveWeaver,
} from '../validation';

// Shapes from weaver's `live-check --format jsonl` output.
const SPAN_LINE = JSON.stringify({
  span: {
    name: 'GET /orders',
    trace_id: 'trace-1',
    span_id: 'span-1',
    resource: { attributes: [{ name: 'service.name', value: 'checkout' }] },
    live_check_result: {
      all_advice: [
        {
          id: 'deprecated',
          level: 'improvement',
          message: 'Uses deprecated attribute',
          context: { attribute_name: 'http.method' },
          signal_type: 'span',
          signal_name: 'GET /orders',
        },
      ],
    },
    attributes: [
      {
        name: 'foo',
        live_check_result: {
          all_advice: [
            {
              id: 'missing_attribute',
              level: 'violation',
              message: 'Attribute does not exist in the registry',
              context: { attribute_name: 'foo' },
            },
          ],
        },
      },
    ],
  },
});
const STATS_LINE = JSON.stringify({
  advice_level_counts: { violation: 2, improvement: 1 },
  highest_advice_level_counts: { violation: 2 },
  total_advisories: 3,
  total_entities: 4,
  no_advice_count: 1,
  total_entities_by_type: { span: 2, metric: 2 },
});

describe('parseWeaverOutput', () => {
  it('counts an entity too large to parse as truncation', () => {
    const huge = `{"span":{"name":"${'x'.repeat(2 * 1024 * 1024)}"}}`;
    const report = parseWeaverOutput([SPAN_LINE, huge, STATS_LINE].join('\n'));
    expect(report.truncated).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it('folds advice into findings, violations first, counted per entity', () => {
    const report = parseWeaverOutput(
      [
        'Weaver Registry Live Check',
        SPAN_LINE,
        SPAN_LINE.replace('span-1', 'span-2'),
        'not json {',
        STATS_LINE,
      ].join('\n'),
    );
    expect(report.entities).toBe(4);
    expect(report.noAdvice).toBe(1);
    expect(report.findings).toEqual([
      {
        level: 'violation',
        id: 'missing_attribute',
        message: 'Attribute does not exist in the registry',
        attribute: 'foo',
        signal: 'span',
        signalName: 'GET /orders',
        count: 2,
      },
      {
        level: 'improvement',
        id: 'deprecated',
        message: 'Uses deprecated attribute',
        attribute: 'http.method',
        signal: 'span',
        signalName: 'GET /orders',
        count: 2,
      },
    ]);
  });

  it('skips advice missing an id, level or message', () => {
    const line = JSON.stringify({
      metric: {
        name: 'm',
        live_check_result: {
          all_advice: [{ id: 'x', level: 'shouting', message: 'm' }],
        },
      },
    });
    expect(parseWeaverOutput(line).findings).toEqual([]);
  });
});

describe('createValidator', () => {
  it('reports unavailable with an install hint when weaver is absent', async () => {
    expect(resolveWeaver({ PATH: '/nonexistent' })).toBeUndefined();
    const validator = createValidator({ resolve: () => undefined });
    expect(validator.get()).toMatchObject({ status: 'unavailable' });
    const result = await validator.run();
    expect(result.status).toBe('unavailable');
    expect(result).toHaveProperty('install');
  });

  it('marks a result stale once telemetry arrives after the run', async () => {
    let clock = 1000;
    const seen: unknown[] = [];
    const validator = createValidator({
      resolve: () => '/bin/weaver',
      now: () => clock,
      run: async (_bin, batches) => {
        seen.push(...batches);
        return {
          stdout: `${SPAN_LINE}\n${STATS_LINE}`,
          outputTruncated: false,
        };
      },
    });
    validator.capture('traces', { resourceSpans: [] });
    clock = 2000;
    const result = await validator.run();
    expect(seen).toHaveLength(1);
    expect(result).toMatchObject({
      status: 'ready',
      stale: false,
      counts: { violation: 1, improvement: 1, information: 0 },
    });
    clock = 3000;
    validator.capture('logs', { resourceLogs: [] });
    expect(validator.get()).toMatchObject({ status: 'ready', stale: true });
  });

  it('reports output past the cap as truncated', async () => {
    const validator = createValidator({
      resolve: () => '/bin/weaver',
      run: async () => ({
        stdout: `${SPAN_LINE}\n${STATS_LINE}`,
        outputTruncated: true,
      }),
    });
    expect(await validator.run()).toMatchObject({
      status: 'ready',
      truncated: true,
    });
  });

  it('holds no telemetry when weaver is not installed', async () => {
    const seen: unknown[] = [];
    const validator = createValidator({
      resolve: () => undefined,
      run: async (_bin, batches) => {
        seen.push(...batches);
        return { stdout: STATS_LINE, outputTruncated: false };
      },
    });
    validator.capture('traces', { resourceSpans: [] });
    expect(seen).toEqual([]);
    expect((await validator.run()).status).toBe('unavailable');
  });

  it("drops one signal's batches when that signal is cleared", async () => {
    const seen: Array<readonly [string, unknown]> = [];
    const validator = createValidator({
      resolve: () => '/bin/weaver',
      run: async (_bin, batches) => {
        seen.push(...batches);
        return { stdout: STATS_LINE, outputTruncated: false };
      },
    });
    validator.capture('traces', { resourceSpans: [] });
    validator.capture('logs', { resourceLogs: [] });
    validator.clear('traces');
    await validator.run();
    expect(seen.map(([signal]) => signal)).toEqual(['logs']);
  });

  it('keeps the newest batches within its own byte cap', async () => {
    const seen: unknown[] = [];
    const validator = createValidator({
      resolve: () => '/bin/weaver',
      run: async (_bin, batches) => {
        seen.push(...batches);
        return { stdout: STATS_LINE, outputTruncated: false };
      },
    });
    const big = (n: number) => ({
      resourceLogs: [],
      pad: String(n).repeat(20 * 1024 * 1024),
    });
    for (const n of [1, 2, 3, 4]) validator.capture('logs', big(n));
    await validator.run();
    // 64 MiB holds three 20 MiB batches: the oldest went first.
    expect(seen.map((b) => (b as [string, { pad: string }])[1].pad[0])).toEqual(
      ['2', '3', '4'],
    );
  });

  it('keeps a failed run as an error, not a crash', async () => {
    const validator = createValidator({
      resolve: () => '/bin/weaver',
      run: async () => {
        throw new Error('weaver exited before listening: boom');
      },
    });
    expect(await validator.run()).toMatchObject({
      status: 'error',
      error: 'weaver exited before listening: boom',
    });
  });
});

describe('exportOverGrpc', () => {
  let devtools: DevtoolsServer | undefined;
  let receiver: GrpcReceiver | undefined;
  afterEach(async () => {
    await receiver?.close();
    await devtools?.close();
  });

  // devtools' own gRPC receiver stands in for weaver's: same OTLP services.
  it('replays OTLP/JSON with hex ids as protobuf a receiver can read', async () => {
    devtools = new DevtoolsServer({
      port: 0,
      host: '127.0.0.1',
      retentionIntervalMs: 0,
    });
    receiver = await startOtlpGrpcReceiver({ devtools, port: 0 });
    const traceId = '0123456789abcdef0123456789abcdef';
    await exportOverGrpc(receiver.address, [
      [
        'traces',
        {
          resourceSpans: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'replayed' } },
                ],
              },
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId,
                      spanId: '0123456789abcdef',
                      name: 'GET /orders',
                      kind: 2,
                      startTimeUnixNano: '1700000000000000000',
                      endTimeUnixNano: '1700000000100000000',
                      attributes: [
                        { key: 'http.method', value: { stringValue: 'GET' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    ]);
    const trace = devtools.getCurrentData().traces[0];
    expect(trace?.traceId).toBe(traceId);
    expect(trace?.spans[0]?.attributes?.['http.method']).toBe('GET');
  });
});

describe('runWeaver exit handling', () => {
  // A stand-in for weaver's admin surface: /health, then /stop, after which it
  // writes its report and exits the way FAKE_WEAVER says.
  const FAKE = `#!/usr/bin/env node
const http = require('node:http');
const args = process.argv;
const port = Number(args[args.indexOf('--admin-port') + 1]);
http.createServer((req, res) => {
  if (req.url === '/health') return res.end('ok');
  res.end('stopping');
  process.stdout.write(${JSON.stringify(SPAN_LINE)} + '\\n');
  if (process.env.FAKE_WEAVER === 'crash') return process.kill(process.pid, 'SIGKILL');
  process.stdout.write(${JSON.stringify(STATS_LINE)} + '\\n', () => process.exit(1));
}).listen(port, '127.0.0.1');
`;
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fake-weaver-'));
    writeFileSync(join(dir, 'weaver'), FAKE, { mode: 0o755 });
  });
  afterEach(() => {
    delete process.env.FAKE_WEAVER;
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts exit 1 after /stop: weaver found violations', async () => {
    const validator = createValidator({ resolve: () => join(dir, 'weaver') });
    expect(await validator.run()).toMatchObject({
      status: 'ready',
      counts: { violation: 1 },
    });
  });

  it('rejects a run that was killed, rather than reporting its fragment', async () => {
    process.env.FAKE_WEAVER = 'crash';
    const validator = createValidator({ resolve: () => join(dir, 'weaver') });
    const result = await validator.run();
    expect(result.status).toBe('error');
    expect(result).toMatchObject({ error: expect.stringContaining('SIGKILL') });
  });
});
