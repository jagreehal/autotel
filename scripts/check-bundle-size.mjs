#!/usr/bin/env node
/**
 * Measure each `packages/autotel*` build output and compare against the
 * baseline at `bundle-size-baseline.json`. Fails (exit 1) when any package
 * grew by more than the configured tolerance — designed to run in CI as a
 * cheap regression guard.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs              compare against baseline
 *   node scripts/check-bundle-size.mjs --update     write the current sizes
 *                                                   back to the baseline
 *   node scripts/check-bundle-size.mjs --json       emit machine-readable
 *                                                   sizes only (no compare)
 *
 * Tolerance is per-package, expressed in bytes. Defaults: +5% or +2 KiB,
 * whichever is larger.
 */
import { readdirSync, statSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');
const BASELINE_PATH = join(ROOT, 'bundle-size-baseline.json');

const TOLERANCE_PCT = 0.05; // 5%
const TOLERANCE_BYTES = 2 * 1024; // 2 KiB
const KIB = 1024;

function dirSize(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else if (entry.isFile()) {
      total += statSync(full).size;
    }
  }
  return total;
}

function listAutotelPackages() {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('autotel'))
    .map((d) => d.name)
    .sort();
}

function measureAll() {
  const sizes = {};
  for (const name of listAutotelPackages()) {
    const dist = join(PACKAGES_DIR, name, 'dist');
    sizes[name] = dirSize(dist);
  }
  return sizes;
}

function formatKib(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse ${BASELINE_PATH}: ${err.message}`);
    return null;
  }
}

function compare(baseline, current) {
  const rows = [];
  let regressed = 0;

  for (const name of Object.keys(current).sort()) {
    const before = baseline?.sizes?.[name] ?? 0;
    const after = current[name];
    const delta = after - before;
    const tolerance = Math.max(TOLERANCE_BYTES, before * TOLERANCE_PCT);
    const isNew = before === 0 && after > 0;
    // New packages can't regress — they have no baseline yet.
    const overTolerance = !isNew && delta > tolerance;
    if (overTolerance) regressed += 1;

    rows.push({
      name,
      before,
      after,
      delta,
      pct: before === 0 ? null : (delta / before) * 100,
      overTolerance,
      isNew,
    });
  }

  return { rows, regressed };
}

function printReport({ rows, regressed }) {
  const padName = Math.max(...rows.map((r) => r.name.length));
  console.log(
    `${'package'.padEnd(padName)}  ${'before'.padStart(12)}  ${'after'.padStart(12)}  ${'delta'.padStart(12)}`,
  );
  console.log('-'.repeat(padName + 12 * 3 + 6));
  for (const row of rows) {
    const prefix = row.overTolerance ? '🔺' : row.isNew ? '🆕' : '  ';
    const pct = row.pct === null ? '   new' : `${row.pct >= 0 ? '+' : ''}${row.pct.toFixed(1)}%`;
    console.log(
      `${prefix} ${row.name.padEnd(padName - 1)}  ${formatKib(row.before).padStart(12)}  ${formatKib(row.after).padStart(12)}  ${`${row.delta >= 0 ? '+' : ''}${formatKib(row.delta)} ${pct}`.padStart(12)}`,
    );
  }
  console.log();
  if (regressed > 0) {
    console.log(`❌ ${regressed} package(s) exceeded the size tolerance (${TOLERANCE_PCT * 100}% / ${formatKib(TOLERANCE_BYTES)}).`);
    console.log(`   If the growth is intentional, run \`node scripts/check-bundle-size.mjs --update\` and commit ${BASELINE_PATH}.`);
  } else {
    console.log('✅ all packages within tolerance');
  }
}

function main() {
  const args = process.argv.slice(2);
  const current = measureAll();

  if (args.includes('--json')) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), sizes: current }, null, 2));
    return;
  }

  if (args.includes('--update')) {
    const data = { generatedAt: new Date().toISOString(), sizes: current };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`wrote ${BASELINE_PATH} for ${Object.keys(current).length} packages`);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.warn('No baseline found — printing current sizes only.');
    console.warn(`Run \`node scripts/check-bundle-size.mjs --update\` to create one.\n`);
  }

  const result = compare(baseline ?? { sizes: {} }, current);
  printReport(result);
  if (result.regressed > 0) process.exit(1);
}

main();
