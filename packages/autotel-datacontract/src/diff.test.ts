import { describe, expect, it } from 'vitest';
import { parseContract, type DataContract } from './contract.js';
import { diffContracts, formatDiff } from './diff.js';
import { customersYaml } from './__fixtures__/index.js';

const base = () => structuredClone(parseContract(customersYaml).contract);
const props = (c: DataContract) => c.schema![0]!.properties!;
const levels = (a: DataContract, b: DataContract) =>
  diffContracts(a, b).changes.map((c) => `${c.level} ${c.path}`);

describe('diffContracts', () => {
  it('reads a rule with no type as the library rule it is', () => {
    const next = base();
    delete props(next)[3]!.quality![0]!.type; // was type: library
    expect(diffContracts(base(), next).changes).toEqual([]);
  });

  it('finds no change between equal contracts', () => {
    expect(diffContracts(base(), base())).toMatchObject({
      changes: [],
      required: 'none',
      ok: true,
    });
  });

  it('reads weakened promises as breaking and stronger ones as minor', () => {
    const next = base();
    next.version = '1.1.0';
    props(next).splice(4, 1); // drop last_updated_at
    props(next)[1]!.required = false;
    props(next)[2]!.logicalTypeOptions = { minimum: 10 };
    props(next)[3]!.quality![0]!.arguments = {
      validValues: ['active', 'lapsed', 'cancelled', 'frozen'],
    };
    props(next).push({ name: 'email', logicalType: 'string' });
    next.slaProperties![1]!.value = 48;
    const d = diffContracts(base(), next);
    expect(levels(base(), next)).toEqual(
      expect.arrayContaining([
        'breaking customers.last_updated_at',
        'breaking customers.customer_name',
        'additive customers.annual_premium.minimum',
        'breaking customers.customer_status.quality[library:invalidValues]',
        'additive customers.email',
        'breaking sla.freshness:customers.last_updated_at',
      ]),
    );
    expect(d).toMatchObject({
      required: 'major',
      declared: 'minor',
      ok: false,
    });
    expect(formatDiff(d)).toContain('Not enough.');
  });

  it('needs only a patch for documentation', () => {
    const next = base();
    next.version = '1.0.1';
    props(next)[0]!.description = 'The customer id';
    expect(diffContracts(base(), next)).toMatchObject({
      required: 'patch',
      declared: 'patch',
      ok: true,
    });
  });

  it('lets a 0.x contract break on a minor bump', () => {
    const a = { ...base(), version: '0.3.0' };
    const b = { ...base(), version: '0.4.0', schema: [] };
    expect(diffContracts(a, b)).toMatchObject({ required: 'major', ok: true });
  });
});

describe('access and terms', () => {
  const withAccess = () => ({
    ...base(),
    servers: [
      {
        server: 'production',
        type: 'snowflake',
        environment: 'prod',
        database: 'prod_lifeinsurance',
        schema: 'dp_customers_v1',
      },
    ],
    roles: [{ role: 'customers_reader', access: 'read' }],
    description: { purpose: 'Analytics', usage: 'Cross-sell prediction' },
  });

  it('breaks when a consumer loses its endpoint or its role', () => {
    const next = {
      ...withAccess(),
      version: '1.0.1',
      servers: [],
      roles: [{ role: 'customers_reader', access: 'none' }],
    };
    expect(levels(withAccess(), next)).toEqual([
      'breaking servers.production',
      'breaking roles.customers_reader',
    ]);
    expect(diffContracts(withAccess(), next)).toMatchObject({
      required: 'major',
      ok: false,
    });
  });

  it('treats a moved database as breaking and a new server as minor', () => {
    const moved = withAccess();
    moved.servers[0]!.schema = 'dp_customers_v2';
    expect(levels(withAccess(), moved)).toEqual([
      'breaking servers.production',
    ]);
    const added = withAccess();
    added.servers.push({
      server: 'staging',
      type: 'snowflake',
      environment: 'stage',
      database: 'x',
      schema: 'y',
    });
    expect(levels(withAccess(), added)).toEqual(['additive servers.staging']);
  });

  it('flags terms-of-use and status changes for a person to review', () => {
    const next = {
      ...withAccess(),
      status: 'deprecated',
      description: {
        purpose: 'Analytics only, not for pricing',
        usage: 'Cross-sell prediction',
      },
    };
    const d = diffContracts(withAccess(), next);
    expect(d.needsReview).toBe(true);
    expect(d.changes.filter((c) => c.review).map((c) => c.path)).toEqual([
      'status',
      'description.purpose',
    ]);
    expect(formatDiff(d)).toContain('Review by a person');
  });

  it('reads native enums: a new value is breaking, a dropped one minor', () => {
    const withEnum = () => {
      const c = base();
      props(c)[3]!.enum = [{ value: 'active' }, { value: 'lapsed' }];
      return c;
    };
    const wider = withEnum();
    props(wider)[3]!.enum!.push({ value: 'frozen' });
    expect(levels(withEnum(), wider)).toEqual([
      'breaking customers.customer_status.enum',
    ]);
    const narrower = withEnum();
    props(narrower)[3]!.enum!.pop();
    expect(levels(withEnum(), narrower)).toEqual([
      'additive customers.customer_status.enum',
    ]);
  });
});

