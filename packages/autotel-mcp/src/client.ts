import { SpanStatusCode } from '@opentelemetry/api';
import { trace, SpanKind, type TraceContext } from 'autotel';
import { injectOtelContextToMeta } from './context';
import { type McpInstrumentationConfig, resolveConfig } from './types';
import { MCP_SEMCONV, MCP_METHODS } from './semantic-conventions';
import { recordClientOperationDuration } from './metrics';

type ResolvedConfig = ReturnType<typeof resolveConfig>;

/**
 * Create a traced wrapper for a discovery operation (listTools, listResources, etc.)
 */
function wrapDiscoveryMethod(
  methodName: string,
  spanName: string,
  originalFn: Function,
  target: any,
  config: ResolvedConfig,
) {
  return async function wrappedDiscovery(
    this: any,
    params?: any,
    options?: any,
  ) {
    return await trace(
      { name: spanName, spanKind: SpanKind.CLIENT },
      async (ctx: TraceContext) => {
        const startTime = performance.now();

        ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);

        if (config.networkTransport) {
          ctx.setAttribute(
            MCP_SEMCONV.NETWORK_TRANSPORT,
            config.networkTransport,
          );
        }
        if (config.sessionId) {
          ctx.setAttribute(MCP_SEMCONV.SESSION_ID, config.sessionId);
        }

        try {
          const result = await Reflect.apply(originalFn, target, [
            params,
            options,
          ]);
          ctx.setStatus({ code: SpanStatusCode.OK });

          if (config.enableMetrics) {
            const durationS = (performance.now() - startTime) / 1000;
            recordClientOperationDuration(durationS, {
              [MCP_SEMCONV.METHOD_NAME]: methodName,
            });
          }

          return result;
        } catch (error) {
          if (config.captureErrors) {
            ctx.recordException(error as Error);
            ctx.setAttribute(
              MCP_SEMCONV.ERROR_TYPE,
              (error as Error).name || 'Error',
            );
            ctx.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error).message,
            });
          }

          if (config.enableMetrics) {
            const durationS = (performance.now() - startTime) / 1000;
            recordClientOperationDuration(durationS, {
              [MCP_SEMCONV.METHOD_NAME]: methodName,
              [MCP_SEMCONV.ERROR_TYPE]: (error as Error).name || 'Error',
            });
          }

          throw error;
        }
      },
    );
  };
}

/**
 * Instrument an MCP client with automatic OpenTelemetry tracing
 *
 * Creates spans following the OTel MCP semantic conventions:
 * - Span names: `tools/call get_weather`, `tools/list`, `resources/read weather://config`
 * - Span kind: CLIENT
 * - Attributes: `mcp.method.name`, `gen_ai.tool.name`, `error.type`, etc.
 * - Discovery operations: `listTools`, `listResources`, `listPrompts`, `ping`
 *
 * @param client - The MCP client instance to instrument
 * @param config - Instrumentation configuration options
 * @returns Instrumented client (proxy)
 *
 * @example
 * ```typescript
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 * import { instrumentMcpClient } from 'autotel-mcp/client';
 * import { init } from 'autotel';
 *
 * init({ service: 'mcp-client', endpoint: 'http://localhost:4318' });
 *
 * const client = new Client({ name: 'weather-client', version: '1.0.0' });
 * const instrumented = instrumentMcpClient(client, {
 *   networkTransport: 'pipe',
 *   captureToolArgs: true,
 * });
 *
 * // Discovery operations are automatically traced
 * const tools = await instrumented.listTools();
 *
 * // Tool calls create spec-compliant spans
 * const result = await instrumented.callTool({
 *   name: 'get_weather',
 *   arguments: { location: 'New York' },
 * });
 * ```
 */
