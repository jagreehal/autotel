import { span as autotelSpan } from 'autotel-web/full';
import {
  instrumentWebMCP as instrumentWithSpan,
  type InstrumentOptions,
  type Instrumentation,
  type SpanFn,
} from './instrument';

/**
 * Instrument WebMCP, sending spans through autotel-web.
 *
 * autotel-web is a peer dependency, so the import is static: it keeps `span()`
 * synchronous, and a dynamic one would turn every tool execution into a
 * promise. That also means this entry reaches the OpenTelemetry browser SDK.
 * Import `autotel-webmcp/core` and pass your own `span` to avoid it.
 */
export function instrumentWebMCP(
  options: InstrumentOptions = {},
): Instrumentation {
  return instrumentWithSpan({
    ...options,
    span: options.span ?? (autotelSpan as SpanFn),
  });
}

export {
  describeRefusal,
  describeResult,
  descriptorFingerprint,
  diffAnnotations,
  labelMismatch,
} from './describe';
export type {
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
