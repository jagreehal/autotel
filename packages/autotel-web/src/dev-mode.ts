/**
 * Whether the page is being developed rather than served to users.
 *
 * Bundlers replace `process.env.NODE_ENV` at build time, so that is the
 * signal in anything built for the web; a bare browser has no `process`, and
 * then where the page is served from decides. A dev server on a non-local host
 * reads as production, which is the safe way round for anything this gates.
 */
export function isDevelopment(): boolean {
  try {
    // Spelled out in full so bundlers substitute it. A bare browser throws
    // ReferenceError here, which the catch turns into "no verdict".
    const env = process.env.NODE_ENV;
    if (typeof env === 'string' && env.length > 0) return env !== 'production';
  } catch {
    // Fall through to the hostname.
  }

  try {
    const host = globalThis.location?.hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host?.endsWith('.local') === true
    );
  } catch {
    return false;
  }
}