describe('version validation', () => {
  it.each(['2.0.0junk', '2.0', '02.0.0', 'v2', ''])(
    'refuses to judge %j',
    (bad) => {
      const next = { ...base(), version: bad, schema: [] };
      const d = diffContracts(base(), next);
      expect(d).toMatchObject({
        ok: false,
        versionError: expect.stringContaining('not SemVer'),
      });
      expect(formatDiff(d)).toContain('Cannot judge');
    },
  );

  it('accepts pre-release and build metadata', () => {
    expect(
      diffContracts(base(), {
        ...base(),
        version: '2.0.0-rc.1+build.5',
        schema: [],
      }),
    ).toMatchObject({ ok: true, declared: 'major' });
  });
});

describe('every key is classified', () => {
  it('breaks when a table becomes a topic', () => {
    const next = base();
    next.schema![0]!.physicalType = 'TOPIC';
    expect(levels(base(), next)).toEqual(['breaking customers.physicalType']);
  });

  it('flags a removed AI usage constraint for review', () => {
    const withContext = () => ({
      ...base(),
      context: {
        constraints: [
          {
            constraint:
              'Do not use this data to make decisions about individual customers',
          },
        ],
      },
    });
    const d = diffContracts(withContext(), {
      ...withContext(),
      version: '1.0.1',
      context: { constraints: [] },
    });
    expect(d).toMatchObject({ needsReview: true, required: 'patch' });
    expect(d.changes).toEqual([
      expect.objectContaining({ path: 'context', review: true }),
    ]);
  });

  it('reads primary key order as breaking and an unknown key as review', () => {
    const next = base();
    props(next)[0]!.primaryKeyPosition = 2;
    props(next)[1]!['x-vendor-flag'] = true;
    const d = diffContracts(base(), next);
    expect(
      d.changes.map((c) => `${c.level}${c.review ? '+review' : ''} ${c.path}`),
    ).toEqual([
      'breaking customers.customer_id.primaryKeyPosition',
      'patch+review customers.customer_name.x-vendor-flag',
    ]);
  });

  it('compares SLAs in the same unit and in their own direction', () => {
    const withSla = (property: string, value: number, unit?: string) => ({
      ...base(),
      slaProperties: [
        { property, value, unit, element: 'customers.last_updated_at' },
      ],
    });
    const level = (a: DataContract, b: DataContract) =>
      diffContracts(a, b).changes.map(
        (c) => `${c.level}${c.review ? '+review' : ''}`,
      );
    expect(
      level(withSla('freshness', 24, 'hours'), withSla('freshness', 1, 'd')),
    ).toEqual(['patch']);
    expect(
      level(withSla('freshness', 24, 'hours'), withSla('freshness', 2, 'd')),
    ).toEqual(['breaking']);
    expect(
      level(withSla('availability', 99.9), withSla('availability', 99)),
    ).toEqual(['breaking']);
    expect(
      level(withSla('availability', 99), withSla('availability', 99.9)),
    ).toEqual(['additive']);
    expect(
      level(withSla('retention', 5, 'y'), withSla('retention', 3, 'y')),
    ).toEqual(['breaking+review']);
  });
});

