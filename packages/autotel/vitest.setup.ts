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

/**
 * Reclaim `beforeExit` listeners between tests.
 *
 * `init()` installs one so a process that finishes normally still flushes its
 * telemetry. Suites here call `vi.resetModules()`, which hands the next import
 * a fresh module instance whose bookkeeping cannot see the listener the
 * previous copy registered. They accumulate until Node warns about a memory
 * leak at ten: noise rather than a defect, but noise in the wrong place.
 */
const baselineBeforeExitListeners = new Set(process.listeners('beforeExit'));

afterEach(() => {
  for (const listener of process.listeners('beforeExit')) {
    if (!baselineBeforeExitListeners.has(listener)) {
      process.removeListener('beforeExit', listener);
    }
  }
});

// Clean up after all tests complete
afterAll(() => {
  contextManager.disable();
});
