// src/server/identity.ts
//
// A first-class way to answer "is the thing on this port actually
// autotel-devtools?". Clients and integrators used to have to sniff the shape
// of GET /healthz (e.g. "does the JSON have `ok` and `clients`?"). That is
// brittle. We now stamp every HTTP response with an `x-autotel-devtools`
// header and put `service: "autotel-devtools"` in the /healthz body, so the
// answer is unambiguous — and we use that here to tell our own instances apart
// from a foreign OTLP collector squatting on the same port.

/** Value of the `x-autotel-devtools` response header and the /healthz `service` field. */
export const DEVTOOLS_IDENTITY = 'autotel-devtools'

/** Who is holding a TCP port, as far as we can tell over HTTP:
 *  - `autotel-devtools` — another instance of us (benign; the user has two running)
 *  - `foreign`          — an HTTP server that is NOT us (e.g. an IDE's OTLP collector)
 *  - `none`             — nothing answered HTTP (refused, timed out, or non-HTTP listener) */
export type PortHolder = 'autotel-devtools' | 'foreign' | 'none'

/**
 * Probe `host:port` over HTTP and classify what is listening. Used when our
 * requested port is busy: it lets us tell "a stale autotel-devtools is still
 * up" (benign) apart from "a foreign collector owns this port" — the latter is
 * the silent footgun where apps keep exporting OTLP to the busy port and reach
 * the wrong process, so the devtools UI stays empty and the app sees errors.
 */
export async function probePortHolder(
  host: string,
  port: number,
  timeoutMs = 500,
): Promise<PortHolder> {
  // Bracket IPv6 literals for the URL authority (e.g. [::1]:4318).
  const authority = host.includes(':') ? `[${host}]` : host
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`http://${authority}:${port}/healthz`, {
      signal: controller.signal,
    })
    // The header is the fast, body-independent signal (present on every route).
    if (res.headers.get('x-autotel-devtools')) return 'autotel-devtools'
    // Fall back to the body in case a proxy stripped the header.
    try {
      const body = (await res.json()) as { service?: unknown }
      if (body && body.service === DEVTOOLS_IDENTITY) return 'autotel-devtools'
    } catch {
      // Not JSON — that's fine, it just isn't us.
    }
    return 'foreign'
  } catch {
    // Connection refused / timeout / non-HTTP listener. When the caller only
    // probes after a confirmed EADDRINUSE, `none` means "occupied by something
    // that doesn't speak HTTP" — still not us.
    return 'none'
  } finally {
    clearTimeout(timer)
  }
}
