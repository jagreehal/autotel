import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parseContract } from './contract.js';
import { fromJsonSchema, toJsonSchema } from './json-schema.js';
import { validateRecord } from './validate.js';
import { customersYaml } from './__fixtures__/index.js';

const { contract } = parseContract(customersYaml);

describe('JSON Schema bridge', () => {
  it('emits JSON Schema with the governance a validator ignores', () => {
    const s = toJsonSchema(contract, 'customers') as any;
    expect(s.required).toEqual([
      'customer_id',
      'customer_name',
      'annual_premium',
    ]);
    expect(s.properties.annual_premium).toMatchObject({
      type: 'integer',
      minimum: 0,
    });
    // Optional in ODCS means null is allowed, so the exported schema allows it too.
    expect(s.properties.customer_status.enum).toEqual([
      'active',
      'lapsed',
      'cancelled',
      null,
    ]);
    expect(s.properties.last_updated_at).toMatchObject({
      type: ['string', 'null'],
      format: 'date-time',
    });
    expect(s.properties.customer_name['x-odcs-classification']).toBe(
      'restricted',
    );
  });

  it('round-trips into a schema object that validates the same way', () => {
    const obj = fromJsonSchema(
      toJsonSchema(contract, 'customers'),
      'customers',
    );
    const roundTripped = { ...contract, schema: [obj] };
    const record = {
      customer_id: 'c',
      customer_name: null,
      annual_premium: -1,
      customer_status: 'x',
      last_updated_at: 'nope',
    };
    const codes = (c: typeof contract) =>
      validateRecord(c, 'customers', record).map((v) => `${v.path}:${v.code}`);
    expect(codes(roundTripped)).toEqual(codes(contract));
  });

  it('reads nullable unions and nested items', () => {
    const obj = fromJsonSchema(
      {
        type: 'object',
        properties: {
          note: { type: ['string', 'null'] },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { sku: { type: 'string' } },
              required: ['sku'],
            },
          },
        },
      },
      'order',
    );
    expect(obj.properties![0]).toEqual({ name: 'note', logicalType: 'string' });
    expect(obj.properties![1]!.items?.properties).toEqual([
      { name: 'sku', logicalType: 'string', required: true },
    ]);
  });
});

describe('ODCS 3.2 shapes in JSON Schema', () => {
  it('round-trips native enums with labels, maps and vectors', () => {
    const obj = {
      name: 't',
      properties: [
        {
          name: 'status',
          logicalType: 'string' as const,
          enum: [{ value: 'active', label: 'Active' }],
        },
        {
          name: 'scores',
          logicalType: 'map' as const,
          map: {
            key: { logicalType: 'string' as const },
            value: { logicalType: 'number' as const },
          },
        },
        {
          name: 'embedding',
          logicalType: 'vector' as const,
          logicalTypeOptions: { dimensions: 768 },
        },
      ],
    };
    const c = { ...contract, schema: [obj] };
    const s = toJsonSchema(c, 't') as any;
    expect(s.properties.status.enum).toEqual(['active', null]);
    expect(s.properties.scores).toMatchObject({
      type: ['object', 'null'],
      additionalProperties: { type: ['number', 'null'] }, // as validateRecord: an optional map value may be null
    });
    expect(s.properties.embedding).toMatchObject({
      type: ['array', 'null'],
      minItems: 768,
      maxItems: 768,
    });
    expect(fromJsonSchema(s, 't').properties).toEqual(obj.properties);
  });
});

