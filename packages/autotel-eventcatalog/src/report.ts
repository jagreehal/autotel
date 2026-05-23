// Backwards-compatible re-export of the renderer surface.
//
// The actual implementations live in `./renderers/<name>.ts` — see the
// Renderer adapter pattern there. This module exists so any consumer (or
// internal test) that imports from `'./report'` continues to work.
//
// New renderers should be added under `./renderers/` and registered in
// `./renderers/index.ts`; do not add new exports here.

export {
  renderMarkdown,
  renderDeltaMarkdown,
  renderTerminal,
  renderDeltaTerminal,
  renderJson,
  REPORT_SPEC,
  RENDERERS,
  RENDERER_NAMES,
  getRenderer,
} from './renderers/index';

export type {
  Renderer,
  RendererName,
  JsonReport,
  JsonReportEnvelope,
} from './renderers/index';
