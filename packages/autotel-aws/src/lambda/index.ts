/**
 * Lambda handler instrumentation
 *
 * @example
 * ```typescript
 * import { wrapHandler } from 'autotel-aws/lambda';
 *
 * export const handler = wrapHandler(async (event, context) => {
 *   return { statusCode: 200 };
 * });
 * ```
 */

export { wrapHandler, traceLambda } from './handler';
export {
  tracingMiddleware,
  LambdaMiddleware,
  getSpanFromRequest,
  getContextFromRequest,
} from './middleware';
export { extractTraceContext, detectTriggerType } from './context-extractor';
export type * from './types';
