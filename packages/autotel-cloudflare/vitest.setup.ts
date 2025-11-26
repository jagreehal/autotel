/**
 * Vitest setup file
 * Configures OpenTelemetry context manager for tests
 */

import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

// Set up AsyncLocalStorageContextManager for proper context isolation in tests
const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

// Clean up after all tests complete
afterAll(() => {
  contextManager.disable();
});
