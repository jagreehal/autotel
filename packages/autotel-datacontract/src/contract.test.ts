import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  DataContractError,
  durationMs,
  isZeroTolerance,
  type LogicalType,
  lintContract,
  parseContract,
} from './contract.js';
import {
  instantOf,
  isMultiple,
  matchesType,
  validateRecord,
} from './validate.js';
import { redactionKeyPatterns, sensitiveFields } from './redaction.js';

import { customersYaml } from './__fixtures__/index.js';
const { contract } = parseContract(customersYaml);

describe('parseContract / lintContract', () => {
  it('reads the ODCS example and keeps the fields it does not model', () => {
    expect(contract.id).toBe('customers');
    expect(contract.schema?.[0]?.properties).toHaveLength(5);
  });

  it('rejects a contract that is not one, naming every problem', () => {
    expect(() => parseContract('kind: Thing\nid: x')).toThrow(
      DataContractError,
    );
    const codes = lintContract({
      kind: 'DataContract',
      apiVersion: 'v3.1.0',
      id: 'x',
      version: '1',
      status: 'draft',
      schema: [
        {
          name: 'a',
          properties: [{ name: 'b', logicalType: 'text' }, { name: 'b' }],
          quality: [{ type: 'sql' }],
        },
      ],
      slaProperties: [{ property: 'freshness', value: 1, element: 'a.nope' }],
    }).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'not-semver',
        'unknown-logical-type',
        'duplicate-name',
        'no-logical-type',
        'missing-query',
        'missing-threshold',
        'unknown-element',
      ]),
    );
  });

  it('reads SLA units', () => {
    expect(durationMs(24, 'hours')).toBe(86_400_000);
    expect(durationMs(5, 'year')).toBe(5 * 31_536_000_000);
    expect(durationMs(30, 'minutes')).toBe(1_800_000);
    expect(durationMs(2, 'months')).toBe(2 * 2_592_000_000);
    expect(durationMs(1, 'fortnights')).toBeUndefined();
  });
});

