// Versioned JSON envelope. Downstream tooling (dashboards, custom CI steps,
// Slack bots) should read this rather than scraping the Markdown body. The
// shape is governed by the published schema at
// `schemas/drift-report-v0.2.0.json` and locked by golden contract tests.

import type { DriftReport } from '../diff';
import type { DriftDelta } from '../diff-vs-base';
import type { Renderer } from './types';

/**
 * Versioned identifier baked into the JSON envelope. Bumping it is a
 * breaking change for downstream consumers — add fields rather than rename.
 */
export const REPORT_SPEC = 'autotel-eventcatalog-report/v0.2.0' as const;

export type JsonReport =
  | { mode: 'all'; report: DriftReport }
  | { mode: 'new-only'; delta: DriftDelta };

export type JsonReportEnvelope = { spec: typeof REPORT_SPEC } & JsonReport;

export function renderJson(data: JsonReport): string {
  const envelope: JsonReportEnvelope = { spec: REPORT_SPEC, ...data };
  return JSON.stringify(envelope, null, 2);
}

export const jsonRenderer: Renderer = {
  name: 'json',
  description:
    'Versioned JSON envelope. Validate against schemas/drift-report-v0.2.0.json.',
  renderReport: (report) => renderJson({ mode: 'all', report }),
  renderDelta: (delta) => renderJson({ mode: 'new-only', delta }),
};
