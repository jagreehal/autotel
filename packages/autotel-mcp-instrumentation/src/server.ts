import { context, SpanStatusCode } from '@opentelemetry/api';
import { trace, SpanKind, type TraceContext } from 'autotel';
import { extractOtelContextFromMeta } from './context';
import { type McpInstrumentationConfig, resolveConfig } from './types';
import { MCP_SEMCONV, MCP_METHODS } from './semantic-conventions';
import { recordServerOperationDuration } from './metrics';
import {
  applyManifestAssessment,
  applyToolAnnotations,
  assessManifest,
  enforceOutputBudget,
  extractManifestTextSurface,
  recordPayloadSize,
  runClassifier,
  safeStringify,
  type ManifestAssessment,
  type McpToolAnnotations,
} from './security';

type ResolvedConfig = ReturnType<typeof resolveConfig>;

/** Run the configured classifier over one payload, swallowing absence/errors. */
async function classify(
  ctx: TraceContext,
  config: ResolvedConfig,
  source: 'arguments' | 'result',
  type: 'tool' | 'resource' | 'prompt',
  name: string,
  value: unknown,
): Promise<void> {
  if (!config.securityClassifier) return;
  if (source === 'arguments' && !config.classifyArguments) return;
  if (source === 'result' && !config.classifyResults) return;
  if (value === undefined) return;
  await runClassifier(ctx, config.securityClassifier, {
    source,
    type,
    name,
    text: safeStringify(value),
    value,
  });
}

function getPayloadSizeAttribute(
  type: 'tool' | 'resource' | 'prompt',
  phase: 'arguments' | 'result',
): string {
  if (type === 'tool') {
    return phase === 'arguments'
      ? MCP_SEMCONV.TOOL_ARGUMENTS_SIZE
      : MCP_SEMCONV.TOOL_RESULT_SIZE;
  }
  return phase === 'arguments'
    ? MCP_SEMCONV.PAYLOAD_ARGUMENTS_SIZE
    : MCP_SEMCONV.PAYLOAD_RESULT_SIZE;
}

function getEntityAttributes(
  type: 'tool' | 'resource' | 'prompt',
  name: string,
  resourceUri?: string,
): Record<string, string> {
  switch (type) {
    case 'tool': {
      return { [MCP_SEMCONV.TOOL_NAME]: name };
    }
    case 'resource': {
      return { [MCP_SEMCONV.RESOURCE_URI]: resourceUri ?? name };
    }
    case 'prompt': {
      return { [MCP_SEMCONV.PROMPT_NAME]: name };
    }
  }
}

function getManifestAssessmentPromise(
  type: 'tool' | 'resource' | 'prompt',
  name: string,
  configObject: unknown,
  config: ResolvedConfig,
): Promise<ManifestAssessment | undefined> | undefined {
  if (!config.classifyDescriptions && !config.validateToolBudgets) {
    return undefined;
  }
  return assessManifest(
    config.classifyDescriptions ? config.securityClassifier : undefined,
    extractManifestTextSurface(type, name, configObject),
    { validateToolBudgets: config.validateToolBudgets },
  );
}

/** Map operation type to MCP method name */
function getMethodName(type: 'tool' | 'resource' | 'prompt'): string {
  switch (type) {
    case 'tool': {
      return MCP_METHODS.TOOLS_CALL;
    }
    case 'resource': {
      return MCP_METHODS.RESOURCES_READ;
    }
    case 'prompt': {
      return MCP_METHODS.PROMPTS_GET;
    }
  }
}

/** Build spec-compliant span name. Resources use method only (cardinality risk). */
function getSpanName(
  type: 'tool' | 'resource' | 'prompt',
  name: string,
): string {
  if (type === 'resource') {
    return getMethodName(type);
  }
  return `${getMethodName(type)} ${name}`;
}

/**
 * Wrap a handler function with spec-compliant OpenTelemetry tracing
 */