describe('validateRecord', () => {
  const ok = {
    customer_id: 'c1',
    customer_name: 'Alex Doe',
    annual_premium: 120_000,
    customer_status: 'active',
    last_updated_at: '2026-11-19T10:00:00Z',
  };

  it('passes a record that keeps every promise', () => {
    expect(validateRecord(contract, 'customers', ok)).toEqual([]);
  });

  it('names each broken promise without carrying the value', () => {
    const v = validateRecord(contract, 'customers', {
      ...ok,
      customer_name: null,
      annual_premium: -5,
      customer_status: 'frozen',
      last_updated_at: 'yesterday',
      legacy_flag: 'Y',
    });
    expect(v.map((x) => `${x.path}:${x.code}`)).toEqual([
      'customer_name:required-missing',
      'annual_premium:below-minimum',
      'customer_status:invalid-value',
      'last_updated_at:type-mismatch',
      'legacy_flag:unknown-field',
    ]);
    expect(JSON.stringify(v)).not.toContain('frozen');
    expect(v.find((x) => x.code === 'unknown-field')?.severity).toBe('warning');
  });

  it('is strict by default and lenient for database drivers', () => {
    const row = { ...ok, annual_premium: '120000' };
    expect(
      validateRecord(contract, 'customers', row).map((x) => x.code),
    ).toEqual(['type-mismatch']);
    expect(
      validateRecord(contract, 'customers', row, { lenient: true }),
    ).toEqual([]);
  });

  it('walks nested objects and array items', () => {
    const { contract: c } = parseContract({
      apiVersion: 'v3.1.0',
      kind: 'DataContract',
      id: 'o',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 'order',
          properties: [
            {
              name: 'items',
              logicalType: 'array',
              items: {
                logicalType: 'object',
                properties: [
                  { name: 'sku', logicalType: 'string', required: true },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(
      validateRecord(c, 'order', { items: [{ sku: 'a' }, {}] }).map(
        (x) => `${x.path}:${x.code}`,
      ),
    ).toEqual(['items[].sku:required-missing']);
  });
});

describe('redaction', () => {
  it('derives redactor key patterns from classification and pii tags', () => {
    expect(sensitiveFields(contract)).toEqual(['customers.customer_name']);
    const [re] = redactionKeyPatterns(contract);
    expect(re?.test('customer_name')).toBe(true);
    expect(re?.test('customer_name_hash')).toBe(false);
  });
});

describe('ODCS 3.2 types', () => {
  const c32 = (props: unknown[]) =>
    parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [{ name: 't', properties: props }],
    }).contract;
  const codes = (c: ReturnType<typeof c32>, r: unknown) =>
    validateRecord(c, 't', r).map((v) => `${v.path}:${v.code}`);

  it('enforces native enums', () => {
    const c = c32([
      {
        name: 'status',
        logicalType: 'string',
        enum: [{ value: 'active', label: 'Active' }, { value: 'lapsed' }],
      },
    ]);
    expect(codes(c, { status: 'active' })).toEqual([]);
    expect(codes(c, { status: 'frozen' })).toEqual(['status:invalid-value']);
  });

  it('checks map keys and values, and vector dimensions', () => {
    const c = c32([
      {
        name: 'scores',
        logicalType: 'map',
        map: {
          key: { logicalType: 'integer' },
          value: { logicalType: 'number', logicalTypeOptions: { minimum: 0 } },
        },
      },
      {
        name: 'embedding',
        logicalType: 'vector',
        logicalTypeOptions: { dimensions: 3 },
      },
      {
        name: 'qty',
        logicalType: 'integer',
        logicalTypeOptions: { multipleOf: 5 },
      },
    ]);
    expect(
      codes(c, { scores: { 1: 0.5 }, embedding: [1, 2, 3], qty: 10 }),
    ).toEqual([]);
    expect(codes(c, { scores: { a: -1 }, embedding: [1, 2], qty: 7 })).toEqual([
      'scores{key}:type-mismatch',
      'scores{}:below-minimum',
      'embedding:wrong-dimensions',
      'qty:not-multiple',
    ]);
  });

  it('lints enum and map shape', () => {
    const codes = lintContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 't',
          properties: [
            { name: 'a', logicalType: 'string', enum: ['active'] },
            { name: 'b', logicalType: 'map' },
          ],
        },
      ],
    }).map((i) => i.code);
    expect(codes).toEqual(['bad-enum', 'missing-map']);
  });
});

describe('isZeroTolerance', () => {
  it.each([
    [{ mustBe: 0 }, true],
    [{ mustBeLessThan: 1 }, true],
    [{ mustBeLessOrEqualTo: 0 }, true],
    [{ mustBe: 0, unit: 'percent' }, true],
    [{ mustBeLessOrEqualTo: 1 }, false],
    [{ mustBeLessThan: 0.01, unit: 'percent' }, false],
    [{ mustBeGreaterThan: 5 }, false],
  ])('%j → %s', (rule, expected) =>
    expect(isZeroTolerance(rule)).toBe(expected),
  );
});

describe('lint rejects what no tool can measure', () => {
  const lint = (extra: Record<string, unknown>) =>
    lintContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        { name: 't', properties: [{ name: 'a', logicalType: 'string' }] },
      ],
      ...extra,
    }).map((i) => i.code);
  it.each([
    ['fortnights', 'unsupported-sla-unit'],
    [undefined, 'unsupported-sla-unit'],
  ])('freshness in %s', (unit, code) =>
    expect(
      lint({
        slaProperties: [
          { property: 'freshness', value: 1, unit, element: 't.a' },
        ],
      }),
    ).toContain(code),
  );
  it('accepts a readable unit and flags freshness with no element', () => {
    expect(
      lint({
        slaProperties: [
          { property: 'freshness', value: 24, unit: 'hours', element: 't.a' },
        ],
      }),
    ).not.toContain('unsupported-sla-unit');
    expect(
      lint({
        slaProperties: [{ property: 'freshness', value: 24, unit: 'hours' }],
      }),
    ).toContain('sla-no-element');
  });
  it('rejects a library rule it cannot evaluate whole', () => {
    const rules = (rule: unknown) =>
      lintContract({
        apiVersion: 'v3.2.0',
        kind: 'DataContract',
        id: 'x',
        version: '1.0.0',
        status: 'active',
        schema: [
          {
            name: 't',
            properties: [{ name: 'a', logicalType: 'string', quality: [rule] }],
          },
        ],
      }).map((i) => i.code);
    expect(rules({ metric: 'invalidValues', mustBe: 0 })).toContain(
      'unmeasurable-rule',
    );
    expect(
      rules({ metric: 'nullValues', arguments: { mystery: 1 }, mustBe: 0 }),
    ).toContain('unmeasurable-rule');
    expect(
      rules({
        metric: 'invalidValues',
        arguments: { validValues: ['x'] },
        mustBe: 0,
      }),
    ).not.toContain('unmeasurable-rule');
  });
});

