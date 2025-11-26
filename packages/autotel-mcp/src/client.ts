import { type Attributes, SpanStatusCode } from '@opentelemetry/api';
import { trace, type TraceContext } from 'autotel';
import { injectOtelContextToMeta } from './context.js';
import { type McpInstrumentationConfig, DEFAULT_CONFIG } from './types.js';

/**
 * Build span attributes for MCP client operations
 */
function buildClientSpanAttributes(
  operation: string,
  name: string,
  args?: unknown,
  config?: McpInstrumentationConfig,
): Attributes {
  const attrs: Attributes = {
    'mcp.client.operation': operation,
    'mcp.client.name': name,
  };

  // Add arguments if configured
  if (config?.captureArgs && args !== undefined) {
    try {
      attrs['mcp.client.args'] = JSON.stringify(args);
    } catch {
      attrs['mcp.client.args'] = '[Circular or non-serializable]';
    }
  }

  return attrs;
}

/**
 * Instrument an MCP client with automatic OpenTelemetry tracing
 *
 * This function wraps an MCP client to automatically create spans for all
 * outgoing requests and inject trace context into the `_meta` field.
 * This enables distributed tracing across MCP client-server boundaries.
 *
 * @param client - The MCP client instance to instrument
 * @param config - Instrumentation configuration options
 * @returns Instrumented client (proxy)
 *
 * @example
 * ```typescript
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 * import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
 * import { instrumentMcpClient } from 'autotel-mcp/client';
 * import { init } from 'autotel';
 *
 * init({ service: 'mcp-client', endpoint: 'http://localhost:4318' });
 *
 * const client = new Client({ name: 'weather-client', version: '1.0.0' });
 * const instrumented = instrumentMcpClient(client, {
 *   captureArgs: true,
 *   captureResults: false,
 * });
 *
 * // Tool calls automatically create spans and inject trace context
 * const result = await instrumented.callTool({
 *   name: 'get_weather',
 *   arguments: { location: 'New York' },
 *   // _meta field is automatically injected with traceparent/tracestate
 * });
 * ```
 */