function wrapHandler<T extends (...args: any[]) => any>(
  type: 'tool' | 'resource' | 'prompt',
  name: string,
  handler: T,
  config: ResolvedConfig,
  resourceUri?: string,
  annotations?: McpToolAnnotations,
  manifestAssessmentPromise?: Promise<ManifestAssessment | undefined>,
): T {
  const methodName = getMethodName(type);
  const spanName = getSpanName(type, name);

  return (async (...args: any[]) => {
    // Extract _meta from arguments (typically last argument or in args object)
    const meta = args[args.length - 1]?._meta ?? args[0]?._meta;

    // Extract parent context from _meta field
    const parentContext = extractOtelContextFromMeta(meta);

    // Run handler in parent context
    return context.with(parentContext, async () => {
      return trace(
        { name: spanName, spanKind: SpanKind.SERVER },
        async (ctx: TraceContext) => {
          const startTime = performance.now();

          // Required: mcp.method.name
          ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);

          // Conditionally required: type-specific name attribute
          switch (type) {
            case 'tool': {
              ctx.setAttribute(MCP_SEMCONV.TOOL_NAME, name);
              ctx.setAttribute(MCP_SEMCONV.OPERATION_NAME, 'execute_tool');
              break;
            }
            case 'resource': {
              ctx.setAttribute(MCP_SEMCONV.RESOURCE_URI, resourceUri ?? name);
              break;
            }
            case 'prompt': {
              ctx.setAttribute(MCP_SEMCONV.PROMPT_NAME, name);
              break;
            }
          }

          // Recommended: network transport and session
          if (config.networkTransport) {
            ctx.setAttribute(
              MCP_SEMCONV.NETWORK_TRANSPORT,
              config.networkTransport,
            );
          }
          if (config.sessionId) {
            ctx.setAttribute(MCP_SEMCONV.SESSION_ID, config.sessionId);
          }

          if (manifestAssessmentPromise) {
            applyManifestAssessment(
              ctx,
              await manifestAssessmentPromise,
              getEntityAttributes(type, name, resourceUri),
            );
          }

          // Security: annotation hints (tool trust profile / malicious-manifest vector)
          if (type === 'tool' && config.captureToolAnnotations) {
            applyToolAnnotations(ctx, annotations);
          }

          // Security: argument size signal + classifier (inbound vector)
          if (args[0] !== undefined) {
            if (config.recordPayloadSize) {
              recordPayloadSize(
                ctx,
                getPayloadSizeAttribute(type, 'arguments'),
                args[0],
              );
            }
            await classify(ctx, config, 'arguments', type, name, args[0]);
          }

          // Opt-in: tool arguments
          if (
            type === 'tool' &&
            config.captureToolArgs &&
            args[0] !== undefined
          ) {
            try {
              ctx.setAttribute(
                MCP_SEMCONV.TOOL_CALL_ARGUMENTS,
                JSON.stringify(args[0]),
              );
            } catch {
              ctx.setAttribute(
                MCP_SEMCONV.TOOL_CALL_ARGUMENTS,
                '[Circular or non-serializable]',
              );
            }
          }

          // Custom attributes (pre-call)
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

            // Security: result size signal, output budget, classifier (contaminated-output vector)
            if (result !== undefined) {
              const resultSize = config.recordPayloadSize
                ? recordPayloadSize(
                    ctx,
                    getPayloadSizeAttribute(type, 'result'),
                    result,
                  )
                : safeStringify(result).length;
              if (config.outputCharBudget !== undefined) {
                enforceOutputBudget(ctx, resultSize, config.outputCharBudget, {
                  ...getEntityAttributes(type, name, resourceUri),
                });
              }
              await classify(ctx, config, 'result', type, name, result);
            }

            // Opt-in: tool results
            if (
              type === 'tool' &&
              config.captureToolResults &&
              result !== undefined
            ) {
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

            // Error handling: tool error via isError
            if (result?.isError) {
              ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, 'tool_error');
              ctx.setStatus({ code: SpanStatusCode.ERROR });
            } else {
              ctx.setStatus({ code: SpanStatusCode.OK });
            }

            // Custom attributes (post-call with result)
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

            // Record metric
            if (config.enableMetrics) {
              const durationS = (performance.now() - startTime) / 1000;
              const metricAttrs: Record<string, string> = {
                [MCP_SEMCONV.METHOD_NAME]: methodName,
              };
              switch (type) {
                case 'tool': {
                  metricAttrs[MCP_SEMCONV.TOOL_NAME] = name;
                  break;
                }
                case 'resource': {
                  metricAttrs[MCP_SEMCONV.RESOURCE_URI] = resourceUri ?? name;
                  break;
                }
                case 'prompt': {
                  metricAttrs[MCP_SEMCONV.PROMPT_NAME] = name;
                  break;
                }
              }
              if (result?.isError) {
                metricAttrs[MCP_SEMCONV.ERROR_TYPE] = 'tool_error';
              }
              recordServerOperationDuration(durationS, metricAttrs);
            }

            return result;
          } catch (error) {
            // Record exception if configured
            if (config.captureErrors) {
              if (
                'recordError' in ctx &&
                typeof ctx.recordError === 'function'
              ) {
                ctx.recordError(error);
              } else if (
                'recordException' in ctx &&
                typeof ctx.recordException === 'function'
              ) {
                ctx.recordException(error);
              }
              ctx.setAttribute(
                MCP_SEMCONV.ERROR_TYPE,
                (error as Error).name || 'Error',
              );
            }

            // Record metric on error
            if (config.enableMetrics) {
              const durationS = (performance.now() - startTime) / 1000;
              const metricAttrs: Record<string, string> = {
                [MCP_SEMCONV.METHOD_NAME]: methodName,
                [MCP_SEMCONV.ERROR_TYPE]: (error as Error).name || 'Error',
              };
              switch (type) {
                case 'tool': {
                  metricAttrs[MCP_SEMCONV.TOOL_NAME] = name;
                  break;
                }
                case 'resource': {
                  metricAttrs[MCP_SEMCONV.RESOURCE_URI] = resourceUri ?? name;
                  break;
                }
                case 'prompt': {
                  metricAttrs[MCP_SEMCONV.PROMPT_NAME] = name;
                  break;
                }
              }
              recordServerOperationDuration(durationS, metricAttrs);
            }

            throw error;
          }
        },
      );
    });
  }) as T;
}