describe('JSON Schema says only what one record must satisfy', () => {
  const objWith = (rule: Record<string, unknown>) => ({
    ...contract,
    schema: [
      {
        name: 't',
        properties: [
          {
            name: 'status',
            logicalType: 'string' as const,
            quality: [
              {
                metric: 'invalidValues',
                arguments: { validValues: ['active'] },
                ...rule,
              },
            ],
          },
        ],
      },
    ],
  });

  it('keeps an allowance as metadata, not an enum', () => {
    const c = objWith({ mustBeLessOrEqualTo: 1 });
    const s = toJsonSchema(c, 't') as any;
    expect(s.properties.status.enum).toBeUndefined();
    expect(s.properties.status['x-odcs-quality']).toEqual(
      c.schema[0]!.properties[0]!.quality,
    );
    // The value the batch rule allows once is one the exported schema accepts.
    expect(validateRecord(c, 't', { status: 'frozen' })).toEqual([]);
    expect(fromJsonSchema(s, 't').properties![0]).toMatchObject({
      quality: c.schema[0]!.properties[0]!.quality,
    });
    expect(fromJsonSchema(s, 't').properties![0]!.enum).toBeUndefined();
  });

  it('turns a zero-tolerance rule into the strict keywords, and back into the rule', () => {
    const c = objWith({
      mustBe: 0,
      arguments: { validValues: ['active'], pattern: '^a' },
    });
    const s = toJsonSchema(c, 't') as any;
    expect(s.properties.status).toMatchObject({
      enum: ['active', null],
      allOf: [{ pattern: '^a' }],
    });
    const back = fromJsonSchema(s, 't').properties![0]!;
    expect(back.enum).toBeUndefined();
    expect(back.logicalTypeOptions?.pattern).toBeUndefined();
    expect(back.quality).toEqual(c.schema[0]!.properties[0]!.quality);
  });

  it('marks zero-tolerance null rules required, and keeps the declared required set apart', () => {
    const c = {
      ...contract,
      schema: [
        {
          name: 't',
          properties: [
            {
              name: 'a',
              logicalType: 'string' as const,
              quality: [{ metric: 'nullValues', mustBe: 0 }],
            },
          ],
        },
      ],
    };
    const s = toJsonSchema(c, 't') as any;
    expect(s.required).toEqual(['a']);
    expect(s.properties.a.type).toBe('string');
    expect(fromJsonSchema(s, 't').properties![0]!.required).toBeUndefined();
  });
});

describe('options in JSON Schema', () => {
  const schemaOf = (prop: Record<string, unknown>) => {
    const c = {
      ...contract,
      schema: [
        { name: 't', properties: [{ name: 'v', required: true, ...prop }] },
      ],
    } as typeof contract;
    return { c, s: toJsonSchema(c, 't') as any };
  };

  it('keeps multipleOf, uniqueItems and properties counts, as 2020-12 keywords', () => {
    expect(
      schemaOf({
        logicalType: 'number',
        logicalTypeOptions: { multipleOf: 0.1 },
      }).s.properties.v.multipleOf,
    ).toBe(0.1);
    expect(
      schemaOf({
        logicalType: 'array',
        logicalTypeOptions: { uniqueItems: true },
      }).s.properties.v.uniqueItems,
    ).toBe(true);
    expect(
      schemaOf({
        logicalType: 'object',
        logicalTypeOptions: { minProperties: 1, required: ['k'] },
      }).s.properties.v,
    ).toMatchObject({ minProperties: 1, required: ['k'] });
    expect(
      schemaOf({
        logicalType: 'integer',
        logicalTypeOptions: { minimum: 0, exclusiveMinimum: true },
      }).s.properties.v,
    ).toMatchObject({ exclusiveMinimum: 0 });
    expect(
      schemaOf({
        logicalType: 'integer',
        logicalTypeOptions: { minimum: 0, exclusiveMinimum: true },
      }).s.properties.v.minimum,
    ).toBeUndefined();
  });

  it('does not state date bounds as numeric minimum, and round-trips every option verbatim', () => {
    const { s } = schemaOf({
      logicalType: 'date',
      logicalTypeOptions: { minimum: '2020-01-01' },
    });
    expect(s.properties.v.minimum).toBeUndefined();
    const { c, s: s2 } = schemaOf({
      logicalType: 'integer',
      logicalTypeOptions: { format: 'i32', minimum: 0 },
    });
    expect(fromJsonSchema(s2, 't').properties![0]!.logicalTypeOptions).toEqual(
      c.schema![0]!.properties![0]!.logicalTypeOptions,
    );
    expect(s.properties.v['x-odcs-logicalTypeOptions']).toEqual({
      minimum: '2020-01-01',
    });
  });
});