export function instrumentMcpClient<T extends Record<string, any>>(
  client: T,
  config?: McpInstrumentationConfig,
): T {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Wrap callTool (Client API: callTool(params, resultSchema?, options?))
      if (prop === 'callTool' && typeof value === 'function') {
        return async function wrappedCallTool(
          this: any,
          params: { name: string; arguments?: any; _meta?: any },
          resultSchema?: any,
          options?: any,
        ) {
          const { name, arguments: args } = params;

          return await trace(
            `mcp.client.callTool.${name}`,
            async (ctx: TraceContext) => {
              // Build and set attributes
              const attrs = buildClientSpanAttributes(
                'callTool',
                name,
                args,
                mergedConfig,
              );
              ctx.setAttributes(
                attrs as Record<string, string | number | boolean>,
              );

              // Add custom attributes if provided
              if (mergedConfig.customAttributes) {
                const customAttrs = mergedConfig.customAttributes({
                  type: 'tool',
                  name,
                  args,
                });
                ctx.setAttributes(
                  customAttrs as Record<string, string | number | boolean>,
                );
              }

              try {
                // Inject trace context into _meta field
                const meta = injectOtelContextToMeta();
                // Spread original params to preserve all fields
                const paramsWithMeta = {
                  ...params,
                  _meta: { ...params._meta, ...meta },
                };

                // Preserve all parameters (params, resultSchema, options)
                const result = await Reflect.apply(value, target, [
                  paramsWithMeta,
                  resultSchema,
                  options,
                ]);

                // Capture result if configured
                if (mergedConfig.captureResults && result !== undefined) {
                  try {
                    ctx.setAttribute(
                      'mcp.client.result',
                      JSON.stringify(result),
                    );
                  } catch {
                    ctx.setAttribute(
                      'mcp.client.result',
                      '[Circular or non-serializable]',
                    );
                  }
                }

                // Add custom attributes with result
                if (mergedConfig.customAttributes) {
                  const customAttrs = mergedConfig.customAttributes({
                    type: 'tool',
                    name,
                    args,
                    result,
                  });
                  ctx.setAttributes(
                    customAttrs as Record<string, string | number | boolean>,
                  );
                }

                ctx.setStatus({ code: SpanStatusCode.OK });
                return result;
              } catch (error) {
                if (mergedConfig.captureErrors) {
                  ctx.recordException(error as Error);
                  ctx.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (error as Error).message,
                  });
                }
                throw error;
              }
            },
          );
        };
      }

      // Wrap readResource (Client API: readResource(params, options?))
      if (prop === 'readResource' && typeof value === 'function') {
        return async function wrappedReadResource(
          this: any,
          params: any,
          options?: any,
        ) {
          const uri = params.uri;

          return await trace(
            `mcp.client.readResource.${uri}`,
            async (ctx: TraceContext) => {
              const attrs = buildClientSpanAttributes(
                'readResource',
                uri,
                undefined,
                mergedConfig,
              );
              ctx.setAttributes(
                attrs as Record<string, string | number | boolean>,
              );

              if (mergedConfig.customAttributes) {
                const customAttrs = mergedConfig.customAttributes({
                  type: 'resource',
                  name: uri,
                });
                ctx.setAttributes(
                  customAttrs as Record<string, string | number | boolean>,
                );
              }

              try {
                // Inject trace context into params._meta
                const meta = injectOtelContextToMeta();
                const paramsWithMeta = {
                  ...params,
                  _meta: { ...params._meta, ...meta },
                };

                // Preserve options parameter
                const result = await Reflect.apply(value, target, [
                  paramsWithMeta,
                  options,
                ]);

                if (mergedConfig.captureResults && result !== undefined) {
                  try {
                    ctx.setAttribute(
                      'mcp.client.result',
                      JSON.stringify(result),
                    );
                  } catch {
                    ctx.setAttribute(
                      'mcp.client.result',
                      '[Circular or non-serializable]',
                    );
                  }
                }

                ctx.setStatus({ code: SpanStatusCode.OK });
                return result;
              } catch (error) {
                if (mergedConfig.captureErrors) {
                  ctx.recordException(error as Error);
                  ctx.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (error as Error).message,
                  });
                }
                throw error;
              }
            },
          );
        };
      }

      // Wrap getPrompt (Client API: getPrompt(params, options?))
      if (prop === 'getPrompt' && typeof value === 'function') {
        return async function wrappedGetPrompt(
          this: any,
          params: { name: string; arguments?: any; _meta?: any },
          options?: any,
        ) {
          const { name, arguments: args } = params;

          return await trace(
            `mcp.client.getPrompt.${name}`,
            async (ctx: TraceContext) => {
              const attrs = buildClientSpanAttributes(
                'getPrompt',
                name,
                args,
                mergedConfig,
              );
              ctx.setAttributes(
                attrs as Record<string, string | number | boolean>,
              );

              if (mergedConfig.customAttributes) {
                const customAttrs = mergedConfig.customAttributes({
                  type: 'prompt',
                  name,
                  args,
                });
                ctx.setAttributes(
                  customAttrs as Record<string, string | number | boolean>,
                );
              }

              try {
                // Inject trace context
                const meta = injectOtelContextToMeta();
                // Spread original params to preserve all fields
                const paramsWithMeta = {
                  ...params,
                  _meta: { ...params._meta, ...meta },
                };

                // Preserve options parameter
                const result = await Reflect.apply(value, target, [
                  paramsWithMeta,
                  options,
                ]);

                if (mergedConfig.captureResults && result !== undefined) {
                  try {
                    ctx.setAttribute(
                      'mcp.client.result',
                      JSON.stringify(result),
                    );
                  } catch {
                    ctx.setAttribute(
                      'mcp.client.result',
                      '[Circular or non-serializable]',
                    );
                  }
                }

                ctx.setStatus({ code: SpanStatusCode.OK });
                return result;
              } catch (error) {
                if (mergedConfig.captureErrors) {
                  ctx.recordException(error as Error);
                  ctx.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (error as Error).message,
                  });
                }
                throw error;
              }
            },
          );
        };
      }

      return value;
    },
  });
}
