import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const budgets = [
  { file: 'widget.global.js', raw: 500_000, gzip: 145_000 },
  { file: 'fullpage.global.js', raw: 700_000, gzip: 210_000 },
];

let failed = false;
for (const budget of budgets) {
  const content = readFileSync(resolve('dist', budget.file));
  const gzip = gzipSync(content).byteLength;
  const withinBudget = content.byteLength <= budget.raw && gzip <= budget.gzip;
  const status = withinBudget ? 'OK' : 'OVER';
  console.log(
    `${status} ${budget.file}: ${content.byteLength}/${budget.raw} raw, ${gzip}/${budget.gzip} gzip`,
  );
  failed ||= !withinBudget;
}

if (failed) process.exitCode = 1;
