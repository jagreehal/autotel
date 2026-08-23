/**
 * Whether to say something when the join cannot do its job.
 *
 * Diagnostics behind an opt-in flag are read by people who already know
 * something is wrong, and the failure here is not knowing: every exit on this
 * path produces a missing property and nothing else, which looks exactly like
 * a working integration until someone queries for it weeks later.
 *
 * So it follows the convention React and Redux use — loud while you build,
 * silent once you ship — rather than off until asked.
 */
export function isDevelopment(): boolean {
  // Bundlers replace `process.env.NODE_ENV` at build time, so this is the
  // signal in anything built for the web. A bare browser has no `process`.
  try {
    const env =
      typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
    if (typeof env === 'string' && env.length > 0) return env !== 'production';
  } catch {
    // A `process` shim that throws on property access is not a verdict.
  }

  // No build-time answer: fall back to where the page is being served from.
  // A dev server on a non-local host stays quiet, which is the safe way round.
  try {
    // SAFETY: `location` exists on a page and not in Node, and the package
    // builds for both. Reading it structurally is what keeps the Node build
    // from needing DOM lib types.
    const host = (globalThis as { location?: { hostname?: string } }).location
      ?.hostname;
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