describe('the exported schema agrees with runtime, checked by a real 2020-12 validator', () => {
  const agree = (prop: Record<string, unknown>, values: unknown[]) => {
    const c = {
      ...contract,
      schema: [
        { name: 't', properties: [{ name: 'v', required: true, ...prop }] },
      ],
    } as typeof contract;
    // multipleOfPrecision: Ajv divides in binary floating point by default (19.99 / 0.01 = 1998.99…).
    const check = new Ajv2020({
      strict: false,
      allErrors: true,
      multipleOfPrecision: 12,
    }).compile(toJsonSchema(c, 't'));
    for (const v of values)
      expect({ v, schema: check({ v }) }).toEqual({
        v,
        schema: validateRecord(c, 't', { v }).every(
          (x) => x.severity !== 'error',
        ),
      });
  };

  it('on integer-, boolean- and number-keyed maps', () => {
    agree(
      {
        logicalType: 'map',
        map: {
          key: { logicalType: 'integer' },
          value: { logicalType: 'string' },
        },
      },
      [{ '42': 'ok' }, { '-7': 'ok' }, { x: 'no' }, { '4.2': 'no' }],
    );
    agree(
      {
        logicalType: 'map',
        map: {
          key: { logicalType: 'boolean' },
          value: { logicalType: 'string' },
        },
      },
      [{ true: 'ok' }, { false: 'ok' }, { yes: 'no' }],
    );
    agree(
      {
        logicalType: 'map',
        map: {
          key: { logicalType: 'number' },
          value: { logicalType: 'string' },
        },
      },
      [{ '1.5': 'ok' }, { '1e3': 'ok' }, { '0x1f': 'no' }, { ' 1': 'no' }],
    );
  });

  it('on multipleOf, allowances, enums, optional nulls and exclusive bounds', () => {
    agree(
      { logicalType: 'number', logicalTypeOptions: { multipleOf: 0.01 } },
      [19.99, 0.3, 0.005],
    );
    agree(
      {
        logicalType: 'string',
        required: false,
        quality: [
          {
            metric: 'invalidValues',
            arguments: { validValues: ['a'] },
            mustBeLessOrEqualTo: 1,
          },
        ],
      },
      ['a', 'z', null],
    );
    agree({ logicalType: 'string', required: false, enum: [{ value: 'a' }] }, [
      'a',
      'b',
      null,
    ]);
    agree(
      {
        logicalType: 'integer',
        logicalTypeOptions: { minimum: 0, exclusiveMinimum: true },
      },
      [0, 1, -1],
    );
  });

  it('needs multipleOfPrecision in Ajv: by default Ajv rejects 19.99 as a multiple of 0.01', () => {
    const c = {
      ...contract,
      schema: [
        {
          name: 't',
          properties: [
            {
              name: 'v',
              required: true,
              logicalType: 'number' as const,
              logicalTypeOptions: { multipleOf: 0.01 },
            },
          ],
        },
      ],
    };
    expect(
      new Ajv2020({ strict: false }).compile(toJsonSchema(c, 't'))({
        v: 19.99,
      }),
    ).toBe(false);
    expect(validateRecord(c, 't', { v: 19.99 })).toEqual([]);
  });

  it('round-trips an integer map key', () => {
    const c = {
      ...contract,
      schema: [
        {
          name: 't',
          properties: [
            {
              name: 'v',
              logicalType: 'map' as const,
              map: {
                key: {
                  logicalType: 'integer' as const,
                  logicalTypeOptions: { minimum: 0 },
                },
                value: { logicalType: 'string' as const },
              },
            },
          ],
        },
      ],
    };
    expect(
      fromJsonSchema(toJsonSchema(c, 't'), 't').properties![0]!.map?.key,
    ).toEqual({ logicalType: 'integer', logicalTypeOptions: { minimum: 0 } });
  });
});

