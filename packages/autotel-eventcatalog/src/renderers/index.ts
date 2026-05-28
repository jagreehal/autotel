// Registry of available renderers. The CLI dispatches `--format <name>`
// through here; future renderers (sarif, slack, github-check-runs) drop in
// by adding an entry to `RENDERERS`.

import type { Renderer } from './types';
import { markdownRenderer } from './markdown';
import { terminalRenderer } from './terminal';
import { jsonRenderer } from './json';
import { eventcatalogSnapshotDiffRenderer } from './eventcatalog-snapshot-diff';

const BUILTIN_RENDERERS: readonly Renderer[] = [
  markdownRenderer,
  terminalRenderer,
  jsonRenderer,
  eventcatalogSnapshotDiffRenderer,
];

const extraRenderers: Renderer[] = [];

/**
 * @deprecated Use `listRenderers()` for the full registry (built-ins plus
 * any registered at runtime). Kept for backwards compatibility.
 */
export const RENDERERS: readonly Renderer[] = BUILTIN_RENDERERS;

/**
 * Names of the built-in renderers, narrowed to a string literal union via
 * `as const`. Custom renderers registered via `registerRenderer` widen the
 * runtime set but not this type; the CLI uses `listRendererNames()` for
 * runtime listings.
 */
export const RENDERER_NAMES = [
  'markdown',
  'terminal',
  'json',
  'eventcatalog-snapshot-diff',
] as const;

export type RendererName = (typeof RENDERER_NAMES)[number];

export function getRenderer(name: string): Renderer | undefined {
  return listRenderers().find((r) => r.name === name);
}

export function listRenderers(): readonly Renderer[] {
  return [...BUILTIN_RENDERERS, ...extraRenderers];
}

export function listRendererNames(): readonly string[] {
  return listRenderers().map((r) => r.name);
}

/**
 * Register a custom renderer at runtime. The CLI calls this when a
 * `--register-renderer <module>` flag is supplied; library users may call
 * it directly before invoking `runDrift`/`runStamp`/`runGenerate`.
 */
export function registerRenderer(renderer: Renderer): void {
  if (getRenderer(renderer.name)) {
    throw new Error(
      `Renderer name "${renderer.name}" is already registered. Pick a different name or unregister the previous renderer first.`,
    );
  }
  extraRenderers.push(renderer);
}

/** @internal Reset the runtime registry between tests. */
export function clearRegisteredRenderersForTests(): void {
  extraRenderers.length = 0;
}

// Re-export the individual functions for backwards compatibility. They have
// been the public API since v0.1.0 and consumers may import them directly.

export { renderMarkdown, renderDeltaMarkdown } from './markdown';
export { renderTerminal, renderDeltaTerminal } from './terminal';
export {
  renderJson,
  REPORT_SPEC,
  type JsonReport,
  type JsonReportEnvelope,
} from './json';
export {
  EVENTCATALOG_SNAPSHOT_DIFF_SPEC,
  renderEventCatalogSnapshotDiffFromReport,
  renderEventCatalogSnapshotDiffFromDelta,
  type EventCatalogSnapshotDiffEnvelope,
} from './eventcatalog-snapshot-diff';
export { type Renderer } from './types';
