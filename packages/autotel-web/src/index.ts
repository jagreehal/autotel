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
export { init, type AutotelWebConfig } from './init';

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
