/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type -- Decodes the SDK's private request-handler map, whose request, context and result shapes vary by SDK version and method; every field is checked before tracing reads it. */
/**
 * Tracing for handlers set on the SDK's request-handler map, shared by the
 * low-level `Server` path and the MCP Events handlers.
 */
import { asString, isFunction, readProperty } from './values.js';

export type RequestHandler = (request: unknown, extra: unknown) => unknown;

/** What a low-level request is, for its span. */
interface LowLevelFacts {
  type: 'tool' | 'resource' | 'prompt';
  name: string;
  payload: unknown;
}

/** How a low-level request's params name its span. */
type LowLevelNamer = (
  params: Record<string, unknown> | undefined,
) => LowLevelFacts;

/** Low-level request methods traced, and how each names its span. */
export const LOW_LEVEL = new Map<string, LowLevelNamer>([
  [
    'tools/call',
    (p) => ({
      type: 'tool',
      name: asString(p?.name) ?? '',
      payload: p?.arguments,
    }),
  ],
  [
    'prompts/get',
    (p) => ({
      type: 'prompt',
      name: asString(p?.name) ?? '',
      payload: p?.arguments,
    }),
  ],
  [
    'resources/read',
    (p) => ({
      type: 'resource',
      name: asString(p?.uri) ?? '',
      payload: undefined,
    }),
  ],
]);

/** Which wrapper tables are already installed on which handler map's owner. */
const installedTables = new WeakMap<object, Set<WeakKey>>();

/**
 * Wrap the handlers for `methods` on the SDK's request-handler map, now and
 * whenever `setRequestHandler` sets one later (McpServer registers lazily,
 * and an Events server sets its `events/*` handlers whenever it likes). Only
 * a handler the SDK has just set is wrapped: by the time another method is
 * set, a later wrapper (task handles) may sit over ours, and wrapping it again
 * would trace one call twice. `table` keys the install, so two different
 * tables compose on one server and the same one installs once.
 */
export function patchRequestHandlers(
  server: unknown,
  table: WeakKey,
  methods: readonly string[],
  wrapMethod: (method: string, raw: RequestHandler) => RequestHandler,
): void {
  const handlers = readProperty(server, '_requestHandlers');
  const set = readProperty(server, 'setRequestHandler');
  if (!(handlers instanceof Map) || !isFunction(set)) return;
  // SAFETY: shape checked just above.
  const target = server as {
    setRequestHandler: (...args: unknown[]) => unknown;
  };
  const installed = installedTables.get(target) ?? new Set<WeakKey>();
  if (installed.has(table)) return;
  installed.add(table);
  installedTables.set(target, installed);
  // SAFETY: checked to be a Map above; the SDK keys it by method name and
  // stores the handler functions it calls.
  const map = handlers as Map<string, RequestHandler>;

  const wrap = (method: string) => {
    const raw = map.get(method);
    if (raw) map.set(method, wrapMethod(method, raw));
  };

  for (const method of methods) wrap(method);
  const original = target.setRequestHandler.bind(target);
  target.setRequestHandler = (...args: unknown[]) => {
    const before = new Map(map);
    const result = original(...args);
    for (const method of methods)
      if (map.get(method) !== before.get(method)) wrap(method);
    return result;
  };
}