describe('every ODCS 3.2 option a value can break', () => {
  const c32 = (prop: Record<string, unknown>) =>
    parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [{ name: 't', properties: [{ name: 'v', ...prop }] }],
    }).contract;
  const codes = (
    prop: Record<string, unknown>,
    v: unknown,
    options?: { lenient?: boolean },
  ) => validateRecord(c32(prop), 't', { v }, options).map((x) => x.code);

  it('checks multipleOf in decimal', () => {
    const p = {
      logicalType: 'number',
      logicalTypeOptions: { multipleOf: 0.1 },
    };
    expect(codes(p, 0.3)).toEqual([]);
    expect(codes(p, 0.35)).toEqual(['not-multiple']);
    expect(
      codes(
        { logicalType: 'number', logicalTypeOptions: { multipleOf: 1e-7 } },
        3e-7,
      ),
    ).toEqual([]);
    expect(
      codes(
        { logicalType: 'number', logicalTypeOptions: { multipleOf: 0.01 } },
        19.99,
      ),
    ).toEqual([]);
  });

  it('checks integer format ranges, date bounds, object keys, unique items and vector elements', () => {
    expect(
      codes(
        { logicalType: 'integer', logicalTypeOptions: { format: 'i8' } },
        128,
      ),
    ).toEqual(['out-of-range']);
    expect(
      codes(
        { logicalType: 'integer', logicalTypeOptions: { format: 'u8' } },
        -1,
      ),
    ).toEqual(['out-of-range']);
    expect(
      codes(
        { logicalType: 'integer', logicalTypeOptions: { format: 'i64' } },
        2n ** 63n,
      ),
    ).toEqual(['out-of-range']);
    expect(
      codes(
        { logicalType: 'date', logicalTypeOptions: { minimum: '2020-01-01' } },
        '2019-12-31',
      ),
    ).toEqual(['below-minimum']);
    expect(
      codes(
        {
          logicalType: 'timestamp',
          logicalTypeOptions: {
            maximum: '2026-01-01T00:00:00Z',
            exclusiveMaximum: true,
          },
        },
        '2026-01-01T00:00:00Z',
      ),
    ).toEqual(['above-maximum']);
    // Time bounds, as ODCS defines them for time too: compared as instants, zone applied.
    const opening = (value: string, min = '09:00:00Z') =>
      codes(
        {
          logicalType: 'time',
          logicalTypeOptions: { minimum: min, maximum: '17:00:00Z' },
        },
        value,
      );
    expect(opening('01:00:00Z')).toEqual(['below-minimum']);
    expect(opening('18:00:00Z')).toEqual(['above-maximum']);
    expect(opening('09:00:00Z')).toEqual([]);
    expect(opening('10:00:00+02:00')).toEqual(['below-minimum']); // 08:00 UTC
    expect(opening('09:30:00.5+00:00')).toEqual([]);
    // Every fractional digit counts, past the millisecond, for times and timestamps.
    expect(opening('09:00:00.0001Z', '09:00:00.0009Z')).toEqual([
      'below-minimum',
    ]);
    expect(opening('09:00:00.0009Z', '09:00:00.0009Z')).toEqual([]);
    expect(opening('09:00:00.001Z', '09:00:00.0009Z')).toEqual([]);
    // Before UTC midnight on the fixed day (negative seconds), as ajv-formats compares times.
    expect(opening('00:59:59.6+01:00', '00:59:59.5+01:00')).toEqual([]);
    expect(opening('00:59:59.4+01:00', '00:59:59.5+01:00')).toEqual([
      'below-minimum',
    ]);
    expect(
      codes(
        {
          logicalType: 'timestamp',
          logicalTypeOptions: { minimum: '2026-01-01T00:00:00.000000002Z' },
        },
        '2026-01-01T00:00:00.000000001Z',
      ),
    ).toEqual(['below-minimum']);
    expect(
      codes(
        {
          logicalType: 'timestamp',
          logicalTypeOptions: { maximum: '2016-12-31T23:59:59.9Z' },
        },
        '2016-12-31T23:59:60Z',
      ),
    ).toEqual(['above-maximum']);
    // Epoch numbers a lenient read accepts are held to the bounds, read as an SLA reads them.
    const since2026 = (value: unknown) =>
      codes(
        {
          logicalType: 'timestamp',
          logicalTypeOptions: { minimum: '2026-01-01T00:00:00Z' },
        },
        value,
        { lenient: true },
      );
    expect(since2026(946_684_800)).toEqual(['below-minimum']); // seconds: 2000-01-01
    expect(since2026(1_577_836_800_000)).toEqual(['below-minimum']); // ms: 2020-01-01
    expect(since2026(1_767_225_600)).toEqual([]); // 2026-01-01, seconds
    expect(since2026(1_767_225_599.5)).toEqual(['below-minimum']);
    expect(since2026(1_767_225_600_000)).toEqual([]);
    expect(
      codes(
        { logicalType: 'date', logicalTypeOptions: { maximum: '2020-01-01' } },
        1_767_225_600,
        { lenient: true },
      ),
    ).toEqual(['above-maximum']);
    // Leap-second fractions keep their order, and sort after every :59 fraction.
    const leap = (value: string, max: string) =>
      codes(
        { logicalType: 'time', logicalTypeOptions: { maximum: max } },
        value,
      );
    expect(leap('23:59:60.9Z', '23:59:60.1Z')).toEqual(['above-maximum']);
    expect(leap('23:59:60.1Z', '23:59:60.1Z')).toEqual([]);
    expect(leap('23:59:60.05Z', '23:59:60.1Z')).toEqual([]);
    expect(leap('23:59:60Z', '23:59:59.999999Z')).toEqual(['above-maximum']);
    expect(
      codes(
        {
          logicalType: 'time',
          logicalTypeOptions: { minimum: '09:00:00Z', exclusiveMinimum: true },
        },
        '09:00:00Z',
      ),
    ).toEqual(['below-minimum']);
    expect(
      codes(
        {
          logicalType: 'object',
          logicalTypeOptions: { required: ['k'], minProperties: 2 },
        },
        { j: 1 },
      ),
    ).toEqual(['too-short', 'required-missing']);
    expect(
      codes(
        { logicalType: 'array', logicalTypeOptions: { uniqueItems: true } },
        [1, 1],
      ),
    ).toEqual(['duplicate-item']);
    expect(
      codes(
        {
          logicalType: 'vector',
          logicalTypeOptions: { dimensions: 2, elementType: 'int8' },
        },
        [1, 200],
      ),
    ).toEqual(['out-of-range']);
    expect(
      codes(
        {
          logicalType: 'vector',
          logicalTypeOptions: { dimensions: 2, normalized: true },
        },
        [3, 4],
      ),
    ).toEqual(['not-normalized']);
    expect(
      codes(
        {
          logicalType: 'vector',
          logicalTypeOptions: { dimensions: 2, normalized: true },
        },
        [0.6, 0.8],
      ),
    ).toEqual([]);
  });
});

