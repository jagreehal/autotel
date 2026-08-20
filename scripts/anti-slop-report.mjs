#!/usr/bin/env node
// Shows anti-slop findings with source context. Usage: node scripts/anti-slop-report.mjs <path-prefix> [--context=4]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [prefix = '', ...rest] = process.argv.slice(2);
const context = Number(
  rest.find((a) => a.startsWith('--context='))?.split('=')[1] ?? 4,
);
// oxlint exits non-zero whenever it reports anything, which is the normal case here.
let raw;
try {
  raw = execFileSync(
    './node_modules/.bin/oxlint',
    ['--format=json', prefix || '.'],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 256,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
} catch (error) {
  raw = error.stdout;
}
const { diagnostics } = JSON.parse(raw);
const findings = diagnostics.filter((d) =>
  (d.code || '').startsWith('anti-slop'),
);
const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.filename)) byFile.set(f.filename, []);
  byFile.get(f.filename).push(f);
}
for (const [file, list] of [...byFile].sort(
  (a, b) => b[1].length - a[1].length,
)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  console.log(`\n${'='.repeat(72)}\n${file}  (${list.length})`);
  for (const f of list.sort(
    (a, b) => a.labels[0].span.line - b.labels[0].span.line,
  )) {
    const { line } = f.labels[0].span;
    console.log(
      `--- ${line}: ${f.code.replace('anti-slop', '').replace(/[()]/g, '')}`,
    );
    for (
      let i = Math.max(1, line - context);
      i <= Math.min(lines.length, line + context);
      i++
    ) {
      console.log(
        `${String(i).padStart(5)}${i === line ? '>' : ' '} ${lines[i - 1]}`,
      );
    }
  }
}
console.log(`\ntotal: ${findings.length}`);
