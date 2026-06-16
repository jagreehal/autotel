#!/usr/bin/env node
/**
 * autotel-schema CLI — the CI gate for your telemetry's public API.
 *
 *   autotel-schema diff <baseline.json> <current.json>   # classify changes
 *   autotel-schema check <baseline.json> <current.json>  # exit 1 on breaking
 *
 * Both operate on snapshot JSON produced by `serializeSnapshot(contractToSnapshot(contract))`.
 * Commit the baseline; regenerate `current` in CI; gate the merge on `check`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSnapshot } from './snapshot.js';
import {
  diffSnapshots,
  formatDiff,
  hasBreakingChanges,
  type SnapshotDiff,
} from './diff.js';

interface Parsed {
  command: string | undefined;
  baseline: string | undefined;
  current: string | undefined;
  json: boolean;
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg === '-h' || arg === '--help') positional.unshift('help');
    else positional.push(arg);
  }
  return {
    command: positional[0],
    baseline: positional[1],
    current: positional[2],
    json,
  };
}

const USAGE = `autotel-schema — treat your trace surface like a versioned public API

Usage:
  autotel-schema diff  <baseline.json> <current.json> [--json]
  autotel-schema check <baseline.json> <current.json> [--json]

Commands:
  diff    Print every change (breaking / additive / neutral). Always exits 0.
  check   Like diff, but exits 1 if any breaking change is found (CI gate).

Snapshots are produced with serializeSnapshot(contractToSnapshot(contract)).`;

function loadDiff(baseline: string, current: string): SnapshotDiff {
  const prev = parseSnapshot(readFileSync(baseline, 'utf8'));
  const next = parseSnapshot(readFileSync(current, 'utf8'));
  return diffSnapshots(prev, next);
}

function emit(diff: SnapshotDiff, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(diff, null, 2));
  } else {
    console.log(formatDiff(diff));
  }
}

export function run(argv: string[]): number {
  const { command, baseline, current, json } = parseArgs(argv);

  if (!command || command === 'help') {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  if (command !== 'diff' && command !== 'check') {
    console.error(`autotel-schema: unknown command "${command}"\n\n${USAGE}`);
    return 1;
  }

  if (!baseline || !current) {
    console.error('autotel-schema: both <baseline.json> and <current.json> are required\n');
    console.error(USAGE);
    return 1;
  }

  let diff: SnapshotDiff;
  try {
    diff = loadDiff(baseline, current);
  } catch (error) {
    console.error(
      `autotel-schema: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  emit(diff, json);

  if (command === 'check' && hasBreakingChanges(diff)) {
    console.error(
      `\nautotel-schema: ${diff.breaking.length} breaking change(s) to the telemetry contract. ` +
        `Bump the contract major version and update the committed snapshot.`,
    );
    return 1;
  }
  return 0;
}

// Only auto-run when invoked directly as the binary, not when imported in tests.
// Match the basename so a repo path containing "autotel-schema" can't trigger it.
const entry = process.argv[1] ? path.basename(process.argv[1]) : '';
if (entry === 'autotel-schema' || entry === 'cli.js' || entry === 'cli.cjs') {
  process.exit(run(process.argv.slice(2)));
}
