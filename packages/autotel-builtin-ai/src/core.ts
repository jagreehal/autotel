/**
 * `autotel-builtin-ai/core` — the instrumentation with no telemetry dependency.
 *
 * Import this when you already have somewhere to put spans, or when you are
 * loading the package straight into a browser with no bundler. It pulls in
 * nothing beyond itself, so `autotel-web` and the OpenTelemetry browser SDK
 * stay out of your bundle.
 *
 * `autotel-builtin-ai` is the same instrumentation with autotel-web's `span()`
 * already wired in.
 */
export { instrumentBuiltInAI } from './instrument';
export {
  describeDownload,
  describeRefusal,
  describeSamplingOption,
  guardWouldRefuse,
} from './describe';
export type {
  CoreInstrumentOptions,
  InstrumentOptions,
  Instrumentation,
  SpanApi,
  SpanFn,
} from './instrument';
export type { DownloadFacts, RefusalKind, SamplingOption } from './describe';
export { BUILTIN_AI_APIS, SESSION_METHODS } from './types';
export type {
  Availability,
  BuiltInApiName,
  BuiltInSession,
  CreateOptions,
} from './types';
