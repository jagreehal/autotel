// Guard the receiver's *read* surface (captured-telemetry read-back + the live
// WebSocket) against being scraped by a web page the developer happens to be
// visiting. The OTLP *ingest* endpoints stay wide open — browser apps on
// arbitrary dev origins must be able to POST spans and load `widget.js`.
//
// Two browser-reachable attacks, two checks:
//   - Cross-origin read: a page at evil.com runs
//     `fetch('http://127.0.0.1:4318/v1/traces')` or opens `ws://…/ws`. The
//     browser attaches `Origin: https://evil.com` → reject non-loopback origins.
//   - DNS rebinding: attacker.com is made to resolve to 127.0.0.1, so the read
//     looks same-origin and may carry no `Origin` at all — but the `Host`
//     header is still `attacker.com` → reject non-loopback hosts. Only enforced
//     when the receiver is bound to loopback (the default); an explicit
//     non-loopback bind (`--host 0.0.0.0`) is an opt-in to network exposure, so
//     the Host check is skipped there and only the Origin check remains.
//
// Requests with no Origin and a loopback Host (curl, Node `fetch` in tests, the
// UI's own same-origin calls) pass — exactly the legitimate read paths.

const LOOPBACK_IPV6 = new Set(['::1', '0:0:0:0:0:0:0:1'])

/** True for `localhost`, any `127.x.x.x`, and IPv6 loopback. Case-insensitive. */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || /^127\./.test(h) || LOOPBACK_IPV6.has(h)
}

/** Hostname from a `Host` header (`host`, `host:port`, `[::1]:port`). */
function hostnameFromHostHeader(host: string): string {
  const h = host.trim()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end > 0 ? h.slice(1, end) : h
  }
  const colon = h.indexOf(':')
  return colon === -1 ? h : h.slice(0, colon)
}

/** True when the `Host` header names a loopback host. */
export function hostHeaderIsLoopback(host: string): boolean {
  return isLoopbackHostname(hostnameFromHostHeader(host))
}

/** True when an `Origin` header names a loopback origin. A malformed or opaque
 *  origin (e.g. the literal `null` from a sandboxed iframe) is treated as
 *  non-loopback. */
export function originIsLoopback(origin: string): boolean {
  try {
    return isLoopbackHostname(new URL(origin).hostname)
  } catch {
    return false
  }
}

export interface GuardHeaders {
  origin?: string
  host?: string
}

/**
 * Decide whether a request to a sensitive (read/mutate) endpoint is allowed.
 * - A present, non-loopback `Origin` is always rejected (cross-origin read).
 * - When `loopbackOnly`, a present, non-loopback `Host` is rejected (DNS
 *   rebinding). Skipped when the receiver is bound to a non-loopback host.
 */
export function allowSensitiveRequest(
  headers: GuardHeaders,
  loopbackOnly: boolean,
): boolean {
  const { origin, host } = headers
  if (origin && origin.length > 0 && !originIsLoopback(origin)) return false
  if (loopbackOnly && host && host.length > 0 && !hostHeaderIsLoopback(host)) {
    return false
  }
  return true
}
