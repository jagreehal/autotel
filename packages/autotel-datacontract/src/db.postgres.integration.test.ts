/**
 * Against a real PostgreSQL in Docker: citext, a non-deterministic ICU
 * collation, CHAR(n) and an enum type. Opt in with DATACONTRACT_PG_DOCKER=1.
 */
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseContract } from './contract.js';
import { auditDatabase, type QueryFn } from './db.js';

const enabled = process.env.DATACONTRACT_PG_DOCKER === '1';
const name = `datacontract-pg-${process.pid}`;
const psql = (input: string) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      name,
      'psql',
      '-U',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
const query: QueryFn = async (sql) =>
  JSON.parse(
    psql(`SELECT coalesce(json_agg(q), '[]') FROM (${sql}) q;`).trim(),
  );

describe.skipIf(!enabled)('PostgreSQL, live', () => {
  beforeAll(() => {
    execFileSync('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '-e',
      'POSTGRES_PASSWORD=x',
      'postgres:17-alpine',
    ]);
    for (let i = 0; i < 60; i++) {
      try {
        psql('SELECT 1;');
        break;
      } catch {
        execFileSync('sleep', ['1']);
      }
    }
    psql(`CREATE EXTENSION citext;
      CREATE COLLATION ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);
      CREATE TYPE mood AS ENUM ('active', 'ACTIVE');
      CREATE TABLE t (id integer PRIMARY KEY, s citext, v varchar(20) COLLATE ci, c char(8), m mood);
      INSERT INTO t VALUES (1, 'active', 'active', 'active', 'active'), (2, 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE');`);
  }, 120_000);
  afterAll(() => {
    execFileSync('docker', ['rm', '-f', name]);
  });

  const prop = (n: string, extra = {}) => ({
    name: n,
    logicalType: 'string',
    description: n,
    enum: [{ value: 'active' }],
    ...extra,
  });
  const contract = parseContract({
    apiVersion: 'v3.2.0',
    kind: 'DataContract',
    id: 'live',
    version: '1.0.0',
    status: 'active',
    schema: [
      {
        name: 't',
        properties: [
          {
            name: 'id',
            logicalType: 'integer',
            primaryKey: true,
            description: 'id',
          },
          prop('s', { unique: true }),
          prop('v', { unique: true }),
          prop('c'),
          prop('m'),
        ],
      },
    ],
  }).contract;

  it('finds ACTIVE under citext and a case-insensitive collation without reading a row', async () => {
    const [r] = await auditDatabase(contract, {
      dialect: 'postgres',
      query,
      sampleSize: 0,
    });
    expect(
      r!.findings
        .filter((f) => f.code === 'invalid-value')
        .map((f) => `${f.path}:${f.count}`)
        .toSorted(),
    ).toEqual(['s:1', 'v:1']);
    expect(r!.findings.filter((f) => f.code === 'duplicate-key')).toEqual([]);
    expect(r!.unchecked).toEqual([
      expect.stringMatching(/checked only there: c, m/),
    ]);
  });

  it('agrees with the runtime on every column when it reads every row', async () => {
    const [r] = await auditDatabase(contract, {
      dialect: 'postgres',
      query,
      sampleSize: Infinity,
    });
    // CHAR(8) comes back padded ('active  '), so neither row is 'active' to the runtime.
    expect(
      r!.findings
        .filter((f) => f.code === 'invalid-value')
        .map((f) => `${f.path}:${f.count}`)
        .toSorted(),
    ).toEqual(['c:2', 'm:1', 's:1', 'v:1']);
    expect(r!.unchecked).toEqual([]);
  });
});
