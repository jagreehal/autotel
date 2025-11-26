/**
 * @cloudflare/actors integration entry point
 *
 * Provides deep OpenTelemetry instrumentation for the Cloudflare Actors framework.
 *
 * @example Basic Usage
 * ```typescript
 * import { Actor } from '@cloudflare/actors'
 * import { instrumentActor, tracedHandler } from 'autotel-cloudflare/actors'
 *
 * class MyActor extends Actor<Env> {
 *   protected onInit() {
 *     // Automatically traced
 *   }
 *
 *   protected onRequest(request: Request) {
 *     // Automatically traced with HTTP semantics
 *     return new Response('Hello!')
 *   }
 * }
 *
 * export { MyActor }
 * export default tracedHandler(MyActor, (env) => ({
 *   service: { name: 'my-actor-service' },
 *   exporter: { url: env.OTLP_ENDPOINT }
 * }))
 * ```
 *
 * @example With Existing handler()
 * ```typescript
 * import { Actor, handler } from '@cloudflare/actors'
 * import { wrapHandler } from 'autotel-cloudflare/actors'
 *
 * class MyActor extends Actor<Env> {}
 *
 * export { MyActor }
 * export default wrapHandler(handler(MyActor), (env) => ({
 *   service: { name: 'my-service' }
 * }))
 * ```
 *
 * @packageDocumentation
 */

export { instrumentActor } from './actors/instrument-actor';
export { tracedHandler, wrapHandler } from './actors/traced-handler';
export { instrumentActorStorage } from './actors/storage';
export { instrumentActorAlarms } from './actors/alarms';
export { instrumentActorSockets } from './actors/sockets';
export type { ActorConfig, ActorInstrumentationOptions, ActorLifecycle } from './actors/types';
