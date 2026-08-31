import { span as autotelSpan } from 'autotel-web/full';
import {
  instrumentBuiltInAI as instrumentWithSpan,
  type InstrumentOptions,
  type Instrumentation,
  type SpanFn,
} from './instrument';

/**
 * Instrument Chrome's built-in AI APIs, sending spans through autotel-web.
 *
 * autotel-web is a peer dependency, so the import is static: it keeps `span()`
 * synchronous, and a dynamic one would turn every call into a promise. That
 * also means this entry reaches the OpenTelemetry browser SDK. Import
 * `autotel-builtin-ai/core` and pass your own `span` to avoid it.
 *
 * Safe to call unconditionally: with no built-in AI globals present — an
 * unflagged Chrome, another browser, or server rendering — it patches nothing
 * and returns a no-op handle.
 */
export function instrumentBuiltInAI(
  options: InstrumentOptions = {},
): Instrumentation {
  // SAFETY: autotel-web's `span()` is generic over the value its callback
  // returns, which is exactly `SpanFn`; the assertion only restates that
  // across the package boundary, and the callback shape is checked by the
  // compiler at every call site inside the instrumentation.
  const span: SpanFn = options.span ?? (autotelSpan as SpanFn);
  return instrumentWithSpan({ ...options, span });
}

export {
  describeDownload,
  describeRefusal,
  describeSamplingOption,
  guardWouldRefuse,
} from './describe';
export type {
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
