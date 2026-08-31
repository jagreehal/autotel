/**
 * Autotel Web - Ultra-Lightweight Browser SDK (~2-5KB gzipped)
 *
 * Minimal W3C trace propagation for browser → backend distributed tracing.
 *
 * **NO OpenTelemetry dependencies**
 * **NO real spans in browser** (backend does the real tracing)
 * **Just automatic traceparent header injection**
 *
 * @example Basic Setup
 * ```typescript
 * import { init } from 'autotel-web'
 *
 * init({ service: 'my-frontend-app' })
 *
 * // All fetch/XHR calls now include traceparent headers!
 * fetch('/api/users')  // <-- traceparent automatically injected
 * ```
 *
 * @example With Functional API
 * ```typescript
 * import { init, trace } from 'autotel-web'
 *
 * init({ service: 'my-app' })
 *
 * const fetchUser = trace(async (id: string) => {
 *   const res = await fetch(`/api/users/${id}`)
 *   return res.json()
 * })
 * ```
 *
 * @example Backend Receives Trace
 * ```typescript
 * // Backend (Express + Autotel)
 * import { init, trace } from 'autotel'
 *
 * init({ service: 'my-api', endpoint: 'http://localhost:4318' })
 *
 * app.get('/api/users', async (req, res) => {
 *   // traceparent header automatically extracted!
 *   const users = await trace(() => db.users.findAll())()
 *   res.json(users)
 * })
 * ```
 *
 * @module autotel-web
 */

// Core initialization
export { init, setBaggage, clearBaggage, type AutotelWebConfig } from './init';

// Span exporter
export {
  emitEvent,
  setEventSink,
  type EventAttributes,
  type EventSink,
} from './emit-event';

export {
  flushSpans,
  pendingLogCount,
  pendingSpanCount,
  recordEvent,
  recordLog,
  type FlushOptions,
  type LogSeverity,
} from './span-exporter';

// Console output as OpenTelemetry log records
export {
  captureConsoleAsLogs,
  type ConsoleLogsConfig,
} from './browser-logs';

// Canonical OpenTelemetry names for browser telemetry
export {
  APP,
  AUTOTEL_WEB,
  BROWSER,
  SESSION,
  USER_AGENT,
  WEB_EVENT,
} from './semconv';

// Browser resource context (`browser.*`)
export {
  browserResourceAttributes,
  type BrowserResourceAttributes,
} from './browser-context';

// Session-consistent sampling
export { sampleByKey } from './sampling';
export { createSessionRatioSampler } from './sampler';

// What happened before the error
export {
  addBreadcrumb,
  collectBreadcrumbs,
  configureBreadcrumbs,
  readBreadcrumbs,
  type Breadcrumb,
  type BreadcrumbCollectors,
  type BreadcrumbsConfig,
} from './breadcrumbs';

// Clicks that achieved nothing, and clicks repeated in frustration
export {
  setupFrustrationSignals,
  type DeadClickConfig,
  type FrustrationConfig,
  type RageClickConfig,
} from './frustration';

// How much of the page was actually read
export {
  setupEngagement,
  PAGE_ENGAGEMENT_ATTR,
  PAGE_ENGAGEMENT_EVENT,
  type EngagementConfig,
} from './engagement';

// Capture settings that can change without a release
export {
  applyRemoteSuppression,
  cachedRemoteConfig,
  refreshRemoteConfig,
  resolveCaptureToggles,
  type RemoteConfig,
} from './remote-config';

// Privacy types (re-exported from init.ts which imports from privacy.ts)
export type { PrivacyConfig } from './privacy';

// Functional API (DX wrappers)
export {
  trace,
  getActiveContext,
  getTraceparent,
  extractContext,
  type TraceContext,
} from './functional';

// Low-level traceparent utilities (advanced usage)
export {
  createTraceparent,
  generateTraceId,
  generateSpanId,
  parseTraceparent,
} from './traceparent';
