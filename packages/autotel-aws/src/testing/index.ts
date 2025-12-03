/**
 * Testing utilities for autotel-aws
 *
 * @example
 * ```typescript
 * import { createLambdaTestHarness } from 'autotel-aws/testing';
 *
 * const harness = createLambdaTestHarness();
 * const result = await harness.invoke(handler, mockEvent, mockContext);
 * ```
 */

export { createLambdaTestHarness } from './lambda-harness';
export { createLocalStackHelpers } from './localstack';
