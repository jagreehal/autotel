/**
 * `autotel-webmcp/core` — the instrumentation with no telemetry dependency.
 *
 * Import this when you already have somewhere to put spans, or when you are
 * loading the package straight into a browser with no bundler. It pulls in
 * nothing beyond itself, so `autotel-web` and the OpenTelemetry browser SDK
 * stay out of your bundle.
 *
 * `autotel-webmcp` is the same instrumentation with autotel-web's `span()`
 * already wired in.
 */
export { instrumentWebMCP } from './instrument';
export {
  describeRefusal,
  describeResult,
  descriptorFingerprint,
  diffAnnotations,
  labelMismatch,
} from './describe';
export type {
  CoreInstrumentOptions,
  InstrumentOptions,
  Instrumentation,
  SpanApi,
  SpanFn,
} from './instrument';
export type {
  DescriptorFields,
  RefusalKind,
  ResultDescription,
} from './describe';
