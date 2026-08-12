import { SpanStatusCode } from '@opentelemetry/api';
import { withTracing, SpanKind, type TraceContext } from 'autotel';
import { injectOtelContextToMeta } from './context';
import {
  applyFailureGrouping,
  classifyFailure,
  extractFailureText,
  failureTextFromError,
  type McpFailureCategory,
} from './failure';
import {
  type McpInstrumentationConfig,
  resolveConfig,
  resolveSecurityEventBridge,
} from './types';
import { MCP_SEMCONV, MCP_METHODS } from './semantic-conventions';
import { recordClientOperationDuration } from './metrics';
import {
  enforceOutputBudget,
  recordGuardStep,
  recordPayloadSize,
  runClassifier,
  safeStringify,
} from './security';

type ResolvedConfig = ReturnType<typeof resolveConfig>;

/**
 * Failure text and category for a thrown error, for the catch block of every
 * traced client method.
 *
 * A transport failure or timeout rejects rather than returning `isError`, so
 * grouping only the returned-result path would leave the most common infra
 * failure ungrouped. The category is computed here rather than inside
 * {@link applyFailureGrouping} because the span attributes are gated on
 * `captureErrors` while the duration metric is not.
 */
function thrownFailure(error: unknown): {
  text: string;
  category: McpFailureCategory | undefined;
} {
  const text = failureTextFromError(error);
  return { text, category: text ? classifyFailure(text) : undefined };
}

function securityBridge(
  config: ResolvedConfig,
  toolName?: string,
):
  | {
      bridge: NonNullable<ReturnType<typeof resolveSecurityEventBridge>>;
      toolName?: string;
    }
  | undefined {
  const bridge = resolveSecurityEventBridge(config);
  if (!bridge) return undefined;
  return { bridge, toolName };
}

/** Run the configured classifier over one payload, swallowing absence/errors. */
async function classifyClient(
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
  await runClassifier(
    ctx,
    config.securityClassifier,
    {
      source,
      type,
      name,
      text: safeStringify(value),
      value,
    },
    securityBridge(config, name),
  );
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
): Record<string, string> {
  switch (type) {
    case 'tool': {
      return { [MCP_SEMCONV.TOOL_NAME]: name };
    }
    case 'resource': {
      return { [MCP_SEMCONV.RESOURCE_URI]: name };
    }
    case 'prompt': {
      return { [MCP_SEMCONV.PROMPT_NAME]: name };
    }
  }
}

/**
 * Attributes that describe the connection rather than the call.
 *
 * `mcp.session.id` is 2025-era only: v1's Streamable HTTP transport exposes
 * the session the server issued at `initialize`. 2026-07-28 removed sessions
 * (SEP-2567), so the getter is simply absent there and the attribute is
 * omitted. Read off the live transport in preference to `config.sessionId`, so
 * it cannot go stale across a reconnect; config answers only for legacy stdio,
 * whose transport has no session at all.
 */
function applyConnectionAttributes(
  ctx: TraceContext,
  config: ResolvedConfig,
  target: any,
): void {
  if (config.networkTransport) {
    ctx.setAttribute(MCP_SEMCONV.NETWORK_TRANSPORT, config.networkTransport);
  }
  const protocolEra =
    typeof target?.getProtocolEra === 'function'
      ? target.getProtocolEra()
      : undefined;
  const protocolVersion =
    typeof target?.getNegotiatedProtocolVersion === 'function'
      ? target.getNegotiatedProtocolVersion()
      : undefined;
  if (protocolEra === 'modern' && typeof protocolVersion === 'string') {
    ctx.setAttribute(MCP_SEMCONV.PROTOCOL_VERSION, protocolVersion);
  }

  // Transport first, config only as a legacy fallback. Modern transports are
  // intentionally sessionless, including stdio, so neither a stale transport
  // value nor a configured v1 fallback may leak onto their spans.
  const sessionId =
    protocolEra === 'modern'
      ? undefined
      : (target?.transport?.sessionId ?? config.sessionId);
  if (typeof sessionId === 'string') {
    ctx.setAttribute(MCP_SEMCONV.SESSION_ID, sessionId);
  }
}

/**
 * Client methods traced as discovery operations, keyed by method name.
 *
 * `discover` (`server/discover`) is 2026-07-28's replacement for the
 * `initialize` handshake: optional and cacheable, so it is worth seeing how
 * often a client actually pays for it. It is simply absent on a v1 client, and
 * the proxy never matches.
 */
