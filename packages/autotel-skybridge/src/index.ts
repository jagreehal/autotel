/**
 * autotel-skybridge - OpenTelemetry for Skybridge MCP Apps
 *
 * One Skybridge middleware that traces `tools/call`, `resources/read` and
 * `prompts/get` with the spans, attributes and metrics of
 * `autotel-mcp-instrumentation`, parented to the caller's `_meta` trace context.
 *
 * @packageDocumentation
 */

import { ctx } from 'autotel';
import {
  traceMcpHandler,
  type McpInstrumentationConfig,
} from 'autotel-mcp-instrumentation';
import type { McpMiddlewareFn } from 'skybridge/server';

export type { McpInstrumentationConfig } from 'autotel-mcp-instrumentation';

/**
 * Where Skybridge stores the error a tool handler threw (`getToolError` reads
 * it). Mirrored rather than imported so this package has no runtime Skybridge
 * import; the thrown-error test fails if Skybridge moves it.
 */
const TOOL_ERROR: unique symbol = Symbol.for('skybridge.toolError');

const TRACED_METHODS = new Map<string, 'tool' | 'resource' | 'prompt'>([
  ['tools/call', 'tool'],
  ['resources/read', 'resource'],
  ['prompts/get', 'prompt'],
]);

/**
 * Skybridge middleware that traces every tool call, resource read and prompt.
 *
 * ```ts
 * import { skybridgeTracing } from 'autotel-skybridge';
 *
 * new Skybridge({
 *   name: 'my-app',
 *   version: '1.0.0',
 *   handler: (server) =>
 *     server.registerTool(...).mcpMiddleware(skybridgeTracing()),
 * });
 * ```
 */
export function skybridgeTracing(
  config?: McpInstrumentationConfig,
): McpMiddlewareFn {
  return (request, extra, next) => {
    const type = TRACED_METHODS.get(request.method);
    // Notifications have no `extra` and nothing to trace.
    if (!type || !extra) return next();

    const rawName =
      type === 'resource' ? request.params.uri : request.params.name;
    // Traced only when the request names a tool, prompt or resource.
    if (typeof rawName !== 'string') return next();
    // View URIs carry a `?v=` cache key that changes on every build.
    const name = type === 'resource' ? rawName.split('?')[0]! : rawName;

    // Called as (payload, ctx) below; the handler itself ignores both.
    const traced = traceMcpHandler<[unknown, typeof extra], Promise<unknown>>(
      async () => {
        const result = await next();
        // Skybridge keeps the error a tool threw behind its `isError` result.
        const error = TOOL_ERROR in extra ? extra[TOOL_ERROR] : undefined;
        if (error !== undefined && config?.captureErrors !== false) {
          // Structured errors keep why/fix/link/code/details as error.*.
          ctx.recordError(error);
        }
        return result;
      },
      {
        type,
        name,
        resourceUri: type === 'resource' ? name : undefined,
        config,
      },
    );

    // The (payload, ctx) shape an SDK handler receives.
    return traced(
      type === 'resource' ? rawName : request.params.arguments,
      extra,
    );
  };
}
