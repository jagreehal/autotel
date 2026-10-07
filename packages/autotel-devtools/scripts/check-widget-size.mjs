import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const budgets = [
  // gzip +1 KB: issue status in the Errors tab, plus registering Tailwind's
  // @property variables on the document (without it every transform, border
  // and ring utility is a no-op inside the shadow root). 145,085 measured.
  // gzip +1 KB: sized for Node 24, the release runtime. 146,273 measured.
  // +4 KB raw / +1 KB gzip for the waterfall's N+1 (×N) and FULL SCAN badges
  // and indented MongoDB statements; plan diagnosis and the Queries tab stay
  // full-page only (db-panels.lean.ts). Main measured 500,399 / 146,423 (raw
  // already over); with them 502,780 / 147,200.
  { file: 'widget.global.js', raw: 504_000, gzip: 148_000 },
  // +15 KB raw for the Issues automations UI (destinations, triggers, runs),
  // which only the full viewer carries: 698,127 → 708,754 bytes measured.
  // +20 KB raw / +5 KB gzip for the Queries tab (statements grouped by hash,
  // plans, N+1, trends) and span-detail plan diagnosis: 711,414 / 209,819 →
  // 730,453 / 216,039 measured.
  // +5 KB raw / +3 KB gzip for query-plan diagnosis (PlanDiagnosis): capture
  // states with setup, plan provenance, stage chains, index advice with the
  // reason and per-field roles. Mostly explanatory copy: 739,975 / 219,479.
  // +2 KB raw / +1 KB gzip for explain guidance per instrumentation (setup,
  // the manual driver path, or "no plan capture"): 742,281 / 220,295.
  { file: 'fullpage.global.js', raw: 745_000, gzip: 221_000 },
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
