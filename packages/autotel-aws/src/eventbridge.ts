/**
 * EventBridge instrumentation entry point
 *
 * @packageDocumentation
 */

export {
  traceEventBridge,
  injectEventBridgeContext,
  extractEventBridgeContext,
  stripEventBridgeContext,
  EventBridgePublisher,
  type TraceEventBridgeConfig,
  type EventBridgePublisherConfig,
  type EventBridgeEvent,
  type EventBridgeLambdaEvent,
} from './eventbridge/index';
