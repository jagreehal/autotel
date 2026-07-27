export type DownstreamReport = {
  service: string
  /** Raw `traceparent` the downstream received. */
  traceparent: string | null
  /** Trace id of the span the downstream joined. */
  traceId: string | null
}

/**
 * `pnpm dev` pins this port with --strictPort, so the constant matches the dev
 * server. Set DOWNSTREAM_API_URL for anything else: preview, production, a
 * second service, or a different port.
 */
const DEV_DOWNSTREAM_URL = 'http://localhost:3000/demo/api/downstream'

/**
 * Decide which URL the demo calls.
 *
 * This takes no argument by design. A request's origin comes from its `Host`
 * header, which an attacker controls. If that header picked the fetch target,
 * anyone could make this server dial an internal address, and the demo renders
 * the JSON it gets back, so they would read the response too. The target comes
 * from configuration or from the constant above.
 */
export function resolveDownstreamUrl(): string {
  const configured = process.env.DOWNSTREAM_API_URL
  if (configured) return configured

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Set DOWNSTREAM_API_URL to the downstream service URL. There is no default outside development.',
    )
  }

  return DEV_DOWNSTREAM_URL
}

/**
 * Calls the downstream API the way the demo does. This lives outside the route
 * file so a test can drive it against a real HTTP server without loading React.
 *
 * A plain `fetch()` covers it: the undici instrumentation registered in
 * `src/instrumentation.ts` injects `traceparent`. Do NOT also pass
 * `createTracedHeaders()` here. Both would inject, which sends two comma-joined
 * values. That is invalid W3C Trace Context, and the downstream fails to parse
 * it and starts its own trace. Use `createTracedHeaders()` for transports
 * undici does not instrument.
 */
export async function callDownstream(url: string): Promise<DownstreamReport> {
  return fetch(url).then((r) => r.json())
}
