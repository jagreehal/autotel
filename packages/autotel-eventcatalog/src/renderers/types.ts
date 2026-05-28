// Renderers are pluggable adapters that turn a drift result into output text.
// The core domain (diff / diff-vs-base / policy) is renderer-agnostic; new
// output targets (SARIF, GitHub Check Runs API, Slack-flavoured markdown) plug
// in here without touching the core.
//
// Two render shapes:
//   - `RenderReport`   for full reports (mode === 'all')
//   - `RenderDelta`    for diff-of-diffs (mode === 'new-only')
//
// A `Renderer` implements both; most renderers can share helpers between the
// two; so the registry can dispatch by `(mode, format)` without branches.

import type { DriftReport } from '../diff';
import type { DriftDelta } from '../diff-vs-base';

export type RenderReport = (report: DriftReport) => string;
export type RenderDelta = (delta: DriftDelta) => string;

export interface Renderer {
  /** Short name used by the CLI's `--format` flag. */
  readonly name: string;
  /** One-line human description shown in CLI help and the README. */
  readonly description: string;
  readonly renderReport: RenderReport;
  readonly renderDelta: RenderDelta;
}
