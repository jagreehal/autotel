/**
 * @cloudflare/actors integration for autotel-cloudflare
 *
 * Provides deep instrumentation for the Cloudflare Actors framework,
 * tracing all lifecycle methods and providing Actor-specific semantic attributes.
 *
 * @example
 * ```typescript
 * import { Actor } from '@cloudflare/actors'
 * import { instrumentActor, tracedHandler } from 'autotel-cloudflare/actors'
 *
 * class MyActor extends Actor<Env> {
 *   protected onInit() {
 *     // Automatically traced with 'actor.lifecycle': 'init'
 *   }
 *
 *   protected onRequest(request: Request) {
 *     // Automatically traced with full HTTP semantics + actor context
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
 */

export { instrumentActor } from './instrument-actor';
export { tracedHandler, wrapHandler } from './traced-handler';
export { instrumentActorStorage } from './storage';
export { instrumentActorAlarms } from './alarms';
export { instrumentActorSockets } from './sockets';
export type { ActorConfig, ActorInstrumentationOptions } from './types';
