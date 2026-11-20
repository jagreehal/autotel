import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { run } from './cli.js';
import { parseContract } from './contract.js';
import { customersYaml } from './__fixtures__/index.js';

const dir = mkdtempSync(path.join(tmpdir(), 'datacontract-'));
const file = (name: string, text: string) => {
  const p = path.join(dir, name);
  writeFileSync(p, text);
  return p;
};
const exec = (...argv: string[]) => {
  const lines: string[] = [];
  const code = run(argv, {
    out: (s: string) => lines.push(s),
    err: (s: string) => lines.push(s),
  });
  return { code, text: lines.join('\n') };
};

/** v1 with customer_id retyped to integer, under a minor bump only. */
function retyped() {
  const { contract } = parseContract(customersYaml);
  contract.version = '1.1.0';
  contract.schema![0]!.properties![0]!.logicalType = 'integer';
  return contract;
}

describe('cli', () => {
  const v1 = file('v1.yaml', customersYaml);
  it('lints', () => expect(exec('lint', v1)).toMatchObject({ code: 0 }));
  it('gates a breaking change behind a major bump', () => {
    const v2 = file('v2.yaml', stringify(retyped()));
    expect(exec('check', v1, v2)).toMatchObject({ code: 1 });
    expect(exec('diff', v1, v2).code).toBe(0);
  });
  it('verifies an ndjson export', () => {
    const data = file(
      'rows.ndjson',
      `${JSON.stringify({ customer_id: 'c1', customer_name: 'A', annual_premium: -1 })}\n`,
    );
    const r = exec('verify', v1, data, '--object', 'customers');
    expect(r.code).toBe(1);
    expect(r.text).toContain('below-minimum');
  });
  it('exits 3, not 0, when a valid batch leaves a rule unrun', () => {
    const data = file(
      'fresh.json',
      JSON.stringify([
        {
          customer_id: 'c1',
          customer_name: 'A',
          annual_premium: 1,
          customer_status: 'active',
          last_updated_at: new Date().toISOString(),
        },
      ]),
    );
    expect(exec('verify', v1, data, '--object', 'customers').code).toBe(3);
  });
  it('checks a consumer expectation against the provider', () => {
    const wants = (type: string) =>
      file(
        `wants-${type}.yaml`,
        stringify({
          apiVersion: 'v3.2.0',
          kind: 'DataContract',
          id: 'needs',
          version: '1.0.0',
          status: 'active',
          schema: [
            {
              name: 'customers',
              properties: [{ name: 'customer_id', logicalType: type }],
            },
          ],
        }),
      );
    expect(exec('satisfies', v1, wants('string'))).toMatchObject({ code: 0 });
    const r = exec('satisfies', v1, wants('integer'));
    expect(r.code).toBe(1);
    expect(r.text).toContain(
      'customers.customer_id: logicalType integer → string',
    );
  });
  it('warns when the file name disagrees with the major version', () => {
    const named = file('customers_v2.odcs.yaml', customersYaml);
    expect(exec('lint', named)).toMatchObject({
      code: 0,
      text: expect.stringContaining('file-name-version'),
    });
  });
  it('appends the run to a track record', () => {
    const data = file(
      'one.json',
      JSON.stringify([
        { customer_id: 'c1', customer_name: 'A', annual_premium: -1 },
      ]),
    );
    const results = path.join(dir, 'customers_v1.results.ndjson');
    exec('verify', v1, data, '--object', 'customers', '--record', results);
    exec('verify', v1, data, '--object', 'customers', '--record', results);
    const lines = readFileSync(results, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ object: 'customers', status: 'failed' });
    expect(Number.isNaN(Date.parse(lines[0].at))).toBe(false);
    // No values: only types and contract paths.
    expect(JSON.stringify(lines)).not.toContain('"A"');
  });
  it('prints usage on a bad call', () => expect(exec('nope').code).toBe(2));
});
