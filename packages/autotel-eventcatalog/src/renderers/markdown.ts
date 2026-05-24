// GitHub-flavoured Markdown — the default. Used directly as the body of
// the sticky PR comment posted by the bundled action.

import type { DriftReport, FieldDrift } from '../diff';
import { hasDrift } from '../diff';
import type { DriftDelta, DriftEntries } from '../diff-vs-base';
import type { Renderer } from './types';

export function renderMarkdown(report: DriftReport): string {
  const lines: string[] = [
    '# Architecture drift report',
    '',
    `_Snapshot from \`${report.snapshotService}\` at ${report.snapshotGeneratedAt}_`,
    '',
  ];

  if (!hasDrift(report)) {
    lines.push('No drift detected. Catalog and runtime agree.', '');
    return lines.join('\n');
  }

  if (report.events.observedButUndocumented.length > 0) {
    lines.push(
      '## Events observed but undocumented',
      '',
      'These event names appear in the snapshot but no matching entry',
      'exists in the catalog. Add them or stop emitting them.',
      '',
    );
    for (const name of report.events.observedButUndocumented) {
      lines.push(`- \`${name}\``);
    }
    lines.push('');
  }

  if (report.events.documentedButUnseen.length > 0) {
    lines.push(
      '## Events documented but never observed',
      '',
      'These events exist in the catalog but no payload was captured.',
      'Either the tests do not exercise this event, or it has been removed.',
      '',
    );
    for (const name of report.events.documentedButUnseen) {
      lines.push(`- \`${name}\``);
    }
    lines.push('');
  }

  if (report.events.fieldDrift.length > 0) {
    lines.push('## Field-path drift', '');
    for (const drift of report.events.fieldDrift) {
      lines.push(`### \`${drift.event}\``, '');
      if (drift.extra.length > 0) {
        lines.push(
          '**Extra fields in payloads (not in declared schema):**',
          '',
        );
        for (const p of drift.extra) lines.push(`- \`${p}\``);
        lines.push('');
      }
      if (drift.missing.length > 0) {
        lines.push('**Fields declared but never observed:**', '');
        for (const p of drift.missing) lines.push(`- \`${p}\``);
        lines.push('');
      }
    }
  }

  if ((report.events.typeDrift ?? []).length > 0) {
    lines.push('## Type drift', '');
    for (const drift of report.events.typeDrift ?? []) {
      lines.push(
        `- \`${drift.event}\` \`${drift.path}\``,
        `  declared: \`${drift.declared.join(' | ')}\`, observed: \`${drift.observed.join(' | ')}\``,
      );
    }
    lines.push('');
  }

  if ((report.events.valueDrift ?? []).length > 0) {
    lines.push('## Value drift', '');
    for (const drift of report.events.valueDrift ?? []) {
      lines.push(
        `- \`${drift.event}\` \`${drift.path}\``,
        `  declared enum: \`${drift.declared.map((v) => JSON.stringify(v)).join(', ')}\`, observed: \`${drift.observed.map((v) => JSON.stringify(v)).join(', ')}\``,
      );
    }
    lines.push('');
  }

  if (report.services.observedButUndocumented.length > 0) {
    lines.push('## Services observed but undocumented', '');
    for (const id of report.services.observedButUndocumented) {
      lines.push(`- \`${id}\``);
    }
    lines.push('');
  }

  if (report.channels.observedButUndocumented.length > 0) {
    lines.push('## Channels observed but undocumented', '');
    for (const id of report.channels.observedButUndocumented) {
      lines.push(`- \`${id}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render the diff-of-diffs as a PR-comment-friendly markdown block. Sections
 * appear only when they have content, so a clean PR produces a tight message.
 */
export function renderDeltaMarkdown(delta: DriftDelta): string {
  const lines: string[] = [
    '# Architecture drift — what this change introduces',
    '',
  ];

  if (!delta.hasNewDrift) {
    const fixedAny = entriesHasContent(delta.resolved);
    if (fixedAny) {
      lines.push('No new drift. The changes below resolve existing drift:', '');
      renderEntries(delta.resolved, lines, { sign: '−' });
    } else {
      lines.push('No new drift detected. Catalog and runtime agree.');
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push('This change introduces drift:', '');
  renderEntries(delta.introduced, lines, { sign: '+' });

  if (entriesHasContent(delta.resolved)) {
    lines.push('', '### Resolved by this change', '');
    renderEntries(delta.resolved, lines, { sign: '−' });
  }

  return lines.join('\n');
}

function entriesHasContent(e: DriftEntries): boolean {
  return (
    e.events.observedButUndocumented.length > 0 ||
    e.events.documentedButUnseen.length > 0 ||
    e.events.fieldDrift.length > 0 ||
    (e.events.typeDrift ?? []).length > 0 ||
    (e.events.valueDrift ?? []).length > 0 ||
    e.services.observedButUndocumented.length > 0 ||
    e.channels.observedButUndocumented.length > 0
  );
}

function renderEntries(
  entries: DriftEntries,
  out: string[],
  options: { sign: '+' | '−' },
): void {
  if (entries.events.observedButUndocumented.length > 0) {
    out.push('**Events observed but undocumented**', '');
    for (const n of entries.events.observedButUndocumented) {
      out.push(`- \`${n}\``);
    }
    out.push('');
  }
  if (entries.events.documentedButUnseen.length > 0) {
    out.push('**Events documented but never observed**', '');
    for (const n of entries.events.documentedButUnseen) {
      out.push(`- \`${n}\``);
    }
    out.push('');
  }
  for (const fd of entries.events.fieldDrift) {
    out.push(`**Field drift on \`${fd.event}\`**`, '');
    for (const p of fd.extra) out.push(`- ${options.sign} \`${p}\` (extra)`);
    for (const p of fd.missing)
      out.push(`- ${options.sign} \`${p}\` (missing)`);
    out.push('');
  }
  for (const td of entries.events.typeDrift ?? []) {
    out.push(
      `**Type drift on \`${td.event}\` \`${td.path}\`**`,
      '',
      `- ${options.sign} declared \`${td.declared.join(' | ')}\`, observed \`${td.observed.join(' | ')}\``,
      '',
    );
  }
  for (const vd of entries.events.valueDrift ?? []) {
    out.push(
      `**Value drift on \`${vd.event}\` \`${vd.path}\`**`,
      '',
      `- ${options.sign} declared enum \`${vd.declared.map((v) => JSON.stringify(v)).join(', ')}\`, observed \`${vd.observed.map((v) => JSON.stringify(v)).join(', ')}\``,
      '',
    );
  }
  if (entries.services.observedButUndocumented.length > 0) {
    out.push('**Services observed but undocumented**', '');
    for (const id of entries.services.observedButUndocumented) {
      out.push(`- \`${id}\``);
    }
    out.push('');
  }
  if (entries.channels.observedButUndocumented.length > 0) {
    out.push('**Channels observed but undocumented**', '');
    for (const id of entries.channels.observedButUndocumented) {
      out.push(`- \`${id}\``);
    }
    out.push('');
  }
  // FieldDrift import kept for typing of the for..of above; reference here so
  // the import isn't flagged as unused by some linter configurations.
  void (null as unknown as FieldDrift);
}

export const markdownRenderer: Renderer = {
  name: 'markdown',
  description:
    'GitHub-flavoured Markdown (default). Suitable for sticky PR comments.',
  renderReport: renderMarkdown,
  renderDelta: renderDeltaMarkdown,
};