describe('what JSON Schema can state is exported; what it cannot is named', () => {
  const exported = (prop: Record<string, unknown>) => {
    const c = {
      ...contract,
      schema: [
        { name: 't', properties: [{ name: 'v', required: true, ...prop }] },
      ],
    } as typeof contract;
    return {
      c,
      s: toJsonSchema(c, 't') as any,
      check: new Ajv2020({ strict: false, multipleOfPrecision: 12 }).compile(
        toJsonSchema(c, 't'),
      ),
    };
  };

  it('names integer-key bounds as unenforced and keeps a non-negative floor as a pattern', () => {
    const { s, check } = exported({
      logicalType: 'map',
      map: {
        key: { logicalType: 'integer', logicalTypeOptions: { minimum: 10 } },
        value: { logicalType: 'string' },
      },
    });
    expect(s.properties.v.propertyNames['x-odcs-unenforced']).toContain(
      'minimum',
    );
    expect(check({ v: { '-1': 'x' } })).toBe(false);
    expect(check({ v: { '42': 'x' } })).toBe(true);
  });

  it('states safe integer formats and vector element types, and names i64, date bounds and normalized', () => {
    const i8 = exported({
      logicalType: 'integer',
      logicalTypeOptions: { format: 'i8', minimum: -10 },
    });
    expect(i8.s.properties.v).toMatchObject({ minimum: -10, maximum: 127 });
    for (const v of [-11, -10, 127, 128])
      expect(i8.check({ v })).toBe(
        validateRecord(i8.c, 't', { v }).length === 0,
      );
    expect(
      exported({
        logicalType: 'integer',
        logicalTypeOptions: { format: 'i64' },
      }).s.properties.v['x-odcs-unenforced'],
    ).toEqual(['format']);
    expect(
      exported({
        logicalType: 'date',
        logicalTypeOptions: { minimum: '2020-01-01' },
      }).s.properties.v['x-odcs-unenforced'],
    ).toEqual(['minimum']);
    const vec = exported({
      logicalType: 'vector',
      logicalTypeOptions: { elementType: 'int8', normalized: true },
    });
    expect(vec.check({ v: [1, 200] })).toBe(false);
    expect(vec.s.properties.v['x-odcs-unenforced']).toEqual(['normalized']);
  });
});

describe('enum equality agrees with JSON Schema', () => {
  const both = (
    prop: Record<string, unknown>,
    value: unknown,
    lenient = false,
  ) => {
    const c = {
      ...contract,
      schema: [
        { name: 't', properties: [{ name: 'v', required: true, ...prop }] },
      ],
    } as typeof contract;
    const schema = new Ajv2020({ strict: false }).compile(toJsonSchema(c, 't'))(
      { v: value },
    );
    return {
      schema,
      runtime: validateRecord(c, 't', { v: value }, { lenient }).every(
        (x) => x.severity !== 'error',
      ),
    };
  };

  it('reads an integer key enum by its text: 042 is not 42', () => {
    const map = {
      logicalType: 'map',
      map: {
        key: { logicalType: 'integer', enum: [{ value: 42 }] },
        value: { logicalType: 'string' },
      },
    };
    expect(both(map, { '042': 'x' })).toEqual({
      schema: false,
      runtime: false,
    });
    expect(both(map, { '42': 'x' })).toEqual({ schema: true, runtime: true });
  });

  it('does not let "42" equal 42 unless reading a driver leniently', () => {
    expect(both({ enum: [{ value: 42 }] }, '42')).toEqual({
      schema: false,
      runtime: false,
    });
    expect(both({ enum: [{ value: 42 }] }, 42)).toEqual({
      schema: true,
      runtime: true,
    });
    expect(both({ enum: [{ value: 42 }] }, '42', true).runtime).toBe(true);
  });
});
