/**
 * Client identity on stateless 2025-era Streamable HTTP. The client names
 * itself once, on `initialize`; a stateless server answers every later
 * request on a fresh server and transport that never saw it. The answer to
 * `initialize` carries an opaque `Mcp-Session-Id` holding the reported name
 * and version, which the client sends back on every later request and a
 * stateless transport does not validate. A transport that issues its own
 * session id is left alone. Client-reported, never a credential.
 */
import { isFunction, member } from './values.js';

const PREFIX = 'mcpci1.';
const MAX = 128;
const patched = new WeakSet<object>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const base64url = (text: string) =>
  btoa(String.fromCodePoint(...new TextEncoder().encode(text)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const unbase64url = (text: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
      c.codePointAt(0)!,
    ),
  );

/** The id that carries a client's reported name and version, or none. */
export function encodeClientIdentity(info: unknown): string | undefined {
  if (!isRecord(info) || typeof info.name !== 'string' || !info.name)
    return undefined;
  const version =
    typeof info.version === 'string' ? info.version.slice(0, MAX) : '';
  return `${PREFIX}${base64url(JSON.stringify([info.name.slice(0, MAX), version]))}`;
}

/** The client a header names, when it is one this module issued. */
export function decodeClientIdentity(
  header: unknown,
): { name: string; version?: string } | undefined {
  if (typeof header !== 'string' || !header.startsWith(PREFIX))
    return undefined;
  try {
    const value: unknown = JSON.parse(unbase64url(header.slice(PREFIX.length)));
    if (!Array.isArray(value) || typeof value[0] !== 'string' || !value[0])
      return undefined;
    return typeof value[1] === 'string' && value[1]
      ? { name: value[0].slice(0, MAX), version: value[1].slice(0, MAX) }
      : { name: value[0].slice(0, MAX) };
  } catch {
    return undefined;
  }
}

/** The `clientInfo` an `initialize` message carries, or none. */
const clientInfoOf = (message: unknown): unknown =>
  isRecord(message) &&
  message.method === 'initialize' &&
  isRecord(message.params)
    ? message.params.clientInfo
    : undefined;

/**
 * Patch a stateless Streamable HTTP transport (either SDK's web-standard
 * transport, or the Node transport wrapping one) so its `initialize` answer
 * carries the client's identity. Anything else is left as it is. The
 * identity is read off the message the SDK hands its server, after its own
 * size limit and validation, never from the body before them.
 */
export function carryClientIdentity(transport: unknown): void {
  if (!isRecord(transport)) return;
  const web = member(transport, '_webStandardTransport') ?? transport;
  if (!isRecord(web) || patched.has(web)) return;
  // Stateless only: a transport that issues sessions validates the header.
  if (!('sessionIdGenerator' in web) || web.sessionIdGenerator !== undefined)
    return;
  const handle = web.handleRequest;
  if (!isFunction(handle)) return;
  const original = handle as (...args: unknown[]) => unknown;
  patched.add(web);

  // A stateless transport serves one request, so one slot is enough.
  let info: unknown;
  let onmessage: unknown = web.onmessage;
  Object.defineProperty(web, 'onmessage', {
    configurable: true,
    enumerable: true,
    get: () => onmessage,
    set(handler: unknown) {
      onmessage = isFunction(handler)
        ? function (this: unknown, message: unknown, ...rest: unknown[]) {
            info = clientInfoOf(message) ?? info;
            return (handler as (...a: unknown[]) => unknown).call(
              this,
              message,
              ...rest,
            );
          }
        : handler;
    },
  });
  // Re-set what was there through the wrapper. A transport property, not a DOM event.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  web.onmessage = onmessage;

  web.handleRequest = async function handleRequest(
    this: unknown,
    ...args: unknown[]
  ) {
    const response: unknown = await original.apply(this, args);
    const id = info === undefined ? undefined : encodeClientIdentity(info);
    if (
      !id ||
      !(response instanceof Response) ||
      response.headers.has('mcp-session-id')
    )
      return response;
    const headers = new Headers(response.headers);
    headers.set('mcp-session-id', id);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
