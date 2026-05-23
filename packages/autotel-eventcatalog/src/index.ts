// autotel-eventcatalog
//
// Diff your autotel architecture snapshot against an EventCatalog and report
// drift. Same shape as Pact, for event architectures.

export { loadSnapshot } from './snapshot';
export type { ArchitectureSnapshot, EventObservation } from './snapshot';

export { readCatalogState, extractDeclaredFieldPaths } from './catalog';
export type {
  CatalogState,
  CatalogEvent,
  CatalogService,
  CatalogChannel,
} from './catalog';

export { diffCatalogAgainstSnapshot, hasDrift, countDriftReport } from './diff';
export type {
  DriftReport,
  EventDrift,
  FieldDrift,
  ServiceDrift,
  ChannelDrift,
  DriftCounts,
} from './diff';

export {
  compareDriftReports,
  countDriftEntries,
  countDriftDelta,
} from './diff-vs-base';
export type { DriftDelta, DriftEntries } from './diff-vs-base';

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
} from './report';
export type {
  JsonReport,
  JsonReportEnvelope,
  Renderer,
  RendererName,
} from './report';

export { evaluatePolicy } from './policy';
export type {
  DriftPolicyMode,
  PolicyEvaluationInput,
  PolicyEvaluationResult,
} from './policy';

export {
  stampCatalog,
  buildStampBlock,
  buildStampSummary,
  STAMP_START,
  STAMP_END,
  STAMP_SUMMARY_SPEC,
} from './stamp';
export type {
  StampOptions,
  StampResult,
  StampUpdate,
  StampSkip,
  StampSummary,
} from './stamp';
