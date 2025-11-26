/**
 * Operation context tracking using AsyncLocalStorage
 *
 * This module provides a way to track operation names across async boundaries
 * so they can be automatically captured in events events.
 *
 * We cannot read span attributes from OpenTelemetry's API (it's write-only),
 * so we maintain our own async context storage.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Operation context that flows through async operations
 */
export interface OperationContext {
  /**
   * The name of the current operation
   * This is set by trace() or span() and can be read by events
   */
  name: string;
}

/**
 * AsyncLocalStorage instance for tracking operation context
 */
const operationStorage = new AsyncLocalStorage<OperationContext>();

/**
 * Get the current operation context (if any)
 *
 * @returns The current operation context, or undefined if not in an operation
 *
 * @example
 * ```typescript
 * const ctx = getOperationContext();
 * if (ctx) {
 *   console.log('Current operation:', ctx.name);
 * }
 * ```
 */
export function getOperationContext(): OperationContext | undefined {
  return operationStorage.getStore();
}

/**
 * Run a function within an operation context
 *
 * This sets the operation name for the duration of the function execution,
 * including all async operations spawned from it.
 *
 * @param name - The operation name to set
 * @param fn - The function to execute within the context
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const result = await runInOperationContext('user.create', async () => {
 *   // Any events.trackEvent() calls here will automatically capture
 *   // 'operation.name': 'user.create'
 *   await createUser();
 *   return 'success';
 * });
 * ```
 */
export function runInOperationContext<T>(name: string, fn: () => T): T {
  return operationStorage.run({ name }, fn);
}

/**
 * Update the operation name in the current context
 *
 * This is useful when you want to change the operation name within
 * an already-established context (e.g., when entering a nested span).
 *
 * @param name - The new operation name
 *
 * @example
 * ```typescript
 * runInOperationContext('parent.operation', () => {
 *   // operation.name is 'parent.operation'
 *
 *   updateOperationName('nested.operation');
 *   // operation.name is now 'nested.operation'
 * });
 * ```
 */
export function updateOperationName(name: string): void {
  const store = operationStorage.getStore();
  if (store) {
    store.name = name;
  }
}