describe('lint names options it will not check', () => {
  it('warns on a misspelt or foreign option', () => {
    const issues = lintContract({
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
              name: 'a',
              logicalType: 'integer',
              logicalTypeOptions: { minimun: 0, maxLength: 3, minimum: 0 },
            },
          ],
        },
      ],
    });
    expect(
      issues.filter((i) => i.code === 'unknown-option').map((i) => i.path),
    ).toEqual([
      't.a.logicalTypeOptions.minimun',
      't.a.logicalTypeOptions.maxLength',
    ]);
  });
});

describe('isMultiple is exact', () => {
  it.each([
    [0.3, 0.1, true],
    [0.35, 0.1, false],
    [1_000_000_000_000_000.5, 1, false],
    [1e21, 1, true],
    [1e21 + 1, 3, false],
    [-0.3, 0.1, true],
    [3e-7, 1e-7, true],
    [19.99, 0.01, true],
    [2 ** 60, 2 ** 10, true],
  ])('%d multiple of %d → %s', (n, m, expected) =>
    expect(isMultiple(n, m)).toBe(expected),
  );
});

describe('valid ODCS always loads', () => {
  it('accepts Bitol’s schema-level compound duplicateValues', () => {
    const { contract: c, warnings } = parseContract({
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
            },
          ],
          properties: [
            { name: 'tenant_id', logicalType: 'string' },
            { name: 'order_id', logicalType: 'string' },
          ],
        },
      ],
    });
    expect(warnings.filter((w) => w.code === 'unmeasurable-rule')).toEqual([]);
    expect(c.id).toBe('orders');
  });

  it('loads what it cannot measure, with a warning', () => {
    const { warnings } = parseContract({
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
              name: 'a',
              logicalType: 'string',
              quality: [
                {
                  metric: 'nullValues',
                  arguments: { vendorOnly: true },
                  mustBe: 0,
                },
              ],
            },
          ],
        },
      ],
      slaProperties: [
        {
          property: 'freshness',
          value: 1,
          unit: 'fortnight',
          element: 't.nope',
        },
      ],
    });
    expect(warnings.map((w) => w.code).toSorted()).toEqual([
      'unknown-element',
      'unmeasurable-rule',
      'unsupported-sla-unit',
    ]);
  });
});

