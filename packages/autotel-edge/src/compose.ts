/**
 * Composition utilities for autotel-edge
 *
 * Helper functions for composing instrumentation and middleware.
 *
 * @example
 * ```typescript
 * import { compose } from 'autotel-edge/api/compose'
 * import { instrumentGlobalFetch, instrumentGlobalCache } from 'autotel-edge/instrumentation'
 *
 * const setupInstrumentation = compose(
 *   instrumentGlobalFetch,
 *   instrumentGlobalCache
 * )
 *
 * setupInstrumentation({ enabled: true })
 * ```
 */

/**
 * Compose multiple setup functions into one
 *
 * Takes multiple instrumentation functions and returns a single function
 * that calls them all in order with the same config.
 *
 * @example
 * ```typescript
 * const setup = compose(
 *   instrumentGlobalFetch,
 *   instrumentGlobalCache
 * )
 *
 * setup({ enabled: true })
 * ```
 */
export function compose<TConfig = unknown>(
  ...fns: Array<(config?: TConfig) => void>
): (config?: TConfig) => void {
  return (config?: TConfig) => {
    for (const fn of fns) {
      fn(config);
    }
  };
}

/**
 * Compose multiple async setup functions into one
 *
 * Like `compose` but for async functions.
 *
 * @example
 * ```typescript
 * const setup = composeAsync(
 *   async (config) => { await initTracing(config) },
 *   async (config) => { await initMetrics(config) }
 * )
 *
 * await setup({ endpoint: 'https://...' })
 * ```
 */
export function composeAsync<TConfig = unknown>(
  ...fns: Array<(config?: TConfig) => Promise<void>>
): (config?: TConfig) => Promise<void> {
  return async (config?: TConfig) => {
    for (const fn of fns) {
      await fn(config);
    }
  };
}

/**
 * Pipe - compose functions from left to right
 *
 * Unlike `compose` which is right-to-left, pipe is left-to-right
 * which matches the execution order visually.
 *
 * @example
 * ```typescript
 * const setup = pipe(
 *   (config) => ({ ...config, tracing: true }),
 *   (config) => ({ ...config, metrics: true }),
 *   (config) => initObservability(config)
 * )
 *
 * setup({ service: 'my-worker' })
 * ```
 */
export function pipe<TInput, TOutput>(
  ...fns: Array<(input: any) => any>
): (input: TInput) => TOutput {
  return (input: TInput) => {
    return fns.reduce((acc, fn) => fn(acc), input as any) as TOutput;
  };
}

/**
 * Create a conditional instrumentation function
 *
 * Only runs the instrumentation if the predicate returns true.
 *
 * @example
 * ```typescript
 * const setupFetch = when(
 *   (env) => env.ENABLE_FETCH_TRACING === 'true',
 *   instrumentGlobalFetch
 * )
 *
 * setupFetch(env)
 * ```
 */
export function when<TConfig = unknown>(
  predicate: (config?: TConfig) => boolean,
  fn: (config?: TConfig) => void
): (config?: TConfig) => void {
  return (config?: TConfig) => {
    if (predicate(config)) {
      fn(config);
    }
  };
}

/**
 * Create a conditional async instrumentation function
 *
 * @example
 * ```typescript
 * const setupCache = whenAsync(
 *   async (env) => await featureEnabled('cache-tracing'),
 *   instrumentGlobalCache
 * )
 *
 * await setupCache(env)
 * ```
 */
export function whenAsync<TConfig = unknown>(
  predicate: (config?: TConfig) => Promise<boolean> | boolean,
  fn: (config?: TConfig) => Promise<void>
): (config?: TConfig) => Promise<void> {
  return async (config?: TConfig) => {
    if (await predicate(config)) {
      await fn(config);
    }
  };
}

/**
 * Tap - run a side effect and return the original value
 *
 * Useful for logging or debugging in a pipe.
 *
 * @example
 * ```typescript
 * const setup = pipe(
 *   tap((config) => console.log('Initial config:', config)),
 *   (config) => ({ ...config, tracing: true }),
 *   tap((config) => console.log('After tracing:', config)),
 *   (config) => initObservability(config)
 * )
 * ```
 */
export function tap<T>(fn: (value: T) => void): (value: T) => T {
  return (value: T) => {
    fn(value);
    return value;
  };
}

/**
 * Memoize - cache the result of a function
 *
 * Useful for expensive initialization functions that should only run once.
 *
 * @example
 * ```typescript
 * const setup = memoize(() => {
 *   console.log('Setting up (expensive)...')
 *   instrumentGlobalFetch()
 *   instrumentGlobalCache()
 * })
 *
 * setup() // Logs "Setting up (expensive)..."
 * setup() // Does nothing (cached)
 * setup() // Does nothing (cached)
 * ```
 */
export function memoize<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => TReturn
): (...args: TArgs) => TReturn {
  const cached: { hasValue: boolean; value: TReturn } = { hasValue: false, value: undefined as any };

  return (...args: TArgs) => {
    if (!cached.hasValue) {
      cached.value = fn(...args);
      cached.hasValue = true;
    }
    return cached.value;
  };
}

/**
 * Retry - retry a function on failure
 *
 * @example
 * ```typescript
 * const setupWithRetry = retry(
 *   async () => {
 *     await fetch('https://api.example.com/init')
 *   },
 *   { maxAttempts: 3, delayMs: 1000 }
 * )
 *
 * await setupWithRetry()
 * ```
 */
export function retry<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): (...args: TArgs) => Promise<TReturn> {
  const { maxAttempts = 3, delayMs = 1000, onRetry } = options;

  return async (...args: TArgs) => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxAttempts) {
          onRetry?.(attempt, lastError);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError;
  };
}