const DISCOVERY_METHODS: Record<string, string | undefined> = {
  listTools: MCP_METHODS.TOOLS_LIST,
  listResources: MCP_METHODS.RESOURCES_LIST,
  listPrompts: MCP_METHODS.PROMPTS_LIST,
  ping: MCP_METHODS.PING,
  discover: MCP_METHODS.SERVER_DISCOVER,
};

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
  return async function wrappedDiscovery(this: any, ...args: any[]) {
    return await withTracing({
      name: spanName,
      spanKind: SpanKind.CLIENT,
    })((ctx: TraceContext) => async () => {
      const startTime = performance.now();

      ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);
      applyConnectionAttributes(ctx, config, target);

      try {
        const result = await Reflect.apply(originalFn, target, args);
        ctx.setStatus({ code: SpanStatusCode.OK });

        if (config.enableMetrics) {
          const durationS = (performance.now() - startTime) / 1000;
          recordClientOperationDuration(durationS, {
            [MCP_SEMCONV.METHOD_NAME]: methodName,
          });
        }

        return result;
      } catch (error) {
        const failure = thrownFailure(error);

        if (config.captureErrors) {
          ctx.recordError(error);
          ctx.setAttribute(
            MCP_SEMCONV.ERROR_TYPE,
            (error as Error).name || 'Error',
          );
          applyFailureGrouping(ctx, failure.text);
        }

        if (config.enableMetrics) {
          const durationS = (performance.now() - startTime) / 1000;
          const metricAttrs: Record<string, string> = {
            [MCP_SEMCONV.METHOD_NAME]: methodName,
            [MCP_SEMCONV.ERROR_TYPE]: (error as Error).name || 'Error',
          };
          if (failure.category) {
            metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failure.category;
          }
          recordClientOperationDuration(durationS, metricAttrs);
        }

        throw error;
      }
    })();
  };
}

