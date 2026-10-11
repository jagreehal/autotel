/**
 * Lambda durable functions: additions to AWS's OpenTelemetry plugins
 * (`@aws/durable-execution-sdk-js-otel`) for when autotel owns the provider.
 *
 * @packageDocumentation
 */

export { durableFlush, autotelContextExtractor } from './durable/enhance';
export {
  durableExecutionContext,
  isDurableExecutionStatusChange,
  withInvokeTraceContext,
  invokerSpanContext,
  type DurableExecutionStatusChangeEvent,
  type InvokeTraceContext,
} from './durable/context';
