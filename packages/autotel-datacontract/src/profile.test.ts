import { describe, expect, it } from 'vitest';
import { lintContract, parseContract, type QualityRule } from './contract.js';
import { formatReport } from './format.js';
import { checkRecords, inferObject, profileRecords } from './profile.js';
import { customersYaml } from './__fixtures__/index.js';

const { contract } = parseContract(customersYaml);
const NOW = Date.parse('2026-11-19T12:00:00Z');
const row = (i: number, over: Record<string, unknown> = {}) => ({
  customer_id: `c${i}`,
  customer_name: `Name ${i}`,
  annual_premium: 1000 * i,
  customer_status: 'active',
  last_updated_at: '2026-11-19T06:00:00Z',
  ...over,
});

describe('checkRecords', () => {
  it('reports promises broken, variances, gaps, rules and SLAs over a batch', () => {
    const rows = [
      row(1),
      row(2, { customer_status: 'frozen' }),
      row(3, { customer_id: 'c1', annual_premium: '3000' }),
      row(4, { legacy_flag: 'Y' }),
    ];
    const r = checkRecords(contract, 'customers', rows, { now: () => NOW });
    const codes = r.findings.map((f) => `${f.path}:${f.code}:${f.count ?? ''}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'customer_status:invalid-value:1',
        'annual_premium:type-mismatch:1',
        '(undeclared):unknown-field:1',
        'customer_status:undocumented:',
      ]),
    );
    const q = Object.fromEntries(
      r.quality.map((x) => [`${x.property ?? ''}:${x.metric}`, x]),
    );
    expect(q['customer_id:duplicateValues']).toMatchObject({
      value: 1,
      passed: false,
    });
    expect(q['customer_status:invalidValues']).toMatchObject({
      value: 1,
      passed: false,
    });
    expect(q[':sql']?.skipped).toMatch(/database/);
    expect(r.sla).toEqual([
      expect.objectContaining({
        property: 'retention',
        status: 'unknown',
        error: expect.stringMatching(/no element/),
      }),
      {
        property: 'freshness',
        element: 'customers.last_updated_at',
        limitMs: 86_400_000,
        observedMs: 6 * 3_600_000,
        status: 'kept',
        passed: true,
      },
    ]);
    expect(r.passed).toBe(false);
    expect(formatReport(r)).toContain('Broken promises');
  });

  it('flags a declared field the data never carries', () => {
    const r = checkRecords(
      contract,
      'customers',
      [{ customer_id: 'c1', customer_name: 'A', annual_premium: 1 }],
      { now: () => NOW },
    );
    expect(
      r.findings.filter((f) => f.code === 'never-present').map((f) => f.path),
    ).toEqual(['customer_status', 'last_updated_at']);
    expect(r.sla[0]?.passed).toBe(false); // no data breaks a freshness promise
  });
});

describe('profile + infer (data-first)', () => {
  it('drafts types, required and valid values from what the data shows', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: i,
      status: i % 2 ? 'on' : 'off',
      note: i % 3 ? null : 'x',
      amount: i % 2 ? 1.5 : 2,
      mixed: i % 2 ? 'a' : 1,
    }));
    const obj = inferObject('t', profileRecords(rows), {
      observedValues: true,
    });
    const by = Object.fromEntries(obj.properties!.map((p) => [p.name, p]));
    expect(by.id).toMatchObject({ logicalType: 'integer', required: true });
    expect(by.status?.enum).toEqual([{ value: 'off' }, { value: 'on' }]);
    expect(by.note?.required).toBeUndefined();
    expect(by.amount?.logicalType).toBe('number');
    expect(by.mixed?.description).toMatch(/mixed types/);
    expect(by.id?.examples).toEqual([0, 1, 2]);
    const bare = inferObject('t', profileRecords(rows));
    // Observed values stay out of a draft unless asked: they are real data.
    expect(bare.properties!.some((p) => p.examples || p.enum)).toBe(false);
  });
});

describe('report status', () => {
  it('is incomplete, not passed, when a rule that should run did not', () => {
    const fresh = row(1, { last_updated_at: '2026-11-19T11:00:00Z' });
    const r = checkRecords(contract, 'customers', [fresh], { now: () => NOW });
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(r.quality.find((q) => q.metric === 'sql')?.status).toBe('not-run');
    expect(r).toMatchObject({ status: 'incomplete', passed: false });
  });

  it('passes when every executable rule ran and held', () => {
    const c = structuredClone(contract);
    const obj = c.schema![0]!;
    const noSql = (rules?: QualityRule[]) =>
      rules?.filter((r) => r.type !== 'sql');
    obj.quality = noSql(obj.quality);
    for (const p of obj.properties!) p.quality = noSql(p.quality);
    // Retention measured on the element it is about, as it must be to count.
    c.slaProperties = c.slaProperties!.map((s) =>
      s.property === 'retention'
        ? { ...s, element: 'customers.last_updated_at' }
        : s,
    );
    const r = checkRecords(
      c,
      'customers',
      [row(1, { last_updated_at: '2026-11-19T11:00:00Z' })],
      { now: () => NOW },
    );
    expect(r.status).toBe('passed');
  });
});

describe('batch reports stay inside the contract', () => {
  it('names unknown payload keys by contract path only', () => {
    const r = checkRecords(
      contract,
      'customers',
      [row(1, { 'alex@example.com': 1 })],
      { now: () => NOW },
    );
    expect(r.findings.find((f) => f.code === 'unknown-field')?.path).toBe(
      '(undeclared)',
    );
    expect(JSON.stringify(r)).not.toContain('alex@');
  });

  it('judges an allowance at the batch, not per record', () => {
    const c = structuredClone(contract);
    const status = c.schema![0]!.properties!.find(
      (p) => p.name === 'customer_status',
    )!;
    status.quality = [
      {
        metric: 'invalidValues',
        arguments: { validValues: ['active'] },
        mustBeLessOrEqualTo: 1,
      },
    ];
    const r = checkRecords(
      c,
      'customers',
      [row(1), row(2, { customer_status: 'frozen' })],
      { now: () => NOW },
    );
    expect(r.findings.filter((f) => f.code === 'invalid-value')).toEqual([]);
    expect(
      r.quality.find((q) => q.property === 'customer_status'),
    ).toMatchObject({ status: 'passed', value: 1 });
  });

  it('keeps zero-tolerance rules strict per record', () => {
    const r = checkRecords(
      contract,
      'customers',
      [row(1, { customer_status: 'frozen' })],
      { now: () => NOW },
    );
    expect(r.findings.find((f) => f.code === 'invalid-value')).toMatchObject({
      count: 1,
    });
  });

  it('takes freshness only from rows that keep their promises and are not in the future', () => {
    const fresh = '2026-11-19T11:00:00Z';
    const rows = [
      row(1, { last_updated_at: '2026-11-10T00:00:00Z' }),
      row(2, { annual_premium: -1, last_updated_at: fresh }),
      row(3, { last_updated_at: '2027-01-01T00:00:00Z' }),
    ];
    const r = checkRecords(contract, 'customers', rows, { now: () => NOW });
    expect(r.sla[0]?.passed).toBe(false); // only the 9-day-old valid row counts
  });
});

describe('nothing is skipped in silence', () => {
  it('marks a freshness SLA in an unsupported unit as unmeasurable, never passed', () => {
    const c = structuredClone(contract);
    c.slaProperties = [
      {
        property: 'freshness',
        value: 1,
        unit: 'fortnights',
        element: 'customers.last_updated_at',
      },
    ];
    const r = checkRecords(
      c,
      'customers',
      [row(1, { last_updated_at: '2026-11-19T11:00:00Z' })],
      { now: () => NOW },
    );
    expect(r.sla[0]).toMatchObject({
      passed: false,
      error: expect.stringMatching(/fortnights/),
    });
    expect(r.status).not.toBe('passed');
    // It still loads (it is valid ODCS), with a warning; verification is what reports it.
    expect(parseContract({ ...c }).warnings.map((w) => w.code)).toContain(
      'unsupported-sla-unit',
    );
  });

  it('reports rules it cannot evaluate whole, and rules on nested fields, as not run', () => {
    const { contract: c } = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 't',
          properties: [
            {
              name: 'addr',
              logicalType: 'object',
              description: 'a',
              properties: [
                {
                  name: 'zip',
                  logicalType: 'string',
                  quality: [{ metric: 'nullValues', mustBeLessOrEqualTo: 3 }],
                },
              ],
            },
          ],
        },
      ],
    });
    const r = checkRecords(c, 't', [{ addr: { zip: null } }], {
      now: () => NOW,
    });
    expect(r.quality).toEqual([
      expect.objectContaining({ property: 'addr.zip', status: 'not-run' }),
    ]);
    expect(r.status).toBe('incomplete');
  });

  it('enforces zero-tolerance null and missing-value rules per record', () => {
    const c = structuredClone(contract);
    c.schema![0]!.properties!.find(
      (p) => p.name === 'customer_status',
    )!.quality = [
      {
        metric: 'missingValues',
        arguments: { missingValues: ['N/A'] },
        mustBe: 0,
      },
    ];
    const codes = (v: unknown) =>
      checkRecords(c, 'customers', [row(1, { customer_status: v })], {
        now: () => NOW,
      })
        .findings.filter(
          (f) => f.path === 'customer_status' && f.severity === 'error',
        )
        .map((f) => f.code);
    expect(codes('N/A')).toEqual(['required-missing']);
    expect(codes(null)).toEqual(['required-missing']);
    expect(codes('active')).toEqual([]);
  });
});

describe('cross-record promises in a batch', () => {
  it('fails a batch that repeats a primary key', () => {
    const r = checkRecords(
      contract,
      'customers',
      [row(1), row(2, { customer_id: 'c1' })],
      { now: () => NOW },
    );
    expect(r.findings.find((f) => f.code === 'duplicate-key')).toMatchObject({
      path: 'customer_id',
      count: 1,
    });
    expect(r.status).toBe('failed');
  });

  it('measures an SLA without an element on slaDefaultElement', () => {
    const c = structuredClone(contract);
    c.slaDefaultElement = 'customers.last_updated_at';
    c.slaProperties = [{ property: 'freshness', value: 1, unit: 'h' }];
    const r = checkRecords(
      c,
      'customers',
      [row(1, { last_updated_at: '2026-11-19T06:00:00Z' })],
      { now: () => NOW },
    );
    expect(r.sla).toEqual([
      expect.objectContaining({
        element: 'customers.last_updated_at',
        passed: false,
      }),
    ]);
  });
});

describe('compound duplicateValues', () => {
  const compound = (extra: Record<string, unknown> = {}) =>
    parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'orders',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 'orders',
          quality: [
            {
              metric: 'duplicateValues',
              mustBe: 0,
              arguments: { properties: ['tenant_id', 'order_id'] },
              ...extra,
            },
          ],
          properties: [
            { name: 'tenant_id', logicalType: 'string', description: 't' },
            { name: 'order_id', logicalType: 'string', description: 'o' },
          ],
        },
      ],
    }).contract;

  it('counts the columns together, as a tuple', () => {
    const rows = [
      { tenant_id: 'a', order_id: '1' },
      { tenant_id: 'b', order_id: '1' },
      { tenant_id: 'a', order_id: '1' },
    ];
    expect(checkRecords(compound(), 'orders', rows).quality[0]).toMatchObject({
      status: 'failed',
      value: 1,
    });
    expect(
      checkRecords(compound(), 'orders', rows.slice(0, 2)).quality[0],
    ).toMatchObject({ status: 'passed', value: 0 });
  });

  it('reports a compound rule naming a missing column as not run', () => {
    const c = compound({ arguments: { properties: ['tenant_id', 'nope'] } });
    expect(
      checkRecords(c, 'orders', [{ tenant_id: 'a', order_id: '1' }]).quality[0],
    ).toMatchObject({
      status: 'not-run',
      skipped: expect.stringMatching(/nope/),
    });
  });
});

describe('one equality for duplicates', () => {
  it('counts 1 and "1" as different values, as composite keys do', () => {
    const c = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 't',
          properties: [
            {
              name: 'v',
              description: 'v',
              quality: [{ metric: 'duplicateValues', mustBe: 0 }],
            },
          ],
        },
      ],
    }).contract;
    expect(
      checkRecords(c, 't', [{ v: 1 }, { v: '1' }]).quality[0],
    ).toMatchObject({ status: 'passed', value: 0 });
    expect(
      checkRecords(c, 't', [{ v: { a: 1, b: 2 } }, { v: { b: 2, a: 1 } }])
        .quality[0],
    ).toMatchObject({ status: 'failed', value: 1 });
  });
});

describe('no SLA is skipped in silence', () => {
  const base32 = (
    sla: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) =>
    parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 't',
          properties: [
            { name: 'at', logicalType: 'timestamp', description: 'at' },
          ],
        },
      ],
      slaProperties: [sla],
      ...extra,
    }).contract;
  const run = (
    c: ReturnType<typeof base32>,
    rows: Array<Record<string, unknown>>,
  ) => checkRecords(c, 't', rows, { now: () => NOW });

  it("reports the article's five-year retention with no element as unknown, and the run as incomplete", () => {
    const c = base32({ property: 'retention', value: 5, unit: 'year' });
    const r = run(c, [{ at: '1990-01-01T00:00:00Z' }]);
    expect(r.sla).toEqual([
      expect.objectContaining({
        status: 'unknown',
        error: expect.stringMatching(/no element/),
      }),
    ]);
    expect(r.status).toBe('incomplete');
    expect(lintContract(c).map((i) => i.code)).toContain('sla-no-element');
  });

  it('measures it once given an element, and breaks it on a 1990 row', () => {
    const r = run(
      base32({
        property: 'retention',
        value: 5,
        unit: 'year',
        element: 't.at',
      }),
      [{ at: '1990-01-01T00:00:00Z' }],
    );
    expect(r.sla[0]).toMatchObject({ status: 'breached' });
    expect(r.status).toBe('failed');
  });

  it('names an element without its property, unreadable values, and kinds it does not measure', () => {
    expect(
      run(
        base32({
          property: 'freshness',
          value: 1,
          unit: 'd',
          element: 't.nope',
        }),
        [{ at: '2026-11-19T00:00:00Z' }],
      ).sla[0],
    ).toMatchObject({
      status: 'unknown',
      error: expect.stringMatching(/names no property/),
    });
    expect(
      run(
        base32({
          property: 'freshness',
          value: 1,
          unit: 'd',
          element: 'nope.at',
        }),
        [{ at: '2026-11-19T00:00:00Z' }],
      ).sla[0],
    ).toMatchObject({
      status: 'unknown',
      error: expect.stringMatching(/names no schema object/),
    });
    // A legacy text column holding something that is not a time.
    const textual = base32({
      property: 'retention',
      value: 5,
      unit: 'y',
      element: 't.at',
    });
    textual.schema![0]!.properties![0]!.logicalType = 'string';
    const unreadable = run(textual, [{ at: 'last tuesday' }]);
    expect(unreadable.sla[0]).toMatchObject({
      status: 'unknown',
      error: expect.stringMatching(/none reads as a time/),
    });
    const latency = run(
      base32({ property: 'latency', value: 4, unit: 'h', element: 't.at' }),
      [{ at: '2026-11-19T00:00:00Z' }],
    );
    expect(latency.sla[0]).toMatchObject({ status: 'not-executable' });
    expect(latency.status).toBe('passed');
  });
});

describe('numeric equality in batch matches SQL on a numeric column', () => {
  it("reads a DECIMAL driver's '1.00' as 1 for a numeric property, leniently only", () => {
    const c = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 't',
          properties: [
            {
              name: 'n',
              logicalType: 'number',
              description: 'n',
              quality: [
                {
                  metric: 'invalidValues',
                  arguments: { validValues: [1, 2] },
                  mustBe: 0,
                },
                { metric: 'duplicateValues', mustBe: 0 },
              ],
            },
            {
              name: 's',
              logicalType: 'string',
              description: 's',
              quality: [
                {
                  metric: 'invalidValues',
                  arguments: { validValues: ['1'] },
                  mustBe: 0,
                },
              ],
            },
          ],
        },
      ],
    }).contract;
    const lenient = checkRecords(
      c,
      't',
      [
        { n: '1.00', s: '1.0' },
        { n: '1.0', s: '1' },
      ],
      { lenient: true },
    );
    expect(
      lenient.quality.map((q) => `${q.property}:${q.metric}:${q.value}`),
    ).toEqual([
      'n:invalidValues:0',
      'n:duplicateValues:1',
      's:invalidValues:1',
    ]);
    const strict = checkRecords(c, 't', [{ n: 1, s: '1' }]);
    expect(strict.quality[0]).toMatchObject({ value: 0 });
  });
});

describe('non-finite timestamps are unreadable, never a crash or a pass', () => {
  const NOW = Date.parse('2026-11-19T12:00:00Z');
  // An untyped field: nothing rejects the value, so only the SLA reading can catch it.
  const contract = parseContract({
    apiVersion: 'v3.2.0',
    kind: 'DataContract',
    id: 'ev',
    version: '1.0.0',
    status: 'active',
    schema: [
      { name: 'events', properties: [{ name: 'at', description: 'at' }] },
    ],
    slaProperties: [
      { property: 'retention', value: 24, unit: 'h', element: 'events.at' },
    ],
  }).contract;
  const recent = '2026-11-19T11:00:00Z';

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['an invalid Date', new Date('nope')],
  ])('%s next to a recent timestamp leaves retention unknown', (_, bad) => {
    const r = checkRecords(contract, 'events', [{ at: recent }, { at: bad }], {
      lenient: true,
      now: () => NOW,
    });
    expect(r.sla[0]).toMatchObject({ status: 'unknown' });
    expect(r.status).toBe('incomplete');
  });

  it('profiles an invalid Date and NaN without throwing or poisoning bounds', () => {
    const p = profileRecords([
      { at: new Date('nope'), n: Number.NaN },
      { at: new Date('nope'), n: 3 },
      { at: new Date(recent), n: 1 },
    ]);
    const at = p.fields.find((f) => f.name === 'at')!;
    expect(at.duplicates).toBe(1); // two invalid Dates are the same value
    const n = p.fields.find((f) => f.name === 'n')!;
    expect([n.min, n.max]).toEqual([1, 3]);
  });
});
