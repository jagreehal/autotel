// src/server/listen.ts
import { createServer, type Server } from 'node:http'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

/** How many consecutive ports to try before giving up. The default sweeps
 *  4318..4337 — a tight enough window that we don't accidentally squat on
 *  something a sibling tool is using, but wide enough that the common case
 *  ("a previous devtools is still running") succeeds. */
const DEFAULT_MAX_PORT_TRIES = 20

export interface LoopbackListeners {
  /** Resolves once the primary and (attempted) sibling listeners are up.
   *  `port` is the port the primary actually bound to — it may differ from
   *  the requested port when fallback was needed. */
  ready: Promise<{ addresses: string[]; port: number; warnings: string[] }>
  /** Close the sibling listener (the primary server is owned by the caller). */
  closeSibling: () => Promise<void>
}

/** Format host:port, bracketing IPv6 literals (e.g. `[::1]:4318`). */
export function formatAddress(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

/**
 * Listen on `host:port`, and when `host` is a loopback literal, ALSO listen on
 * the sibling loopback family (IPv4 ⟷ IPv6) so a client reaches the collector
 * whether the OS resolves `localhost` to `127.0.0.1` or `::1`.
 *
 * This kills a notoriously silent footgun: a dev-server proxy targeting
 * `http://localhost:PORT` on macOS resolves `localhost` to `::1`, but a
 * collector bound only to `127.0.0.1` never receives the request — spans
 * vanish with no error. Binding both loopback families makes `localhost` work
 * regardless of resolution order.
 *
 * If `port` is busy (EADDRINUSE), the listener walks forward up to `maxTries`
 * consecutive ports and binds the first one that's free. The resolved port
 * is returned in `ready` so callers can print correct URLs and OTLP
 * endpoints. Each fallback produces a warning.
 *
 * The sibling listener serves the same HTTP routes (via `attachSecondary`);
 * the WebSocket/UI stays on the primary address. If the sibling cannot bind
 * (e.g. no IPv6, or the port is taken on that family), it is reported as a
 * warning rather than a fatal error.
 */
export function listenLoopbackDualStack(args: {
  primary: Server
  port: number
  host: string
  attachSecondary: (server: Server) => void
  maxTries?: number
}): LoopbackListeners {
  const { primary, port, host, attachSecondary, maxTries } = args
  const maxAttempts = Math.max(1, maxTries ?? DEFAULT_MAX_PORT_TRIES)
  let sibling: Server | undefined

  const ready = new Promise<{ addresses: string[]; port: number; warnings: string[] }>(
    (resolve, reject) => {
      const addresses: string[] = []
      const warnings: string[] = []
      // Normalise `localhost` to an explicit family so the primary bind is
      // deterministic and we know which sibling family to add.
      const primaryHost = host === 'localhost' ? '127.0.0.1' : host

      // The port currently being attempted, and how many we've burned so far.
      // One persistent handler pair owns the whole forward-walk; we just bump
      // `candidate` and re-`listen()` on the same server (the caller owns it
      // and has the WSS/routes attached, so we can't swap in a fresh one).
      let candidate = port
      let attempt = 0

      const bindFailed = (atPort: number, msg: string) =>
        reject(
          new Error(`could not bind ${formatAddress(primaryHost, atPort)}: ${msg}`),
        )

      // Walk forward from `port` until we find a free port. Anything that
      // isn't EADDRINUSE (EACCES, EAFNOSUPPORT, …) is fatal — it won't fix
      // itself on the next port.
      const onError = (e: NodeJS.ErrnoException) => {
        if (e.code !== 'EADDRINUSE') return bindFailed(candidate, e.message)
        if (++attempt >= maxAttempts) {
          reject(
            new Error(
              `could not bind ${formatAddress(primaryHost, port)}: ${maxAttempts} consecutive ports in use`,
            ),
          )
          return
        }
        candidate++
        listen()
      }

      const onListening = () => {
        // Bind succeeded — stop owning the primary's `error` event so a later
        // runtime error doesn't get mistaken for a bind failure.
        primary.removeListener('error', onError)
        if (candidate !== port) {
          warnings.push(`port ${port} was busy; using ${candidate} instead`)
        }
        const addr = primary.address()
        const resolvedPort =
          addr && typeof addr === 'object' ? addr.port : candidate
        addresses.push(formatAddress(primaryHost, resolvedPort))

        if (!LOOPBACK.has(host)) {
          resolve({ addresses, port: resolvedPort, warnings })
          return
        }

        const siblingHost = primaryHost === '::1' ? '127.0.0.1' : '::1'
        const s = createServer()
        attachSecondary(s)

        const onSiblingError = (se: Error) => {
          s.close()
          warnings.push(
            `could not also bind ${formatAddress(siblingHost, resolvedPort)} (${se.message}); ` +
              `clients using the ${siblingHost === '::1' ? 'IPv6' : 'IPv4'} form of "localhost" may not connect.`,
          )
          resolve({ addresses, port: resolvedPort, warnings })
        }
        s.once('error', onSiblingError)
        s.listen(resolvedPort, siblingHost, () => {
          s.off('error', onSiblingError)
          sibling = s
          addresses.push(formatAddress(siblingHost, resolvedPort))
          resolve({ addresses, port: resolvedPort, warnings })
        })
      }

      const listen = () => {
        try {
          primary.listen(candidate, primaryHost)
        } catch (e) {
          // `candidate` can overflow 65535 when the top port is busy; Node
          // throws a RangeError synchronously instead of emitting 'error'.
          primary.removeListener('error', onError)
          primary.removeListener('listening', onListening)
          bindFailed(candidate, (e as Error).message)
        }
      }

      primary.on('error', onError)
      primary.once('listening', onListening)
      listen()
    },
  )

  return {
    ready,
    closeSibling: () =>
      new Promise<void>((res) => {
        if (!sibling) return res()
        sibling.close(() => res())
      }),
  }
}
