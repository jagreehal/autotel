/**
 * Lambda test harness utilities
 */

import type { LambdaHandler } from '../lambda/types';
import type { LambdaContext } from '../types';

/**
 * Mock Lambda context for testing
 */
export function createMockLambdaContext(overrides?: Partial<LambdaContext>): LambdaContext {
  return {
    awsRequestId: 'test-request-id',
    functionName: 'test-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '128',
    getRemainingTimeInMillis: () => 30_000,
    ...overrides,
  };
}

/**
 * Lambda test harness
 */
export function createLambdaTestHarness() {
  return {
    /**
     * Invoke a Lambda handler with test event and context
     */
    async invoke<TEvent, TResult>(
      handler: LambdaHandler<TEvent, TResult>,
      event: TEvent,
      context?: Partial<LambdaContext>
    ): Promise<TResult> {
      const mockContext = createMockLambdaContext(context);
      return handler(event, mockContext);
    },
  };
}
