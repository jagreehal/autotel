// Registry of available renderers. The CLI dispatches `--format <name>`
// through here; future renderers (sarif, slack, github-check-runs) drop in
// by adding an entry to `RENDERERS`.

import type { Renderer } from './types';
import { markdownRenderer } from './markdown';
import { terminalRenderer } from './terminal';
import { jsonRenderer } from './json';

export const RENDERERS: readonly Renderer[] = [
  markdownRenderer,
  terminalRenderer,
  jsonRenderer,
];

export const RENDERER_NAMES = RENDERERS.map((r) => r.name);

export function getRenderer(name: string): Renderer | undefined {
  return RENDERERS.find((r) => r.name === name);
}

export type RendererName = (typeof RENDERER_NAMES)[number];

// Re-export the individual functions for backwards compatibility — they have
// been the public API since v0.1.0 and consumers may import them directly.

export { renderMarkdown, renderDeltaMarkdown } from './markdown';
export { renderTerminal, renderDeltaTerminal } from './terminal';
export {
  renderJson,
  REPORT_SPEC,
  type JsonReport,
  type JsonReportEnvelope,
} from './json';
export { type Renderer } from './types';
