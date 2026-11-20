#!/usr/bin/env node
/**
 * autotel-datacontract: the CI side of an ODCS data contract.
 *
 *   autotel-datacontract lint <contract.yaml>
 *   autotel-datacontract diff <old.yaml> <new.yaml> [--json]
 *   autotel-datacontract check <old.yaml> <new.yaml>        exit 1 when the version bump is too small
 *   autotel-datacontract satisfies <provider.yaml> <expectation.yaml>   exit 1 when an expectation is unmet
 *   autotel-datacontract verify <contract.yaml> <data.json|.ndjson> --object <name> [--json] [--record <results.ndjson>]
 *                                         exit 1 failed, 3 incomplete (a rule that should run did not)
 *   autotel-datacontract json-schema <contract.yaml> --object <name>
 */
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { lintContract, parseContract } from './contract.js';
import {
  diffContracts,
  formatDiff,
  formatSatisfaction,
  satisfies,
} from './diff.js';
import { formatReport, resultLines } from './format.js';
import { toJsonSchema } from './json-schema.js';
import { checkRecords } from './profile.js';
import { parse as parseYaml } from 'yaml';

const USAGE = `usage:
  autotel-datacontract lint <contract.yaml>
  autotel-datacontract diff <old.yaml> <new.yaml> [--json]
  autotel-datacontract check <old.yaml> <new.yaml>
  autotel-datacontract satisfies <provider.yaml> <expectation.yaml> [--json]
  autotel-datacontract verify <contract.yaml> <data.json|.ndjson> --object <name> [--json] [--record <results.ndjson>]
  autotel-datacontract json-schema <contract.yaml> --object <name>`;

const STDIO = { out: console.log, err: console.error };

export function run(argv: string[], io = STDIO): number {
  const positional: string[] = [];
  let json = false;
  let object: string | undefined;
  let record: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') json = true;
    else if (a === '--object') object = argv[++i];
    else if (a === '--record') record = argv[++i];
    else if (a === '-h' || a === '--help') positional.unshift('help');
    else positional.push(a);
  }
  const [command, first, second] = positional;
  const load = (file: string) =>
    parseContract(readFileSync(file, 'utf8')).contract;
  try {
    switch (command) {
      case 'lint': {
        if (!first) break;
        const issues = lintContract(
          parseYaml(readFileSync(first, 'utf8')),
          first,
        );
        if (json) io.out(JSON.stringify(issues, null, 2));
        else
          for (const i of issues)
            io.out(`${i.severity} ${i.path}: ${i.message} (${i.code})`);
        if (!json && issues.length === 0) io.out('ok');
        return issues.some((i) => i.severity === 'error') ? 1 : 0;
      }
      case 'diff':
      case 'check': {
        if (!first || !second) break;
        const diff = diffContracts(load(first), load(second));
        io.out(json ? JSON.stringify(diff, null, 2) : formatDiff(diff));
        return command === 'check' && !diff.ok ? 1 : 0;
      }
      case 'satisfies': {
        if (!first || !second) break;
        const result = satisfies(load(first), load(second));
        io.out(
          json ? JSON.stringify(result, null, 2) : formatSatisfaction(result),
        );
        return result.ok ? 0 : 1;
      }
      case 'verify': {
        if (!first || !second || !object) break;
        const text = readFileSync(second, 'utf8');
        const rows =
          second.endsWith('.ndjson') || second.endsWith('.jsonl')
            ? text
                .split('\n')
                .filter((l) => l.trim())
                .map((l) => JSON.parse(l) as Record<string, unknown>)
            : (JSON.parse(text) as Array<Record<string, unknown>>);
        const report = checkRecords(load(first), object, rows);
        // The track record: one line per run, beside the contract.
        if (record) appendFileSync(record, resultLines(report));
        io.out(json ? JSON.stringify(report, null, 2) : formatReport(report));
        if (!json && report.status === 'incomplete')
          io.err(
            'incomplete: some rules could not run here; see "skipped" above',
          );
        return report.status === 'passed'
          ? 0
          : report.status === 'failed'
            ? 1
            : 3;
      }
      case 'json-schema': {
        if (!first || !object) break;
        io.out(JSON.stringify(toJsonSchema(load(first), object), null, 2));
        return 0;
      }
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 2;
  }
  (command === 'help' ? io.out : io.err)(USAGE);
  return command === 'help' ? 0 : 2;
}

// Run only as the binary (matched by basename, as autotel-schema does), not when imported in tests.
const entry = process.argv[1] ? path.basename(process.argv[1]) : '';
if (
  entry === 'autotel-datacontract' ||
  entry === 'cli.js' ||
  entry === 'cli.cjs'
) {
  process.exitCode = run(process.argv.slice(2));
}
