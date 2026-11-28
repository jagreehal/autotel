import { SpanStatusCode } from '@opentelemetry/api';
import { withTracing, SpanKind, type TraceContext } from '#runtime';
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
import { errorName } from './error-name.js';
import {
  traceEventsClientRequest,
  traceEventsNotificationHandler,
} from './events';
import {
  createdTask,
  taskAttributes,
  traceExtensionClientRequest,
} from './tasks-skills';
import {
  capturedPayload,
  failureMessage,
  recordableError,
  rethrowOriginal,
  thrownInSpan,
} from './content.js';
import type { McpMetricAttributes } from './types.js';
import {
  asRecord,
  asString,
  callIfPresent,
  callMethod,
  isFunction,
  member,
  readProperty,
} from './values.js';

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
interface ThrownFailure {
  text: string;
  category: McpFailureCategory | undefined;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a thrown value can be anything; failureTextFromError decodes it.
function thrownFailure(error: unknown): ThrownFailure {
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a tool's arguments or result: any payload the caller or server supplies, handed to the user's classifier as is.
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
) {
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
  const protocolEra = asString(callIfPresent(target, 'getProtocolEra'));
  const protocolVersion = asString(
    callIfPresent(target, 'getNegotiatedProtocolVersion'),
  );
  if (protocolEra === 'modern' && protocolVersion !== undefined) {
    ctx.setAttribute(MCP_SEMCONV.PROTOCOL_VERSION, protocolVersion);
  }

  // Transport first, config only as a legacy fallback. Modern transports are
  // intentionally sessionless, including stdio, so neither a stale transport
  // value nor a configured v1 fallback may leak onto their spans.
  const sessionId =
    protocolEra === 'modern'
      ? undefined
      : (target?.transport?.sessionId ?? config.sessionId);
  const sessionIdText = asString(sessionId);
  if (sessionIdText !== undefined) {
    ctx.setAttribute(MCP_SEMCONV.SESSION_ID, sessionIdText);
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
const DISCOVERY_METHODS = new Map<string, string>([
  ['listTools', MCP_METHODS.TOOLS_LIST],
  ['listResources', MCP_METHODS.RESOURCES_LIST],
  ['listPrompts', MCP_METHODS.PROMPTS_LIST],
  ['ping', MCP_METHODS.PING],
  ['discover', MCP_METHODS.SERVER_DISCOVER],
]);

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
        const result = await callMethod(originalFn, target, args);
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
        const recorded = recordableError(config, error, spanName);

        if (config.captureErrors) {
          ctx.recordError(recorded);
          ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, errorName(error));
          applyFailureGrouping(ctx, failure.text);
        }

        if (config.enableMetrics) {
          const durationS = (performance.now() - startTime) / 1000;
          const metricAttrs: McpMetricAttributes = {
            [MCP_SEMCONV.METHOD_NAME]: methodName,
            [MCP_SEMCONV.ERROR_TYPE]: errorName(error),
          };
          if (failure.category) {
            metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failure.category;
          }
          recordClientOperationDuration(durationS, metricAttrs);
        }

        throw thrownInSpan(error, recorded);
      }
    })().catch(rethrowOriginal);
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
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- public generic constraint: narrowing it would reject SDK instances typed without an index signature and change what ReturnType<typeof instrumentMcpClient> gives callers.
export function instrumentMcpClient<T extends Record<string, any>>(
  client: T,
  config?: McpInstrumentationConfig,
): T {
  const mergedConfig = resolveConfig(config);

  return new Proxy(client, {
    get(target, prop) {
      const value = member(target, prop);

      // Wrap callTool. The trailing arguments differ by era — v1 is
      // `(params, resultSchema?, options?)`, 2026-07-28 is `(params, options?)`
      // — and this wrapper has no business knowing which: only `params` is
      // touched, the rest is forwarded verbatim.
      if (prop === 'callTool' && isFunction(value)) {
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
              const captured = capturedPayload(mergedConfig, args, {
                kind: 'input',
                type: 'tool',
                name,
              });
              if (captured !== undefined)
                ctx.setAttribute(MCP_SEMCONV.TOOL_CALL_ARGUMENTS, captured);
            }

            // Custom attributes (pre-call)
            if (mergedConfig.customAttributes) {
              const customAttrs = mergedConfig.customAttributes({
                type: 'tool',
                name,
                args,
              });
              ctx.setAttributes(
                // SAFETY: custom attributes are the caller's own, already declared as
                // span-attribute values by the options type they came from.
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

              const result = await callMethod(value, target, [
                paramsWithMeta,
                ...rest,
              ]);
              toolSucceeded = true;

              // A tool reporting `isError` inside a well-formed result is a
              // failed call, not a successful one. Nothing threw, so both the
              // span and the guard would otherwise read it as a success —
              // computed here because the guard is fed before the span status is
              // set, and the two must not disagree.
              const failed = Boolean(readProperty(result, 'isError'));
              const createdAsTask = createdTask(result);

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
                const captured = capturedPayload(mergedConfig, result, {
                  kind: 'output',
                  type: 'tool',
                  name,
                });
                if (captured !== undefined)
                  ctx.setAttribute(MCP_SEMCONV.TOOL_CALL_RESULT, captured);
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
                  // SAFETY: custom attributes are the caller's own, already declared as
                  // span-attribute values by the options type they came from.
                  customAttrs as Record<string, string | number | boolean>,
                );
              }

              // Marking the span OK because nothing threw is how an `isError`
              // failure stays invisible on the caller's side of the trace while
              // the server's own span already says ERROR.
              let failureCategory: McpFailureCategory | undefined;
              if (failed) {
                ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, 'tool_error');
                const failureText = extractFailureText(result);
                failureCategory = applyFailureGrouping(ctx, failureText);
                ctx.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: mergedConfig.captureErrors
                    ? failureMessage(mergedConfig, failureText, name)
                    : undefined,
                });
              } else if (createdAsTask) {
                // Accepted as a task, not done: tasks/* report the outcome.
                // Set, not left: an unset status is reported as OK when the span ends.
                ctx.setAttributes(taskAttributes(createdAsTask));
                ctx.setAttribute(MCP_SEMCONV.TASK_AUGMENTED, true);
                ctx.setStatus({ code: SpanStatusCode.UNSET });
              } else {
                ctx.setStatus({ code: SpanStatusCode.OK });
              }

              if (mergedConfig.enableMetrics) {
                const durationS = (performance.now() - startTime) / 1000;
                const metricAttrs: McpMetricAttributes = {
                  [MCP_SEMCONV.METHOD_NAME]: methodName,
                  [MCP_SEMCONV.TOOL_NAME]: name,
                };
                if (failed) {
                  metricAttrs[MCP_SEMCONV.ERROR_TYPE] = 'tool_error';
                }
                if (createdAsTask) {
                  metricAttrs[MCP_SEMCONV.TASK_AUGMENTED] = true;
                }
                if (failureCategory) {
                  metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failureCategory;
                }
                recordClientOperationDuration(durationS, metricAttrs);
              }

              return result;
            } catch (error) {
              const failure = thrownFailure(error);
              const recorded = recordableError(mergedConfig, error, name);

              if (mergedConfig.captureErrors) {
                ctx.recordError(recorded);
                ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, errorName(error));
                applyFailureGrouping(ctx, failure.text);
              }

              if (mergedConfig.enableMetrics) {
                const durationS = (performance.now() - startTime) / 1000;
                const metricAttrs: McpMetricAttributes = {
                  [MCP_SEMCONV.METHOD_NAME]: methodName,
                  [MCP_SEMCONV.TOOL_NAME]: name,
                  [MCP_SEMCONV.ERROR_TYPE]: errorName(error),
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

              throw thrownInSpan(error, recorded);
            }
          })().catch(rethrowOriginal);
        };
      }

      // Wrap readResource (Client API: readResource(params, options?))
      if (prop === 'readResource' && isFunction(value)) {
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
                // SAFETY: custom attributes are the caller's own, already declared as
                // span-attribute values by the options type they came from.
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

              const result = await callMethod(value, target, [
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
              const recorded = recordableError(mergedConfig, error, uri);

              if (mergedConfig.captureErrors) {
                ctx.recordError(recorded);
                ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, errorName(error));
                applyFailureGrouping(ctx, failure.text);
              }

              if (mergedConfig.enableMetrics) {
                const durationS = (performance.now() - startTime) / 1000;
                const metricAttrs: McpMetricAttributes = {
                  [MCP_SEMCONV.METHOD_NAME]: methodName,
                  [MCP_SEMCONV.RESOURCE_URI]: uri,
                  [MCP_SEMCONV.ERROR_TYPE]: errorName(error),
                };
                if (failure.category) {
                  metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failure.category;
                }
                recordClientOperationDuration(durationS, metricAttrs);
              }

              throw thrownInSpan(error, recorded);
            }
          })().catch(rethrowOriginal);
        };
      }

      // Wrap getPrompt (Client API: getPrompt(params, options?))
      if (prop === 'getPrompt' && isFunction(value)) {
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
                // SAFETY: custom attributes are the caller's own, already declared as
                // span-attribute values by the options type they came from.
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

              const result = await callMethod(value, target, [
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
              const recorded = recordableError(mergedConfig, error, name);

              if (mergedConfig.captureErrors) {
                ctx.recordError(recorded);
                ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, errorName(error));
                applyFailureGrouping(ctx, failure.text);
              }

              if (mergedConfig.enableMetrics) {
                const durationS = (performance.now() - startTime) / 1000;
                const metricAttrs: McpMetricAttributes = {
                  [MCP_SEMCONV.METHOD_NAME]: methodName,
                  [MCP_SEMCONV.PROMPT_NAME]: name,
                  [MCP_SEMCONV.ERROR_TYPE]: errorName(error),
                };
                if (failure.category) {
                  metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failure.category;
                }
                recordClientOperationDuration(durationS, metricAttrs);
              }

              throw thrownInSpan(error, recorded);
            }
          })().catch(rethrowOriginal);
        };
      }

      // MCP Events: `events/*` requests, and the handlers for the
      // notifications that deliver pushed occurrences.
      if (prop === 'request' && isFunction(value)) {
        // SAFETY: isFunction checked it; the wrapper forwards every argument.
        return traceExtensionClientRequest(
          traceEventsClientRequest(value as never, target, mergedConfig),
          target,
          mergedConfig,
        );
      }
      if (prop === 'setNotificationHandler' && isFunction(value)) {
        return traceEventsNotificationHandler(
          // SAFETY: as above.
          value as never,
          target,
          mergedConfig,
        );
      }

      // Discovery operations (when enabled). One table, so adding an era
      // method is a single entry rather than another eight-line block.
      if (mergedConfig.captureDiscoveryOperations) {
        const propName = asString(prop);
        const method =
          propName === undefined ? undefined : DISCOVERY_METHODS.get(propName);
        if (method && isFunction(value)) {
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

/** The one transport method {@link instrumentMcpTransport} wraps. */
interface SendingTransport {
  send(message: never, ...rest: never[]): Promise<void>;
}

/** A transport's send, as {@link instrumentMcpTransport} calls it. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- an outgoing JSON-RPC message of any kind; withTraceMeta decodes it.
type SendMessage = (message: unknown, ...rest: never[]) => Promise<void>;

/**
 * Add the active trace context to `params._meta` of every request a transport
 * sends, so the server's spans join the caller's trace.
 *
 * For MCP clients you cannot wrap with {@link instrumentMcpClient} because
 * they keep their SDK `Client` private: `@ai-sdk/mcp`, `@tanstack/ai-mcp`, and
 * the like. It creates no spans; the span active at call time (an agent's
 * `execute_tool`, say) becomes the server span's parent. Keys the caller
 * already put in `_meta` win, so it composes with `instrumentMcpClient`.
 * Responses and notifications pass through unchanged.
 *
 * Patches `transport.send` in place and returns the same transport.
 *
 * @example
 * ```typescript
 * import { createMCPClient } from '@ai-sdk/mcp';
 * import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
 * import { instrumentMcpTransport } from 'autotel-mcp-instrumentation/client';
 *
 * const mcp = await createMCPClient({
 *   transport: instrumentMcpTransport(
 *     new Experimental_StdioMCPTransport({ command: 'node', args: ['server.js'] }),
 *   ),
 * });
 * ```
 */
export function instrumentMcpTransport<T extends SendingTransport>(
  transport: T,
): T {
  // SAFETY: send is called with the JSON-RPC message objects the client
  // passes; withTraceMeta only rewrites requests and hands everything else
  // back untouched.
  const send = transport.send.bind(transport) as SendMessage;
  const traced: SendMessage = (message, ...rest) =>
    send(withTraceMeta(message) ?? message, ...rest);
  // SAFETY: traced takes the same arguments as the original send and returns
  // its promise.
  transport.send = traced as T['send'];
  return transport;
}

/** The trace context keys added to an outgoing request's `_meta`. */
interface TraceMeta {
  traceparent: string;
  tracestate?: string;
  baggage?: string;
}

/** The request with trace context in its `_meta`, or undefined to send the message untouched. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- an outgoing JSON-RPC message of any kind: this is where it is decoded.
function withTraceMeta(message: unknown) {
  const request = asRecord(message);
  // A request has both a method and an id; notifications and responses don't.
  if (!request || asString(request.method) === undefined || !('id' in request))
    return;
  const { traceparent, tracestate, baggage } = injectOtelContextToMeta();
  if (!traceparent) return;
  const params = asRecord(request.params) ?? {};
  const traceMeta: TraceMeta = { traceparent };
  if (tracestate) traceMeta.tracestate = tracestate;
  if (baggage) traceMeta.baggage = baggage;
  return {
    ...request,
    params: { ...params, _meta: { ...traceMeta, ...asRecord(params._meta) } },
  };
}

export { processEvent, type McpEventOccurrence } from './events';