/**
 * Instrument an MCP client with automatic OpenTelemetry tracing
 *
 * Creates spans following the OTel MCP semantic conventions:
 * - Span names: `tools/call get_weather`, `tools/list`, `resources/read weather://config`
 * - Span kind: CLIENT
 * - Attributes: `mcp.method.name`, `gen_ai.tool.name`, `error.type`, etc.
 * - Discovery operations: `listTools`, `listResources`, `listPrompts`, `ping`,
 *   `discover` (`server/discover`)
 *
 * @param client - The MCP client instance to instrument
 * @param config - Instrumentation configuration options
 * @returns Instrumented client (proxy)
 *
 * @example
 * ```typescript
 * import { Client } from '@modelcontextprotocol/client';
 * import { instrumentMcpClient } from 'autotel-mcp-instrumentation/client';
 * import { init } from 'autotel';
 *
 * init({ service: 'mcp-client', endpoint: 'http://localhost:4318' });
 *
 * const client = new Client({ name: 'weather-client', version: '1.0.0' });
 * const instrumented = instrumentMcpClient(client, {
 *   networkTransport: 'tcp',
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

      // Wrap callTool. The trailing arguments differ by era — v1 is
      // `(params, resultSchema?, options?)`, 2026-07-28 is `(params, options?)`
      // — and this wrapper has no business knowing which: only `params` is
      // touched, the rest is forwarded verbatim.
      if (prop === 'callTool' && typeof value === 'function') {
        return async function wrappedCallTool(
          this: any,
          params: { name: string; arguments?: any; _meta?: any },
          ...rest: any[]
        ) {
          const { name, arguments: args } = params;
          const methodName = MCP_METHODS.TOOLS_CALL;

          return await withTracing({
            name: `${methodName} ${name}`,
            spanKind: SpanKind.CLIENT,
          })((ctx: TraceContext) => async () => {
            const startTime = performance.now();

            // Required
            ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);

            // Conditionally required
            ctx.setAttribute(MCP_SEMCONV.TOOL_NAME, name);

            // Recommended
            ctx.setAttribute(MCP_SEMCONV.OPERATION_NAME, 'execute_tool');
            applyConnectionAttributes(ctx, mergedConfig, target);

            // Security: argument size signal + classifier (outbound vector)
            if (args !== undefined) {
              if (mergedConfig.recordPayloadSize) {
                recordPayloadSize(ctx, MCP_SEMCONV.TOOL_ARGUMENTS_SIZE, args);
              }
              await classifyClient(
                ctx,
                mergedConfig,
                'arguments',
                'tool',
                name,
                args,
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

            // Tracks whether the tool itself returned, so a guard `stop`
            // thrown on the success path is not re-recorded as a tool error.
            let toolSucceeded = false;

            try {
              // Inject trace context into _meta field
              const meta = injectOtelContextToMeta();
              const paramsWithMeta = {
                ...params,
                _meta: { ...params._meta, ...meta },
              };

              const result = await Reflect.apply(value, target, [
                paramsWithMeta,
                ...rest,
              ]);
              toolSucceeded = true;

              // A tool reporting `isError` inside a well-formed result is a
              // failed call, not a successful one. Nothing threw, so both the
              // span and the guard would otherwise read it as a success —
              // computed here because the guard is fed before the span status is
              // set, and the two must not disagree.
              const failed = Boolean(
                (result as { isError?: unknown })?.isError,
              );

              // Security: result size, output budget, classifier (contaminated-output vector)
              if (result !== undefined) {
                const resultSize = mergedConfig.recordPayloadSize
                  ? recordPayloadSize(ctx, MCP_SEMCONV.TOOL_RESULT_SIZE, result)
                  : safeStringify(result).length;
                if (mergedConfig.outputCharBudget !== undefined) {
                  enforceOutputBudget(
                    ctx,
                    resultSize,
                    mergedConfig.outputCharBudget,
                    { [MCP_SEMCONV.TOOL_NAME]: name },
                    securityBridge(mergedConfig, name),
                  );
                }
                await classifyClient(
                  ctx,
                  mergedConfig,
                  'result',
                  'tool',
                  name,
                  result,
                );
              }

              // Enforcement: feed the genai guard. A `stop` rule throws here.
              // `error` is the tool's own verdict — hardcoding `false` here told
              // the guard every non-throwing call succeeded, so a tool failing
              // in a loop never accumulated and an error-loop rule could not
              // fire on the most common MCP failure mode.
              if (mergedConfig.guard) {
                recordGuardStep(
                  mergedConfig.guard,
                  { name, signature: safeStringify(args), error: failed },
                  ctx,
                );
              }

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

              // Marking the span OK because nothing threw is how an `isError`
              // failure stays invisible on the caller's side of the trace while
              // the server's own span already says ERROR.
              let failureCategory: McpFailureCategory | undefined;
              if (failed) {
                ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, 'tool_error');
                failureCategory = applyFailureGrouping(
                  ctx,
                  extractFailureText(result),
                );
                ctx.setStatus({ code: SpanStatusCode.ERROR });
              } else {
                ctx.setStatus({ code: SpanStatusCode.OK });
              }

              if (mergedConfig.enableMetrics) {
                const durationS = (performance.now() - startTime) / 1000;
                const metricAttrs: Record<string, string> = {
                  [MCP_SEMCONV.METHOD_NAME]: methodName,
                  [MCP_SEMCONV.TOOL_NAME]: name,
                };
                if (failed) {
                  metricAttrs[MCP_SEMCONV.ERROR_TYPE] = 'tool_error';
                }
                if (failureCategory) {
                  metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failureCategory;
                }
                recordClientOperationDuration(durationS, metricAttrs);
              }

              return result;
            } catch (error) {
              const failure = thrownFailure(error);

              if (mergedConfig.captureErrors) {
                ctx.recordError(error);
                ctx.setAttribute(
                  MCP_SEMCONV.ERROR_TYPE,
                  (error as Error).name || 'Error',
                );
                applyFailureGrouping(ctx, failure.text);
              }

              if (mergedConfig.enableMetrics) {
                const durationS = (performance.now() - startTime) / 1000;
                const metricAttrs: Record<string, string> = {
                  [MCP_SEMCONV.METHOD_NAME]: methodName,
                  [MCP_SEMCONV.TOOL_NAME]: name,
                  [MCP_SEMCONV.ERROR_TYPE]: (error as Error).name || 'Error',
                };
                if (failure.category) {
                  metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failure.category;
                }
                recordClientOperationDuration(durationS, metricAttrs);
              }

              // Enforcement: record a failed step (error-loop detection) only
              // when the tool itself failed — not when the guard stopped us.
              if (mergedConfig.guard && !toolSucceeded) {
                recordGuardStep(
                  mergedConfig.guard,
                  { name, signature: safeStringify(args), error: true },
                  ctx,
                );
              }

              throw error;
            }
          })();
        };
      }

      // Wrap readResource (Client API: readResource(params, options?))
      if (prop === 'readResource' && typeof value === 'function') {
        return async function wrappedReadResource(
          this: any,
          params: any,
          ...rest: any[]
        ) {
          const uri = params.uri;
          const methodName = MCP_METHODS.RESOURCES_READ;

          return await withTracing({
            name: methodName,
            spanKind: SpanKind.CLIENT,
          })((ctx: TraceContext) => async () => {
            const startTime = performance.now();

            ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);
            ctx.setAttribute(MCP_SEMCONV.RESOURCE_URI, uri);

            applyConnectionAttributes(ctx, mergedConfig, target);

            if (mergedConfig.customAttributes) {
              const customAttrs = mergedConfig.customAttributes({
                type: 'resource',
                name: uri,
                args: params,
              });
              ctx.setAttributes(
                customAttrs as Record<string, string | number | boolean>,
              );
            }

            if (params !== undefined) {
              if (mergedConfig.recordPayloadSize) {
                recordPayloadSize(
                  ctx,
                  getPayloadSizeAttribute('resource', 'arguments'),
                  params,
                );
              }
              await classifyClient(
                ctx,
                mergedConfig,
                'arguments',
                'resource',
                uri,
                params,
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
                ...rest,
              ]);

              if (result !== undefined) {
                const resultSize = mergedConfig.recordPayloadSize
                  ? recordPayloadSize(
                      ctx,
                      getPayloadSizeAttribute('resource', 'result'),
                      result,
                    )
                  : safeStringify(result).length;
                if (mergedConfig.outputCharBudget !== undefined) {
                  enforceOutputBudget(
                    ctx,
                    resultSize,
                    mergedConfig.outputCharBudget,
                    getEntityAttributes('resource', uri),
                    securityBridge(mergedConfig, uri),
                  );
                }
                await classifyClient(
                  ctx,
                  mergedConfig,
                  'result',
                  'resource',
                  uri,
                  result,
                );
              }

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
              const failure = thrownFailure(error);

              if (mergedConfig.captureErrors) {
                ctx.recordError(error);
                ctx.setAttribute(
                  MCP_SEMCONV.ERROR_TYPE,
                  (error as Error).name || 'Error',
                );
                applyFailureGrouping(ctx, failure.text);
              }

              if (mergedConfig.enableMetrics) {
                const durationS = (performance.now() - startTime) / 1000;
                const metricAttrs: Record<string, string> = {
                  [MCP_SEMCONV.METHOD_NAME]: methodName,
                  [MCP_SEMCONV.RESOURCE_URI]: uri,
                  [MCP_SEMCONV.ERROR_TYPE]: (error as Error).name || 'Error',
                };
                if (failure.category) {
                  metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failure.category;
                }
                recordClientOperationDuration(durationS, metricAttrs);
              }

              throw error;
            }
          })();
        };
      }

      // Wrap getPrompt (Client API: getPrompt(params, options?))
      if (prop === 'getPrompt' && typeof value === 'function') {
        return async function wrappedGetPrompt(
          this: any,
          params: { name: string; arguments?: any; _meta?: any },
          ...rest: any[]
        ) {
          const { name, arguments: args } = params;
          const methodName = MCP_METHODS.PROMPTS_GET;

          return await withTracing({
            name: `${methodName} ${name}`,
            spanKind: SpanKind.CLIENT,
          })((ctx: TraceContext) => async () => {
            const startTime = performance.now();

            ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);
            ctx.setAttribute(MCP_SEMCONV.PROMPT_NAME, name);

            applyConnectionAttributes(ctx, mergedConfig, target);

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

            if (params !== undefined) {
              if (mergedConfig.recordPayloadSize) {
                recordPayloadSize(
                  ctx,
                  getPayloadSizeAttribute('prompt', 'arguments'),
                  params,
                );
              }
              await classifyClient(
                ctx,
                mergedConfig,
                'arguments',
                'prompt',
                name,
                params,
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
                ...rest,
              ]);

              if (result !== undefined) {
                const resultSize = mergedConfig.recordPayloadSize
                  ? recordPayloadSize(
                      ctx,
                      getPayloadSizeAttribute('prompt', 'result'),
                      result,
                    )
                  : safeStringify(result).length;
                if (mergedConfig.outputCharBudget !== undefined) {
                  enforceOutputBudget(
                    ctx,
                    resultSize,
                    mergedConfig.outputCharBudget,
                    getEntityAttributes('prompt', name),
                    securityBridge(mergedConfig, name),
                  );
                }
                await classifyClient(
                  ctx,
                  mergedConfig,
                  'result',
                  'prompt',
                  name,
                  result,
                );
              }

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
              const failure = thrownFailure(error);

              if (mergedConfig.captureErrors) {
                ctx.recordError(error);
                ctx.setAttribute(
                  MCP_SEMCONV.ERROR_TYPE,
                  (error as Error).name || 'Error',
                );
                applyFailureGrouping(ctx, failure.text);
              }

              if (mergedConfig.enableMetrics) {
                const durationS = (performance.now() - startTime) / 1000;
                const metricAttrs: Record<string, string> = {
                  [MCP_SEMCONV.METHOD_NAME]: methodName,
                  [MCP_SEMCONV.PROMPT_NAME]: name,
                  [MCP_SEMCONV.ERROR_TYPE]: (error as Error).name || 'Error',
                };
                if (failure.category) {
                  metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failure.category;
                }
                recordClientOperationDuration(durationS, metricAttrs);
              }

              throw error;
            }
          })();
        };
      }

      // Discovery operations (when enabled). One table, so adding an era
      // method is a single entry rather than another eight-line block.
      if (mergedConfig.captureDiscoveryOperations) {
        const method =
          typeof prop === 'string' ? DISCOVERY_METHODS[prop] : undefined;
        if (method && typeof value === 'function') {
          return wrapDiscoveryMethod(
            method,
            method,
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
