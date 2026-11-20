import {
  logs,
  metrics,
  type LogRecord,
  type MeterProvider,
} from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider as SdkMeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContract } from './contract.js';
import { checkRecords } from './profile.js';
import {
  ContractViolationError,
  createContractGuard,
  recordReports,
} from './runtime.js';
import { customersYaml } from './__fixtures__/index.js';

const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
const reader = new PeriodicExportingMetricReader({
  exporter,
  exportIntervalMillis: 60_000,
});
const provider = new SdkMeterProvider({ readers: [reader] });
metrics.setGlobalMeterProvider(provider as unknown as MeterProvider);
const emitted: LogRecord[] = [];
logs.setGlobalLoggerProvider({
  getLogger: () => ({ emit: (r: LogRecord) => void emitted.push(r) }),
} as never);
afterAll(() => provider.shutdown());

const { contract } = parseContract(customersYaml);
const NOW = Date.parse('2026-11-19T12:00:00Z');
const good = {
  customer_id: 'c1',
  customer_name: 'A',
  annual_premium: 1,
  customer_status: 'active',
  last_updated_at: '2026-11-19T11:00:00Z',
};

/** Everything recorded since the last flush (delta temporality), looked up by metric name. */
async function flush() {
  exporter.reset();
  await reader.forceFlush();
  const all = exporter
    .getMetrics()
    .flatMap((r) => r.scopeMetrics)
    .flatMap((s) => s.metrics);
  return (name: string) =>
    (all.find((x) => x.descriptor.name === name)?.dataPoints ?? []).map(
      (p): Record<string, unknown> => ({ ...p.attributes, value: p.value }),
    );
}
const points = async (name: string) => (await flush())(name);

beforeEach(async () => {
  emitted.length = 0;
  exporter.reset();
  await reader.forceFlush();
});

describe('createContractGuard', () => {
  it('counts records and violations by contract path, never by payload key or value', async () => {
    const { contract: nested } = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'o',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 'order',
          properties: [
            {
              name: 'address',
              logicalType: 'object',
              properties: [{ name: 'city', logicalType: 'string' }],
            },
            {
              name: 'lines',
              logicalType: 'array',
              items: {
                logicalType: 'object',
                properties: [{ name: 'qty', logicalType: 'integer' }],
              },
            },
          ],
        },
      ],
    });
    const guard = createContractGuard(nested, { object: 'order' });
    guard.check({
      address: { city: 'x', 'alex@example.com': 1 },
      lines: [{ qty: 1 }, { qty: 'two', ['k' + Math.random()]: 1 }],
      ['top' + Math.random()]: 1,
    });
    const violations = await points('datacontract.violations');
    const props = violations
      .map((v) => v['datacontract.violation.property'])
      .toSorted();
    expect(props).toEqual([
      '(undeclared)',
      'address.(undeclared)',
      'lines[].(undeclared)',
      'lines[].qty',
    ]);
    const events = emitted
      .map((r) => r.attributes?.['datacontract.violation.property'])
      .toSorted();
    expect(events).toEqual(props);
    expect(JSON.stringify(emitted)).not.toMatch(/alex@|two|top0|k0/);
    expect(emitted[0]).toMatchObject({ eventName: 'datacontract.violation' });
  });

  it('a leap-second timestamp the validator accepts establishes freshness', () => {
    const leap = Date.parse('2016-12-31T23:59:59Z') + 1000;
    const guard = createContractGuard(contract, {
      object: 'customers',
      now: () => leap + 10_000,
    });
    expect(
      guard.check({ ...good, last_updated_at: '2016-12-31T23:59:60Z' }),
    ).toEqual([]);
    expect(guard.checkSla()[0]).toMatchObject({ status: 'kept' });
  });

  it('records the outcome of every record', async () => {
    const guard = createContractGuard(contract, {
      object: 'customers',
      now: () => NOW,
    });
    guard.check(good);
    guard.check({ ...good, customer_status: 'frozen' });
    guard.check({ ...good, extra: 1 });
    const records = await points('datacontract.records');
    expect(
      records.map((p) => `${p['datacontract.outcome']}:${p.value}`).toSorted(),
    ).toEqual(['invalid:1', 'valid:1', 'variant:1']);
  });

  it('records one freshness outcome per scheduled check, breached when the feed stops', async () => {
    let now = NOW;
    const guard = createContractGuard(contract, {
      object: 'customers',
      now: () => now,
    });
    expect(guard.checkSla()[0]?.passed).toBe(false); // nothing has arrived yet
    for (let i = 0; i < 50; i++) guard.check(good); // a busy window
    expect(guard.checkSla()[0]?.passed).toBe(true);
    now += 2 * 86_400_000; // the feed stops for two days
    expect(guard.checkSla()[0]?.passed).toBe(false);
    const checks = await points('datacontract.sla.checks');
    const outcomes = checks
      .map((p) => `${p['datacontract.outcome']}:${p.value}`)
      .toSorted();
    expect(outcomes).toEqual(['breached:2', 'kept:1']); // three windows, three outcomes, whatever the traffic
  });

  it('holds bad data back in throw mode', () => {
    const guard = createContractGuard(contract, {
      object: 'customers',
      mode: 'throw',
    });
    expect(() => guard.check({ ...good, annual_premium: -1 })).toThrow(
      ContractViolationError,
    );
    expect(() => guard.check({ ...good, extra: 1 })).not.toThrow(); // a variance, not a broken promise
  });
});

