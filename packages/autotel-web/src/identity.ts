/**
 * The signed-in user, stamped on every span, log and event recorded after
 * `identify()` and dropped from everything recorded after `clearIdentity()`.
 *
 * Without it every app writes an enricher that reads the user out of its own
 * stores, which does nothing before login and keeps going after logout. Each
 * record carries `session.id` beside `user.id`, so a session's earlier,
 * anonymous records are attributed by joining on `session.id`.
 *
 * Browser-only telemetry: nothing here is sent to the app's API. Use
 * `setBaggage` for that, which honours the baggage allowlist.
 *
 * No OpenTelemetry dependency, so lean mode can use it.
 */

import { USER } from './semconv';

export type IdentityAttributes = Record<string, string | number | boolean>;

let identity: IdentityAttributes | undefined;

/**
 * Tag every later span, log and event with `user.id` and `attributes`.
 * Calling it again replaces the previous identity. An empty id clears it.
 *
 * @example
 * ```typescript
 * identify(user.id, { 'client.id': client.id });
 * // on logout:
 * clearIdentity();
 * ```
 */
export function identify(
  userId: string,
  attributes: IdentityAttributes = {},
): void {
  if (typeof userId !== 'string' || userId.length === 0) {
    identity = undefined;
    return;
  }
  identity = { ...attributes, [USER.ID]: userId };
}

/** Stop tagging records with the identity set by {@link identify}. */
export function clearIdentity(): void {
  identity = undefined;
}

/** The current identity attributes, or `undefined` when nobody is signed in. */
export function getIdentityAttributes(): IdentityAttributes | undefined {
  return identity;
}