describe('rule changes are read part by part', () => {
  const withRule = (rule: Record<string, unknown>) => {
    const c = base();
    props(c)[3]!.quality = [{ metric: 'invalidValues', ...rule }];
    return c;
  };
  const level = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    diffContracts(withRule(a), withRule(b)).changes.map(
      (c) => `${c.level}${c.review ? '+review' : ''}`,
    );

  it('breaks when a pattern is dropped even as the allowed list shrinks', () => {
    expect(
      level(
        {
          mustBe: 0,
          arguments: { validValues: ['abc', 'XYZ', 'q'], pattern: '^a' },
        },
        { mustBe: 0, arguments: { validValues: ['abc', 'XYZ'] } },
      ),
    ).toEqual(['breaking']);
  });
  it('reads a narrower list, an added pattern or a tighter threshold as additive', () => {
    expect(
      level(
        { mustBe: 0, arguments: { validValues: ['a', 'b'] } },
        { mustBe: 0, arguments: { validValues: ['a'] } },
      ),
    ).toEqual(['additive']);
    expect(
      level(
        { mustBe: 0, arguments: { validValues: ['a'] } },
        { mustBe: 0, arguments: { validValues: ['a'], pattern: '^a' } },
      ),
    ).toEqual(['additive']);
    expect(
      level(
        { mustBeLessOrEqualTo: 5, arguments: { validValues: ['a'] } },
        { mustBe: 0, arguments: { validValues: ['a'] } },
      ),
    ).toEqual(['additive']);
  });
  it('reads a looser threshold or a changed pattern as breaking', () => {
    expect(
      level(
        { mustBe: 0, arguments: { validValues: ['a'] } },
        { mustBeLessOrEqualTo: 5, arguments: { validValues: ['a'] } },
      ),
    ).toEqual(['breaking']);
    expect(
      level(
        { mustBe: 0, arguments: { pattern: '^a' } },
        { mustBe: 0, arguments: { pattern: '^b' } },
      ),
    ).toEqual(['breaking']);
  });
  it('keeps two rules on one metric apart, keys by id, and ignores the 3.0 spelling', () => {
    const two = (second: Record<string, unknown>) => {
      const c = base();
      props(c)[3]!.quality = [
        {
          metric: 'invalidValues',
          mustBe: 0,
          arguments: { validValues: ['a'] },
        },
        { metric: 'invalidValues', ...second },
      ];
      return c;
    };
    const d = diffContracts(
      two({ mustBe: 0, arguments: { pattern: '^a' } }),
      two({ mustBe: 0, arguments: { pattern: '^z' } }),
    );
    expect(d.changes.map((c) => `${c.level} ${c.path}`)).toEqual([
      'breaking customers.customer_status.quality[library:invalidValues#2]',
    ]);
    expect(
      level(
        {
          id: 'r1',
          mustBe: 0,
          arguments: { validValues: ['a'] },
          description: 'x',
        },
        {
          id: 'r1',
          mustBe: 0,
          arguments: { validValues: ['a'] },
          description: 'y',
        },
      ),
    ).toEqual(['patch']);
    const legacy = base();
    props(legacy)[3]!.quality = [
      { rule: 'validValues', mustBe: 0, arguments: { validValues: ['a'] } },
    ];
    const modern = base();
    props(modern)[3]!.quality = [
      { metric: 'invalidValues', mustBe: 0, arguments: { validValues: ['a'] } },
    ];
    expect(diffContracts(legacy, modern).changes).toEqual([]);
  });
});

describe('versions only move forward', () => {
  it.each([
    ['2.0.0', '1.9.9'],
    ['2.0.0', '2.0.0-rc.1'],
    ['1.0.0-rc.2', '1.0.0-rc.1'],
    ['1.0.0-beta.11', '1.0.0-beta.2'],
  ])('%s → %s is a version error', (from, to) => {
    const d = diffContracts(
      { ...base(), version: from },
      { ...base(), version: to },
    );
    expect(d).toMatchObject({
      ok: false,
      versionError: expect.stringContaining('went down'),
    });
  });
  it('accepts a release after its pre-release and ignores build metadata', () => {
    expect(
      diffContracts(
        { ...base(), version: '1.0.0-rc.1' },
        { ...base(), version: '1.0.0' },
      ).ok,
    ).toBe(true);
    expect(
      diffContracts(
        { ...base(), version: '1.0.0+a' },
        { ...base(), version: '1.0.0+b' },
      ).ok,
    ).toBe(true);
  });
  it('reads reordered keys as no change', () => {
    const a = {
      ...base(),
      servers: [{ server: 'p', type: 'postgres', host: 'h', database: 'd' }],
    };
    const b = {
      ...base(),
      servers: [{ database: 'd', host: 'h', type: 'postgres', server: 'p' }],
    };
    expect(diffContracts(a, b).changes).toEqual([]);
  });
});