describe('numeric checks never round through Number()', () => {
  const c32 = (opts: Record<string, unknown>) =>
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
            { name: 'v', logicalType: 'integer', logicalTypeOptions: opts },
          ],
        },
      ],
    }).contract;
  const codes = (opts: Record<string, unknown>, v: unknown, lenient = false) =>
    validateRecord(c32(opts), 't', { v }, { lenient }).map((x) => x.code);

  it('keeps a bigint and integer text exact for multipleOf and bounds', () => {
    expect(codes({ multipleOf: 2 }, 9_007_199_254_740_993n)).toEqual([
      'not-multiple',
    ]);
    expect(codes({ multipleOf: 2 }, '9007199254740993', true)).toEqual([
      'not-multiple',
    ]);
    expect(codes({ multipleOf: 2 }, 9_007_199_254_740_994n)).toEqual([]);
    expect(
      codes({ maximum: 9_007_199_254_740_992 }, 9_007_199_254_740_993n),
    ).toEqual(['above-maximum']);
    expect(codes({ minimum: 0, exclusiveMinimum: true }, 0n)).toEqual([
      'below-minimum',
    ]);
  });
});

describe('structural equality', () => {
  const c32 = (opts: Record<string, unknown>) =>
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
            { name: 'v', logicalType: 'array', logicalTypeOptions: opts },
          ],
        },
      ],
    }).contract;
  it('uniqueItems ignores key order, handles bigint, and keeps types apart', () => {
    const codes = (v: unknown) =>
      validateRecord(c32({ uniqueItems: true }), 't', { v }).map((x) => x.code);
    expect(
      codes([
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ]),
    ).toEqual(['duplicate-item']);
    expect(codes([1n, 2n])).toEqual([]);
    expect(codes([1n, 1])).toEqual(['duplicate-item']);
    expect(codes([1, '1'])).toEqual([]);
  });
});

