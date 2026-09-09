/**
 * Where a request header of ours may go.
 *
 * Same-origin always; cross-origin only where the app has said so. This is a
 * compatibility rule before it is a privacy one: an unexpected request header
 * turns a simple request into a preflighted one, and any server that does not
 * list `traceparent` in `Access-Control-Allow-Headers` rejects it outright. A
 * tracer that propagates everywhere by default breaks the app it is meant to
 * observe, which is why OpenTelemetry's own web instrumentation makes
 * cross-origin propagation opt-in (`propagateTraceHeaderCorsUrls`).
 *
 * Not propagating is not the same as not tracing: the browser span is still
 * recorded for a destination that gets no header, so the call keeps its timing,
 * status and errors. Only the join with the server side is lost.
 */
export function isPropagationAllowed(
  url: string,
  currentOrigin: string,
  allowedOrigins: readonly string[] = [],
): boolean {
  let targetOrigin: string;
  try {
    targetOrigin =
      url.startsWith('http://') || url.startsWith('https://')
        ? new URL(url).origin
        : new URL(url, currentOrigin || 'http://localhost').origin;
  } catch {
    // Unparseable URL — fail closed.
    return false;
  }

  // Same-origin is always allowed.
  if (currentOrigin && targetOrigin === currentOrigin) return true;

  // Cross-origin only via explicit allowlist (substring match for parity with
  // PrivacyManager.allowedOrigins).
  const target = targetOrigin.toLowerCase();
  return allowedOrigins.some((origin) => target.includes(origin.toLowerCase()));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One entry of {@link isPropagationAllowed}'s allowlist, as a matcher for
 * OpenTelemetry's `propagateTraceHeaderCorsUrls`.
 *
 * That option is compared against the **whole URL**, and both of its forms are
 * wrong here in opposite directions: a string has to equal the URL outright, so
 * `'api.myapp.com'` matches nothing at all; and a bare substring regex matches
 * anywhere in it, so the same value would also propagate to
 * `https://third-party.test/api.myapp.com` - the unwanted preflight this
 * default exists to prevent. Anchoring the needle to the authority (everything
 * between `://` and the first `/`, `?` or `#`) makes full mode allow exactly
 * the destinations lean mode does.
 */
export function propagationUrlPattern(allowedOrigin: string): RegExp {
  // An origin has no path, so a value carrying one can never be a substring of
  // one - and must not be allowed to match inside a URL's path instead. `(?!)`
  // is the regex that matches nothing. The scheme is stripped for this check
  // only, since `location.origin` has one and people write it.
  const withoutScheme = allowedOrigin.replace(/^[a-zA-Z][\w+.-]*:\/\//, '');
  if (/[/?#]/.test(withoutScheme)) return /(?!)/;

  // Pinned to the origin prefix of the URL - an optional scheme, then
  // optionally `//` and authority characters - so the needle cannot match
  // across into the path. The configured value is used exactly as written:
  // dropping its scheme would let `https://api.myapp.com` also allow
  // `http://api.myapp.com`, and its leading `//` would let it allow
  // `https://other.api.myapp.com`. Lean mode refuses both, because it compares
  // against `new URL(url).origin`, which carries the scheme.
  return new RegExp(
    `^(?:[a-zA-Z][\\w+.-]*:)?(?://[^/?#]*)?${escapeRegex(allowedOrigin)}`,
    'i',
  );
}
