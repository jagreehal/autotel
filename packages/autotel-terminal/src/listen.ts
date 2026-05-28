import { createServer, type Server } from 'node:http';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export interface LoopbackListeners {
  /** Resolves once the primary and (attempted) sibling listeners are up. */
  ready: Promise<{ addresses: string[]; warnings: string[] }>;
  /** Close the sibling listener (the primary server is owned by the caller). */
  closeSibling: () => Promise<void>;
}

/** Format host:port, bracketing IPv6 literals (e.g. `[::1]:4319`). */
export function formatAddress(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/**
 * Listen on `host:port`, and when `host` is a loopback literal, ALSO listen on
 * the sibling loopback family (IPv4 ⟷ IPv6) so a client reaches the collector
 * whether the OS resolves `localhost` to `127.0.0.1` or `::1`.
 *
 * Kills a silent footgun: a dev-server proxy targeting `http://localhost:PORT`
 * on macOS resolves `localhost` to `::1`, but a collector bound only to
 * `127.0.0.1` never receives the request — spans vanish with no error. If the
 * sibling family cannot bind, it is surfaced as a warning, never fatal.
 */
export function listenLoopbackDualStack(args: {
  primary: Server;
  port: number;
  host: string;
  attachSecondary: (server: Server) => void;
}): LoopbackListeners {
  const { primary, port, host, attachSecondary } = args;
  let sibling: Server | undefined;

  const ready = new Promise<{ addresses: string[]; warnings: string[] }>(
    (resolve) => {
      const addresses: string[] = [];
      const warnings: string[] = [];
      const primaryHost = host === 'localhost' ? '127.0.0.1' : host;

      primary.listen(port, primaryHost, () => {
        const addr = primary.address();
        const resolvedPort =
          addr && typeof addr === 'object' ? addr.port : port;
        addresses.push(formatAddress(primaryHost, resolvedPort));

        if (!LOOPBACK.has(host)) {
          resolve({ addresses, warnings });
          return;
        }

        const siblingHost = primaryHost === '::1' ? '127.0.0.1' : '::1';
        const s = createServer();
        attachSecondary(s);

        const onError = (e: Error) => {
          s.close();
          warnings.push(
            `could not also bind ${formatAddress(siblingHost, resolvedPort)} (${e.message}); ` +
              `clients using the ${siblingHost === '::1' ? 'IPv6' : 'IPv4'} form of "localhost" may not connect.`,
          );
          resolve({ addresses, warnings });
        };
        s.once('error', onError);
        s.listen(resolvedPort, siblingHost, () => {
          s.off('error', onError);
          sibling = s;
          addresses.push(formatAddress(siblingHost, resolvedPort));
          resolve({ addresses, warnings });
        });
      });
    },
  );

  return {
    ready,
    closeSibling: () =>
      new Promise<void>((res) => {
        if (!sibling) return res();
        sibling.close(() => res());
      }),
  };
}
