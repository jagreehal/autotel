/**
 * autotel-sentry: Bridge OpenTelemetry (Autotel) traces to Sentry.
 */
export { SentrySpanProcessor, createSentrySpanProcessor } from './processor';
export type { SentryLike } from './processor';
export { SentryPropagator, SENTRY_PROPAGATION_KEY } from './propagator';
export type { SentryPropagationData } from './propagator';
