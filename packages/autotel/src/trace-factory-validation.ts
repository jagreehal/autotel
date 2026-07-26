/**
 * Validate the two stages of Autotel's public factory wrappers without
 * coupling helper modules to the large functional tracing implementation.
 */
export function assertTraceFactory(
  helperName: string,
  value: unknown,
  stage: 'factory' | 'result' = 'factory',
): asserts value is (...args: never[]) => unknown {
  if (typeof value === 'function') return;

  throw new TypeError(
    stage === 'factory'
      ? `${helperName}: expected a factory (ctx) => (...args) => result`
      : `${helperName}: factory must return a function; expected (ctx) => (...args) => result`,
  );
}
