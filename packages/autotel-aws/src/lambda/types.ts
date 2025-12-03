/**
 * Lambda-specific types
 */

import type { LambdaEvent, LambdaContext } from '../types';

/**
 * Lambda handler function signature
 */
export type LambdaHandler<TEvent = LambdaEvent, TResult = unknown> = (
  event: TEvent,
  context: LambdaContext
) => Promise<TResult>;

/**
 * Lambda trigger type
 */
export type LambdaTrigger = 'http' | 'pubsub' | 'datasource' | 'timer' | 'other';