describe('lint holds what ODCS requires', () => {
  const lint = (
    extra: Record<string, unknown>,
    props: unknown[] = [{ name: 'a', logicalType: 'string' }],
  ) =>
    lintContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [{ name: 't', properties: props }],
      ...extra,
    })
      .filter((i) => i.severity === 'error')
      .map((i) => `${i.path}:${i.code}`);
  it('requires positive integer vector dimensions', () => {
    expect(lint({}, [{ name: 'e', logicalType: 'vector' }])).toEqual([
      't.e.logicalTypeOptions.dimensions:missing-dimensions',
    ]);
    expect(
      lint({}, [
        {
          name: 'e',
          logicalType: 'vector',
          logicalTypeOptions: { dimensions: 0 },
        },
      ]),
    ).toEqual(['t.e.logicalTypeOptions.dimensions:missing-dimensions']);
    expect(
      lint({}, [
        {
          name: 'e',
          logicalType: 'vector',
          logicalTypeOptions: { dimensions: 1.5 },
        },
      ]),
    ).toEqual(['t.e.logicalTypeOptions.dimensions:missing-dimensions']);
    expect(
      lint({}, [
        {
          name: 'e',
          logicalType: 'vector',
          logicalTypeOptions: { dimensions: 768 },
        },
      ]),
    ).toEqual([]);
  });
  it('requires server, type and role on the entries a diff keys on', () => {
    expect(
      lint({ servers: [{ type: 'postgres' }], roles: [{ access: 'read' }] }),
    ).toEqual([
      'servers[0].server:missing-field',
      'roles[0].role:missing-field',
    ]);
  });
});

describe('temporal values are whole RFC 3339 values, as JSON Schema format reads them', () => {
  const ajv = addFormats(new Ajv2020({ strict: false }), { mode: 'full' });
  const formats: Record<string, string> = {
    date: 'date',
    timestamp: 'date-time',
    time: 'time',
  };
  it.each([
    ['time', '99:99xyz'],
    ['time', '10:30:00'],
    ['time', '10:30:00Z'],
    ['time', '23:59:60Z'],
    ['time', '23:59:60+01:00'],
    ['time', '24:00:00Z'],
    ['timestamp', '1990-01-01'],
    ['timestamp', '1990-01-01T10:00:00'],
    ['timestamp', '1990-01-01T10:00:00Z'],
    ['timestamp', '1990-01-01 10:00:00+05:30'],
    ['timestamp', '1990-02-30T10:00:00Z'],
    ['timestamp', '1990-01-01T10:00:00Zjunk'],
    ['date', '2024-02-29'],
    ['date', '2023-02-29'],
    ['date', '1990-01-01T10:00:00Z'],
    ['date', '2024-13-01'],
  ])('%s %j agrees with ajv-formats', (type, value) => {
    const validate = ajv.compile({ type: 'string', format: formats[type] });
    expect(matchesType(type as LogicalType, value, false)).toBe(
      validate(value),
    );
  });
  it('accepts what drivers return when reading leniently', () => {
    expect(matchesType('timestamp', '1990-01-01 10:00:00', true)).toBe(true);
    expect(matchesType('time', '10:30:00', true)).toBe(true);
    expect(matchesType('timestamp', '1990-01-01', true)).toBe(true);
    expect(matchesType('time', '99:99xyz', true)).toBe(false);
  });
  it('reads a zone-less value as UTC, whatever the machine zone', () => {
    expect(instantOf('2020-01-01 10:00:00')).toBe(Date.UTC(2020, 0, 1, 10));
    expect(instantOf('2020-01-01T10:00:00+05')).toBe(Date.UTC(2020, 0, 1, 5));
    expect(instantOf('2020-01-01T10:00:00+0530')).toBe(
      Date.UTC(2020, 0, 1, 4, 30),
    );
    expect(instantOf('2020-01-01')).toBe(Date.UTC(2020, 0, 1));
    expect(instantOf('last tuesday')).toBeUndefined();
  });
});