describe('recordReports', () => {
  it('turns a scheduled audit into audit, quality and SLA outcomes', async () => {
    recordReports(
      contract,
      checkRecords(contract, 'customers', [good], { now: () => NOW }),
    );
    const got = await flush();
    expect(got('datacontract.audits')[0]).toMatchObject({
      'datacontract.outcome': 'incomplete',
    });
    const quality = got('datacontract.quality.checks').map(
      (p) => `${p['datacontract.rule']}:${p['datacontract.outcome']}`,
    );
    expect(quality).toEqual(
      expect.arrayContaining([
        'sql:not-run',
        'customer_id:duplicateValues:passed',
      ]),
    );
    expect(
      got('datacontract.sla.checks')
        .map((p) => `${p['datacontract.sla']}:${p['datacontract.outcome']}`)
        .toSorted(),
    ).toEqual(['freshness:kept', 'retention:unknown']);
  });
});

describe('freshness watermark', () => {
  const future = '2026-11-20T12:00:00Z';

  it('is not moved by a rejected record, even a future-dated one', () => {
    const guard = createContractGuard(contract, {
      object: 'customers',
      mode: 'throw',
      now: () => NOW,
    });
    expect(() =>
      guard.check({
        ...good,
        customer_name: undefined,
        last_updated_at: future,
      }),
    ).toThrow(ContractViolationError);
    expect(guard.checkSla()[0]).toMatchObject({
      passed: false,
      observedMs: undefined,
    });
  });

  it('is not moved by an invalid record in record mode', () => {
    const guard = createContractGuard(contract, {
      object: 'customers',
      now: () => NOW,
    });
    guard.check({ ...good, annual_premium: -1 });
    expect(guard.checkSla()[0]?.passed).toBe(false);
  });

  it('ignores a valid record dated beyond the clock-skew allowance, and accepts one within it', () => {
    const guard = createContractGuard(contract, {
      object: 'customers',
      now: () => NOW,
    });
    guard.check({ ...good, last_updated_at: future });
    expect(guard.checkSla()[0]?.passed).toBe(false);
    guard.check({
      ...good,
      last_updated_at: new Date(NOW + 60_000).toISOString(),
    });
    expect(guard.checkSla()[0]).toMatchObject({ passed: true, observedMs: 0 });
  });
});

describe('span attributes', () => {
  it('writes outcome and violation count together on every check', async () => {
    const { trace } = await import('@opentelemetry/api');
    const attrs: Record<string, unknown> = {};
    const span = {
      setAttributes: (a: Record<string, unknown>) => Object.assign(attrs, a),
    };
    const spy = vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span as never);
    const guard = createContractGuard(contract, {
      object: 'customers',
      now: () => NOW,
    });
    guard.check({ ...good, annual_premium: -1, customer_status: 'frozen' });
    expect(attrs).toMatchObject({
      'datacontract.outcome': 'invalid',
      'datacontract.violations': 2,
    });
    guard.check(good);
    expect(attrs).toMatchObject({
      'datacontract.outcome': 'valid',
      'datacontract.violations': 0,
    });
    spy.mockRestore();
  });
});
