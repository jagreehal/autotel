/**
 * Worker entrypoint for CounterActor
 * 
 * This worker uses the tracedHandler from autotel-cloudflare/actors
 * to provide full OpenTelemetry instrumentation for the Actor.
 * 
 * The handler automatically:
 * - Creates root spans for each request
 * - Traces Actor lifecycle methods (onInit, onRequest, onAlarm)
 * - Traces storage operations (SQL queries)
 * - Traces alarm operations
 * - Propagates trace context
 */

import actorHandler from './actor';
import type { worker } from '../alchemy.run.ts';

// The tracedHandler from actor.ts already provides full instrumentation
// We just need to export it as the default export
export default actorHandler;

// Export the Actor class for Durable Object binding configuration
export { CounterActor } from './actor';

// Type the handler for TypeScript
const handler: ExportedHandler<typeof worker.Env> = actorHandler;

export { handler };