/**
 * Instrument an MCP server with automatic OpenTelemetry tracing
 *
 * Creates spans following the OTel MCP semantic conventions:
 * - Span names: `tools/call get_weather`, `resources/read config://app`
 * - Span kind: SERVER
 * - Attributes: `mcp.method.name`, `gen_ai.tool.name`, `error.type`, etc.
 *
 * @param server - The MCP server instance to instrument
 * @param config - Instrumentation configuration options
 * @returns Instrumented server (proxy)
 *
 * @example
 * ```typescript
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { instrumentMcpServer } from 'autotel-mcp/server';
 * import { init } from 'autotel';
 *
 * init({ service: 'mcp-server', endpoint: 'http://localhost:4318' });
 *
 * const server = new McpServer({ name: 'weather', version: '1.0.0' });
 * const instrumented = instrumentMcpServer(server, {
 *   networkTransport: 'pipe',
 *   captureToolArgs: true,
 * });
 *
 * instrumented.registerTool('get_weather', { ... }, async (args) => {
 *   // Automatically traced with spec-compliant attributes
 * });
 * ```
 */
export function instrumentMcpServer<T extends Record<string, any>>(
  server: T,
  config?: McpInstrumentationConfig,
): T {
  const mergedConfig = resolveConfig(config);

  return new Proxy(server, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Wrap registerTool (McpServer API: name, config, handler)
      if (prop === 'registerTool' && typeof value === 'function') {
        return function wrappedRegisterTool(
          this: any,
          name: string,
          toolConfig: any,
          handler: any,
        ) {
          const manifestAssessmentPromise = getManifestAssessmentPromise(
            'tool',
            name,
            toolConfig,
            mergedConfig,
          );
          const wrappedHandler = wrapHandler(
            'tool',
            name,
            handler,
            mergedConfig,
            undefined,
            toolConfig?.annotations as McpToolAnnotations | undefined,
            manifestAssessmentPromise,
          );

          return Reflect.apply(value, target, [
            name,
            toolConfig,
            wrappedHandler,
          ]);
        };
      }

      // Wrap registerResource (McpServer API: name, uriOrTemplate, config, readCallback)
      if (prop === 'registerResource' && typeof value === 'function') {
        return function wrappedRegisterResource(
          this: any,
          name: string,
          uriOrTemplate: any,
          resourceConfig: any,
          readCallback: any,
        ) {
          const uri = typeof uriOrTemplate === 'string' ? uriOrTemplate : name;
          const manifestAssessmentPromise = getManifestAssessmentPromise(
            'resource',
            name,
            resourceConfig,
            mergedConfig,
          );
          const wrappedCallback = wrapHandler(
            'resource',
            name,
            readCallback,
            mergedConfig,
            uri,
            undefined,
            manifestAssessmentPromise,
          );

          return Reflect.apply(value, target, [
            name,
            uriOrTemplate,
            resourceConfig,
            wrappedCallback,
          ]);
        };
      }

      // Wrap registerPrompt (McpServer API: name, config, cb)
      if (prop === 'registerPrompt' && typeof value === 'function') {
        return function wrappedRegisterPrompt(
          this: any,
          name: string,
          promptConfig: any,
          cb: any,
        ) {
          const manifestAssessmentPromise = getManifestAssessmentPromise(
            'prompt',
            name,
            promptConfig,
            mergedConfig,
          );
          const wrappedCallback = wrapHandler(
            'prompt',
            name,
            cb,
            mergedConfig,
            undefined,
            undefined,
            manifestAssessmentPromise,
          );

          return Reflect.apply(value, target, [
            name,
            promptConfig,
            wrappedCallback,
          ]);
        };
      }

      return value;
    },
  });
}
