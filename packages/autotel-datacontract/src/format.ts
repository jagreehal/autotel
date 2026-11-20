import type { CheckReport } from './profile.js';

const pct = (r?: number) =>
  r === undefined ? '' : ` (${(r * 100).toFixed(r < 0.01 ? 2 : 1)}%)`;
const dur = (ms?: number) =>
  ms === undefined || !Number.isFinite(ms)
    ? 'no data'
    : ms >= 86_400_000
      ? `${(ms / 86_400_000).toFixed(1)}d`
      : `${(ms / 3_600_000).toFixed(1)}h`;

/** Markdown summary of check or audit reports: promises broken, variances, gaps, rules, SLAs. */
export function formatReport(reports: CheckReport | CheckReport[]): string {
  const out: string[] = [];
  for (const r of Array.isArray(reports) ? reports : [reports]) {
    out.push(
      `## ${r.contract.id}@${r.contract.version} / ${r.object}: ${r.status === 'passed' ? 'passed' : r.status.toUpperCase()} (${r.rows} rows)`,
    );
    for (const level of ['error', 'warning', 'info'] as const) {
      const fs = r.findings.filter((f) => f.severity === level);
      if (!fs.length) continue;
      out.push(
        '',
        `### ${{ error: 'Broken promises', warning: 'Variances the contract does not cover', info: 'Gaps in the contract' }[level]}`,
      );
      for (const f of fs)
        out.push(
          `- \`${f.path}\` ${f.code}: ${f.message}${f.count === undefined ? '' : `, ${f.count} rows${pct(f.rate)}`}${f.actual ? ` [${f.actual}]` : ''}`,
        );
    }
    if (r.unchecked.length) {
      out.push('', '### Not checked');
      for (const u of r.unchecked) out.push(`- ? ${u}`);
    }
    if (r.quality.length) {
      out.push('', '### Quality rules');
      for (const q of r.quality) {
        const what =
          q.rule.description ??
          `${q.metric}${q.property ? ` on ${q.property}` : ''}`;
        out.push(
          `- ${{ 'not-run': '?', 'not-executable': '○', passed: '✓', failed: '✖' }[q.status]} ${what}${q.skipped ? `: skipped, ${q.skipped}` : q.error ? `: ${q.error}` : `: ${q.value}${q.sampled ? ' (sampled)' : ''}`}`,
        );
      }
    }
    if (r.sla.length) {
      out.push('', '### Service levels');
      for (const s of r.sla)
        out.push(
          `- ${{ kept: '✓', breached: '✖', unknown: '?', 'not-executable': '○' }[s.status]} ${s.property} on ${s.element}: ${s.error ?? dur(s.observedMs)} against ${dur(s.limitMs)}`,
        );
    }
    out.push('');
  }
  return out.join('\n');
}

/**
 * Reports as track-record lines: one JSON line per report, `{ "at", ...report }`,
 * for a scheduled check to append to `<contract>.results.ndjson` beside the
 * contract. Reports carry no values, so the file is safe to commit or publish,
 * and a catalog reads it for the contract's track record. One call is one run.
 */
export function resultLines(
  reports: CheckReport | CheckReport[],
  at: Date = new Date(),
): string {
  return (Array.isArray(reports) ? reports : [reports])
    .map((r) => `${JSON.stringify({ at: at.toISOString(), ...r })}\n`)
    .join('');
}
