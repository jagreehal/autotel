/**
 * Environment detection utilities
 * Prevents server-only code from running in the browser
 */

/**
 * Check if we're running in a browser environment
 * Uses typeof checks to avoid TypeScript DOM type requirements
 */
export function isBrowser(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    // @ts-expect-error - window may not exist in Node.js, that's the point
    typeof globalThis.window !== 'undefined' &&
    // @ts-expect-error - document may not exist in Node.js, that's the point
    typeof globalThis.document !== 'undefined'
  );
}

/**
 * Check if we're running in a Node.js environment
 */
export function isNode(): boolean {
  return (
    typeof process !== 'undefined' &&
    typeof process.versions !== 'undefined' &&
    typeof process.versions.node !== 'undefined'
  );
}

/**
 * Check if we're in a server-side context
 * In TanStack Start, middleware runs on the server, but router config
 * might be evaluated on both sides during SSR
 */
export function isServerSide(): boolean {
  // In TanStack Start, if we're in a request handler context, we're on the server
  // Check for Node.js environment (server) and not browser
  return isNode() && !isBrowser();
}

/**
 * Safely check if a module is available (for optional dependencies)
 */
export function isModuleAvailable(moduleName: string): boolean {
  try {
    // This will only work in Node.js, not browser
    if (typeof require !== 'undefined') {
      require.resolve(moduleName);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
