import { context, type Attributes, SpanStatusCode } from '@opentelemetry/api';
import { trace, type TraceContext } from 'autotel';
import { extractOtelContextFromMeta } from './context';
import { type McpInstrumentationConfig, DEFAULT_CONFIG } from './types';

/**
 * Build span attributes for MCP operations
 */
function buildSpanAttributes(
  type: 'tool' | 'resource' | 'prompt',
  name: string,
  args?: unknown,
  result?: unknown,
  config?: McpInstrumentationConfig,
): Attributes {
  const attrs: Attributes = {
    'mcp.type': type,
    [`mcp.${type}.name`]: name,
  };

  // Add arguments if configured
  if (config?.captureArgs && args !== undefined) {
    try {
      attrs[`mcp.${type}.args`] = JSON.stringify(args);
    } catch {
      attrs[`mcp.${type}.args`] = '[Circular or non-serializable]';
    }
  }

  // Add results if configured
  if (config?.captureResults && result !== undefined) {
    try {
      attrs[`mcp.${type}.result`] = JSON.stringify(result);
    } catch {
      attrs[`mcp.${type}.result`] = '[Circular or non-serializable]';
    }
  }

  return attrs;
}

/**
 * Wrap a handler function with OpenTelemetry tracing
 */
function wrapHandler<T extends (...args: any[]) => any>(
  type: 'tool' | 'resource' | 'prompt',
  name: string,
  handler: T,
  config: Required<Omit<McpInstrumentationConfig, 'customAttributes'>> & {
    customAttributes?: McpInstrumentationConfig['customAttributes'];
  },
): T {
  return (async (...args: any[]) => {
    // Extract _meta from arguments (typically last argument or in args object)
    const meta = args[args.length - 1]?._meta ?? args[0]?._meta;

    // Extract parent context from _meta field
    const parentContext = extractOtelContextFromMeta(meta);

    // Run handler in parent context
    return context.with(parentContext, async () => {
      return trace(`mcp.server.${type}.${name}`, async (ctx: TraceContext) => {
        // Build and set attributes
        const attrs = buildSpanAttributes(
          type,
          name,
          args[0],
          undefined,
          config,
        );
        ctx.setAttributes(attrs as Record<string, string | number | boolean>);

        // Add custom attributes if provided
        if (config.customAttributes) {
          const customAttrs = config.customAttributes({
            type,
            name,
            args: args[0],
          });
          ctx.setAttributes(
            customAttrs as Record<string, string | number | boolean>,
          );
        }

        try {
          const result = await handler(...args);

          // Capture result if configured
          if (config.captureResults && result !== undefined) {
            try {
              ctx.setAttribute(`mcp.${type}.result`, JSON.stringify(result));
            } catch {
              ctx.setAttribute(
                `mcp.${type}.result`,
                '[Circular or non-serializable]',
              );
            }
          }

          // Add custom attributes with result
          if (config.customAttributes) {
            const customAttrs = config.customAttributes({
              type,
              name,
              args: args[0],
              result,
            });
            ctx.setAttributes(
              customAttrs as Record<string, string | number | boolean>,
            );
          }

          ctx.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          // Record exception if configured
          if (config.captureErrors) {
            ctx.recordException(error as Error);
            ctx.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error).message,
            });
          }
          throw error;
        }
      });
    });
  }) as T;
}

/**
 * Instrument an MCP server with automatic OpenTelemetry tracing
 *
 * This function wraps an MCP server to automatically create spans for all
 * registered tools, resources, and prompts. It extracts parent trace context
 * from the `_meta` field in requests, enabling distributed tracing across
 * MCP client-server boundaries.
 *
 * @param server - The MCP server instance to instrument
 * @param config - Instrumentation configuration options
 * @returns Instrumented server (proxy)
 *
 * @example
 * ```typescript
 * import { McpServer } from '@modelcontextprotocol/sdk/server/index';
 * import { instrumentMcpServer } from 'autotel-mcp/server';
 * import { init } from 'autotel';
 *
 * init({ service: 'mcp-server', endpoint: 'http://localhost:4318' });
 *
 * const server = new McpServer({ name: 'weather', version: '1.0.0' });
 * const instrumented = instrumentMcpServer(server, {
 *   captureArgs: true,
 *   captureResults: false, // PII concerns
 * });
 *
 * // Tools registered on instrumented server are automatically traced
 * instrumented.registerTool({
 *   name: 'get_weather',
 *   description: 'Get current weather',
 *   inputSchema: { type: 'object', properties: { location: { type: 'string' } } },
 *   handler: async (args) => {
 *     // This handler is automatically traced with parent context from _meta
 *     const weather = await fetchWeather(args.location);
 *     return { content: [{ type: 'text', text: `Temp: ${weather.temp}` }] };
 *   },
 * });
 * ```
 */
export function instrumentMcpServer<T extends Record<string, any>>(
  server: T,
  config?: McpInstrumentationConfig,
): T {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  return new Proxy(server, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Wrap registerTool (McpServer API: name, config, handler)
      if (prop === 'registerTool' && typeof value === 'function') {
        return function wrappedRegisterTool(
          this: any,
          name: string,
          config: any,
          handler: any,
        ) {
          const wrappedHandler = wrapHandler(
            'tool',
            name,
            handler,
            mergedConfig,
          );

          return Reflect.apply(value, target, [name, config, wrappedHandler]);
        };
      }

      // Wrap registerResource (McpServer API: name, uriOrTemplate, config, readCallback)
      if (prop === 'registerResource' && typeof value === 'function') {
        return function wrappedRegisterResource(
          this: any,
          name: string,
          uriOrTemplate: any,
          config: any,
          readCallback: any,
        ) {
          const wrappedCallback = wrapHandler(
            'resource',
            name,
            readCallback,
            mergedConfig,
          );

          return Reflect.apply(value, target, [
            name,
            uriOrTemplate,
            config,
            wrappedCallback,
          ]);
        };
      }

      // Wrap registerPrompt (McpServer API: name, config, cb)
      if (prop === 'registerPrompt' && typeof value === 'function') {
        return function wrappedRegisterPrompt(
          this: any,
          name: string,
          config: any,
          cb: any,
        ) {
          const wrappedCallback = wrapHandler('prompt', name, cb, mergedConfig);

          return Reflect.apply(value, target, [name, config, wrappedCallback]);
        };
      }

      return value;
    },
  });
}
