/**
 * Type definitions for @cloudflare/actors integration
 */

import type { ConfigurationOption } from 'autotel-edge';

/**
 * Actor-specific instrumentation options
 */
export interface ActorInstrumentationOptions {
  /**
   * Whether to instrument storage operations (sql queries, etc.)
   * @default true
   */
  instrumentStorage?: boolean;

  /**
   * Whether to instrument alarm operations
   * @default true
   */
  instrumentAlarms?: boolean;

  /**
   * Whether to instrument socket operations
   * @default true
   */
  instrumentSockets?: boolean;

  /**
   * Whether to capture persist events as spans
   * @default true
   */
  capturePersistEvents?: boolean;

  /**
   * Custom span name formatter for lifecycle methods
   */
  spanNameFormatter?: (actorName: string, lifecycle: string) => string;
}

/**
 * Actor-specific configuration
 * Can be a static config object with actors options, or a function that returns config
 */
export type ActorConfig = ConfigurationOption & {
  /**
   * Actor-specific instrumentation options
   */
  actors?: ActorInstrumentationOptions;
};

/**
 * Actor lifecycle events that can be traced
 */
export type ActorLifecycle =
  | 'init'
  | 'request'
  | 'alarm'
  | 'persist'
  | 'websocket.connect'
  | 'websocket.message'
  | 'websocket.disconnect'
  | 'websocket.upgrade'
  | 'destroy';

/**
 * Semantic attributes for Actor spans
 */
export interface ActorSpanAttributes {
  'actor.name': string;
  'actor.class': string;
  'actor.lifecycle': ActorLifecycle;
  'actor.coldstart'?: boolean;
  'actor.identifier'?: string;
  'actor.tracking.enabled'?: boolean;
}

/**
 * Minimal interface matching @cloudflare/actors Actor class
 * We don't import the actual type to avoid coupling
 */
export interface ActorLike {
  name?: string;
  identifier?: string;
  storage?: unknown;
  alarms?: unknown;
  sockets?: unknown;
  fetch?(request: Request): Promise<Response>;
  alarm?(alarmInfo?: unknown): Promise<void>;
}

/**
 * Constructor type for Actor classes
 */
export type ActorConstructor<T extends ActorLike = ActorLike> = new (
  state: DurableObjectState,
  env: unknown,
) => T;