export function instrumentMcpClient<T extends Record<string, any>>(
  client: T,
  config?: McpInstrumentationConfig,
): T {
  const mergedConfig = resolveConfig(config);

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
          const methodName = MCP_METHODS.TOOLS_CALL;

          return await trace(
            { name: `${methodName} ${name}`, spanKind: SpanKind.CLIENT },
            async (ctx: TraceContext) => {
              const startTime = performance.now();

              // Required
              ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);

              // Conditionally required
              ctx.setAttribute(MCP_SEMCONV.TOOL_NAME, name);

              // Recommended
              ctx.setAttribute(MCP_SEMCONV.OPERATION_NAME, 'execute_tool');
              if (mergedConfig.networkTransport) {
                ctx.setAttribute(
                  MCP_SEMCONV.NETWORK_TRANSPORT,
                  mergedConfig.networkTransport,
                );
              }
              if (mergedConfig.sessionId) {
                ctx.setAttribute(
                  MCP_SEMCONV.SESSION_ID,
                  mergedConfig.sessionId,
                );
              }

              // Opt-in: tool arguments
              if (mergedConfig.captureToolArgs && args !== undefined) {
                try {
                  ctx.setAttribute(
                    MCP_SEMCONV.TOOL_CALL_ARGUMENTS,
                    JSON.stringify(args),
                  );
                } catch {
                  ctx.setAttribute(
                    MCP_SEMCONV.TOOL_CALL_ARGUMENTS,
                    '[Circular or non-serializable]',
                  );
                }
              }

              // Custom attributes (pre-call)
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
                const paramsWithMeta = {
                  ...params,
                  _meta: { ...params._meta, ...meta },
                };

                const result = await Reflect.apply(value, target, [
                  paramsWithMeta,
                  resultSchema,
                  options,
                ]);

                // Opt-in: tool results
                if (mergedConfig.captureToolResults && result !== undefined) {
                  try {
                    ctx.setAttribute(
                      MCP_SEMCONV.TOOL_CALL_RESULT,
                      JSON.stringify(result),
                    );
                  } catch {
                    ctx.setAttribute(
                      MCP_SEMCONV.TOOL_CALL_RESULT,
                      '[Circular or non-serializable]',
                    );
                  }
                }

                // Custom attributes (post-call with result)
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

                if (mergedConfig.enableMetrics) {
                  const durationS = (performance.now() - startTime) / 1000;
                  recordClientOperationDuration(durationS, {
                    [MCP_SEMCONV.METHOD_NAME]: methodName,
                    [MCP_SEMCONV.TOOL_NAME]: name,
                  });
                }

                return result;
              } catch (error) {
                if (mergedConfig.captureErrors) {
                  ctx.recordException(error as Error);
                  ctx.setAttribute(
                    MCP_SEMCONV.ERROR_TYPE,
                    (error as Error).name || 'Error',
                  );
                  ctx.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (error as Error).message,
                  });
                }

                if (mergedConfig.enableMetrics) {
                  const durationS = (performance.now() - startTime) / 1000;
                  recordClientOperationDuration(durationS, {
                    [MCP_SEMCONV.METHOD_NAME]: methodName,
                    [MCP_SEMCONV.TOOL_NAME]: name,
                    [MCP_SEMCONV.ERROR_TYPE]: (error as Error).name || 'Error',
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
          const methodName = MCP_METHODS.RESOURCES_READ;

          return await trace(
            { name: methodName, spanKind: SpanKind.CLIENT },
            async (ctx: TraceContext) => {
              const startTime = performance.now();

              ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);
              ctx.setAttribute(MCP_SEMCONV.RESOURCE_URI, uri);

              if (mergedConfig.networkTransport) {
                ctx.setAttribute(
                  MCP_SEMCONV.NETWORK_TRANSPORT,
                  mergedConfig.networkTransport,
                );
              }
              if (mergedConfig.sessionId) {
                ctx.setAttribute(
                  MCP_SEMCONV.SESSION_ID,
                  mergedConfig.sessionId,
                );
              }

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

                const result = await Reflect.apply(value, target, [
                  paramsWithMeta,
                  options,
                ]);

                ctx.setStatus({ code: SpanStatusCode.OK });

                if (mergedConfig.enableMetrics) {
                  const durationS = (performance.now() - startTime) / 1000;
                  recordClientOperationDuration(durationS, {
                    [MCP_SEMCONV.METHOD_NAME]: methodName,
                    [MCP_SEMCONV.RESOURCE_URI]: uri,
                  });
                }

                return result;
              } catch (error) {
                if (mergedConfig.captureErrors) {
                  ctx.recordException(error as Error);
                  ctx.setAttribute(
                    MCP_SEMCONV.ERROR_TYPE,
                    (error as Error).name || 'Error',
                  );
                  ctx.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (error as Error).message,
                  });
                }

                if (mergedConfig.enableMetrics) {
                  const durationS = (performance.now() - startTime) / 1000;
                  recordClientOperationDuration(durationS, {
                    [MCP_SEMCONV.METHOD_NAME]: methodName,
                    [MCP_SEMCONV.RESOURCE_URI]: uri,
                    [MCP_SEMCONV.ERROR_TYPE]: (error as Error).name || 'Error',
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
          const methodName = MCP_METHODS.PROMPTS_GET;

          return await trace(
            { name: `${methodName} ${name}`, spanKind: SpanKind.CLIENT },
            async (ctx: TraceContext) => {
              const startTime = performance.now();

              ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);
              ctx.setAttribute(MCP_SEMCONV.PROMPT_NAME, name);

              if (mergedConfig.networkTransport) {
                ctx.setAttribute(
                  MCP_SEMCONV.NETWORK_TRANSPORT,
                  mergedConfig.networkTransport,
                );
              }
              if (mergedConfig.sessionId) {
                ctx.setAttribute(
                  MCP_SEMCONV.SESSION_ID,
                  mergedConfig.sessionId,
                );
              }

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
                const paramsWithMeta = {
                  ...params,
                  _meta: { ...params._meta, ...meta },
                };

                const result = await Reflect.apply(value, target, [
                  paramsWithMeta,
                  options,
                ]);

                ctx.setStatus({ code: SpanStatusCode.OK });

                if (mergedConfig.enableMetrics) {
                  const durationS = (performance.now() - startTime) / 1000;
                  recordClientOperationDuration(durationS, {
                    [MCP_SEMCONV.METHOD_NAME]: methodName,
                    [MCP_SEMCONV.PROMPT_NAME]: name,
                  });
                }

                return result;
              } catch (error) {
                if (mergedConfig.captureErrors) {
                  ctx.recordException(error as Error);
                  ctx.setAttribute(
                    MCP_SEMCONV.ERROR_TYPE,
                    (error as Error).name || 'Error',
                  );
                  ctx.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (error as Error).message,
                  });
                }

                if (mergedConfig.enableMetrics) {
                  const durationS = (performance.now() - startTime) / 1000;
                  recordClientOperationDuration(durationS, {
                    [MCP_SEMCONV.METHOD_NAME]: methodName,
                    [MCP_SEMCONV.PROMPT_NAME]: name,
                    [MCP_SEMCONV.ERROR_TYPE]: (error as Error).name || 'Error',
                  });
                }

                throw error;
              }
            },
          );
        };
      }

      // Discovery operations (when enabled)
      if (mergedConfig.captureDiscoveryOperations) {
        if (prop === 'listTools' && typeof value === 'function') {
          return wrapDiscoveryMethod(
            MCP_METHODS.TOOLS_LIST,
            MCP_METHODS.TOOLS_LIST,
            value,
            target,
            mergedConfig,
          );
        }

        if (prop === 'listResources' && typeof value === 'function') {
          return wrapDiscoveryMethod(
            MCP_METHODS.RESOURCES_LIST,
            MCP_METHODS.RESOURCES_LIST,
            value,
            target,
            mergedConfig,
          );
        }

        if (prop === 'listPrompts' && typeof value === 'function') {
          return wrapDiscoveryMethod(
            MCP_METHODS.PROMPTS_LIST,
            MCP_METHODS.PROMPTS_LIST,
            value,
            target,
            mergedConfig,
          );
        }

        if (prop === 'ping' && typeof value === 'function') {
          return wrapDiscoveryMethod(
            MCP_METHODS.PING,
            MCP_METHODS.PING,
            value,
            target,
            mergedConfig,
          );
        }
      }

      return value;
    },
  });
}
