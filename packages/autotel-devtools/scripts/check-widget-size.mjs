import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const budgets = [
  // gzip +1 KB: issue status in the Errors tab, plus registering Tailwind's
  // @property variables on the document (without it every transform, border
  // and ring utility is a no-op inside the shadow root). 145,085 measured.
  // gzip +1 KB: sized for Node 24, the release runtime. 146,273 measured.
  { file: 'widget.global.js', raw: 500_000, gzip: 147_000 },
  // +15 KB raw for the Issues automations UI (destinations, triggers, runs),
  // which only the full viewer carries: 698,127 → 708,754 bytes measured.
  { file: 'fullpage.global.js', raw: 715_000, gzip: 212_000 },
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
