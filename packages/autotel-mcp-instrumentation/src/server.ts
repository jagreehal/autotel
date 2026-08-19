import { context, SpanStatusCode } from '@opentelemetry/api';
import { withTracing, SpanKind, type TraceContext } from 'autotel';
import { extractOtelContextFromMeta } from './context';
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
import {
  MCP_SEMCONV,
  MCP_METHODS,
  MCP_PROTOCOL_VERSION_META_KEY,
} from './semantic-conventions';
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
import { errorName } from './error-name.js';
import type { McpMetricAttributes } from './types.js';
import {
  asRecord,
  asString,
  isFunction,
  callMethod,
  member,
  readProperty,
} from './values.js';

type ResolvedConfig = ReturnType<typeof resolveConfig>;

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

/**
 * Manifest assessments, memoised on the classifier and the normalised surface.
 *
 * A manifest is assessed at registration time, and `2026-07-28` builds a server
 * per request — so `instrumentMcpServer` runs per request, and without this the
 * classifier (potentially an LLM call) is billed on every request to re-read a
 * description that has not changed. Module scope is what makes it work: it is
 * the only scope that outlives the per-request server.
 *
 * Keyed by classifier first, because two configs may disagree about the same
 * text and a shared verdict would attribute one classifier's security finding
 * to the other. `NO_CLASSIFIER` stands in when only budgets are being checked.
 *
 * ponytail: unbounded in the number of distinct manifests, which is the tool
 * count for any normal server. Add an LRU bound if a server ever generates tool
 * names or descriptions per request.
 */
const manifestAssessments = new WeakMap<
  object,
  Map<string, Promise<ManifestAssessment | undefined>>
>();
const NO_CLASSIFIER: object = {};

function getManifestAssessmentPromise(
  type: 'tool' | 'resource' | 'prompt',
  name: string,
  configObject: unknown,
  config: ResolvedConfig,
): Promise<ManifestAssessment | undefined> | undefined {
  if (!config.classifyDescriptions && !config.validateToolBudgets) {
    return undefined;
  }
  const classifier = config.classifyDescriptions
    ? config.securityClassifier
    : undefined;
  const surface = extractManifestTextSurface(type, name, configObject);

  let byManifest = manifestAssessments.get(classifier ?? NO_CLASSIFIER);
  if (!byManifest) {
    byManifest = new Map();
    manifestAssessments.set(classifier ?? NO_CLASSIFIER, byManifest);
  }

  // `validateToolBudgets` is tri-state — undefined means "on" — so it is
  // stringified rather than coerced, and the surface carries everything else
  // the assessment reads.
  const key = `${String(config.validateToolBudgets)}:${JSON.stringify(surface)}`;
  const cached = byManifest.get(key);
  if (cached) {
    return cached;
  }

  const assessment = assessManifest(classifier, surface, {
    validateToolBudgets: config.validateToolBudgets,
  });
  byManifest.set(key, assessment);
  return assessment;
}

/** Per-request facts lifted off a handler's context argument. */
interface RequestFacts {
  /** Which argument the context was found at, so it is never read as a payload. */
  contextIndex?: number;
  meta?: Record<string, unknown>;
  sessionId?: string;
  protocolVersion?: string;
}

/**
 * Read the per-request facts a handler is given, across both MCP eras.
 *
 * The context is located by shape rather than by position, because handler
 * arity differs by kind: tools and prompts are `(args, ctx)`, resources are
 * `(uri, ctx)` or `(uri, variables, ctx)`, and a no-input handler is just
 * `(ctx)`.
 *
 * Scanning from the END is the part that matters: a tool's own arguments may
 * legitimately contain a `_meta` or `requestId` key, and a forward scan would
 * take those as the context — parenting the span onto caller-supplied trace
 * context. (In every shape above the context happens to be the last argument,
 * so the loop is equivalent to reading `args.at(-1)` for them; it keeps
 * looking only so an unexpected trailing value cannot blind it.)
 *
 * - **2026-07-28** (`@modelcontextprotocol/server` v2) passes a
 *   `ServerContext`: `_meta` hangs off `ctx.mcpReq`, and the protocol revision
 *   rides the per-request envelope because there is no handshake to pin it.
 * - **2025-era** (`@modelcontextprotocol/sdk` v1) passes a
 *   `RequestHandlerExtra`: `_meta` and `sessionId` sit at the top level, and
 *   there is no envelope — the revision was fixed once at `initialize`.
 *
 * Either way this is the only place `_meta` is visible: both SDKs validate
 * `arguments` and hand those over separately, so `traceparent` never appears
 * in the first argument.
 */
function readRequestFacts(args: unknown[]): RequestFacts {
  for (let index = args.length - 1; index >= 0; index--) {
    const arg = args[index] as any;
    if (!asRecord(arg)) continue;

    // 2026-07-28: ServerContext
    if (arg.mcpReq) {
      return {
        contextIndex: index,
        meta: arg.mcpReq._meta,
        sessionId: arg.sessionId,
        protocolVersion: arg.mcpReq.envelope?.[MCP_PROTOCOL_VERSION_META_KEY],
      };
    }

    // 2025-era: RequestHandlerExtra
    if ('_meta' in arg || 'requestId' in arg) {
      return { contextIndex: index, meta: arg._meta, sessionId: arg.sessionId };
    }
  }
  return {};
}

/**
 * The payload a handler was actually called with, or `undefined` when it was
 * called with none.
 *
 * A handler registered without an input schema is invoked as `(ctx)` on both
 * SDKs, so `args[0]` is then the context — not arguments. Serializing it would
 * put `http.authInfo.token` into a span attribute, so the context position is
 * established first and `args[0]` is only trusted when it is not that.
 */
function readCallPayload(
  args: unknown[],
  facts: RequestFacts,
): unknown | undefined {
  return facts.contextIndex === 0 ? undefined : args[0];
}

/**
 * The handler returned `input_required` (MCP 2026-07-28 multi-round-trip)
 * rather than a result: it paused for elicitation/sampling/roots and the client
 * will retry. Applies to prompts and resources as well as tools.
 *
 * Uses the SDK's own discriminator. The `inputRequests` / `requestState`
 * members are NOT reliable tells — results are passthrough-typed, so a handler
 * may legitimately return a field by either name.
 */
function isInputRequired(result: unknown): boolean {
  return readProperty(result, 'resultType') === 'input_required';
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
    // The request `_meta` (where traceparent rides) lives on the handler's
    // context argument, never in the validated arguments. Establishing where
    // the context is also tells us whether there is a payload at all.
    const request = readRequestFacts(args);
    const callPayload = readCallPayload(args, request);

    // Extract parent context from _meta field
    const parentContext = extractOtelContextFromMeta(request.meta);

    // Run handler in parent context
    return context.with(parentContext, async () => {
      return withTracing({
        name: spanName,
        spanKind: SpanKind.SERVER,
      })((ctx: TraceContext) => async () => {
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

        // Recommended: network transport, plus whatever the request itself
        // told us. On 2026-07-28 that is the protocol revision (per-request,
        // no handshake to pin it); on a 2025-era connection it is the session
        // ID (which 2026-07-28 has no such thing as). Both come off the
        // request rather than from config, so one instrumented server can
        // answer many callers correctly.
        if (config.networkTransport) {
          ctx.setAttribute(
            MCP_SEMCONV.NETWORK_TRANSPORT,
            config.networkTransport,
          );
        }
        const protocolVersion = asString(request.protocolVersion);
        if (protocolVersion !== undefined) {
          ctx.setAttribute(MCP_SEMCONV.PROTOCOL_VERSION, protocolVersion);
        }
        // Request first, config only as a legacy fallback. A modern request is
        // sessionless even over stdio, so never attach a transport or configured
        // v1 ID when its per-request protocol envelope is present.
        const sessionId =
          request.protocolVersion === undefined
            ? (request.sessionId ?? config.sessionId)
            : undefined;
        const sessionIdText = asString(sessionId);
        if (sessionIdText !== undefined) {
          ctx.setAttribute(MCP_SEMCONV.SESSION_ID, sessionIdText);
        }

        if (manifestAssessmentPromise) {
          applyManifestAssessment(
            ctx,
            await manifestAssessmentPromise,
            getEntityAttributes(type, name, resourceUri),
            securityBridge(config, type === 'tool' ? name : undefined),
          );
        }

        // Security: annotation hints (tool trust profile / malicious-manifest vector)
        if (type === 'tool' && config.captureToolAnnotations) {
          applyToolAnnotations(ctx, annotations);
        }

        // Security: argument size signal + classifier (inbound vector)
        if (callPayload !== undefined) {
          if (config.recordPayloadSize) {
            recordPayloadSize(
              ctx,
              getPayloadSizeAttribute(type, 'arguments'),
              callPayload,
            );
          }
          await classify(ctx, config, 'arguments', type, name, callPayload);
        }

        // Opt-in: tool arguments
        if (
          type === 'tool' &&
          config.captureToolArgs &&
          callPayload !== undefined
        ) {
          try {
            ctx.setAttribute(
              MCP_SEMCONV.TOOL_CALL_ARGUMENTS,
              JSON.stringify(callPayload),
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
            args: callPayload,
          });
          ctx.setAttributes(
            // SAFETY: custom attributes are the caller's own, already declared as
            // span-attribute values by the options type they came from.
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
              enforceOutputBudget(
                ctx,
                resultSize,
                config.outputCharBudget,
                {
                  ...getEntityAttributes(type, name, resourceUri),
                },
                securityBridge(config, name),
              );
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

          // Multi-round-trip: a paused call is neither a success nor an
          // error, so its status is left UNSET rather than claiming OK — a
          // success-rate panel must not count a pause as completed work.
          const paused = isInputRequired(result);
          if (paused) {
            ctx.setAttribute(MCP_SEMCONV.INPUT_REQUIRED, true);
          }

          // Error handling: tool error via isError
          let failureCategory: McpFailureCategory | undefined;
          if (result?.isError) {
            ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, 'tool_error');
            failureCategory = applyFailureGrouping(
              ctx,
              extractFailureText(result),
            );
            ctx.setStatus({ code: SpanStatusCode.ERROR });
          } else if (!paused) {
            ctx.setStatus({ code: SpanStatusCode.OK });
          }

          // Custom attributes (post-call with result)
          if (config.customAttributes) {
            const customAttrs = config.customAttributes({
              type,
              name,
              args: callPayload,
              result,
            });
            ctx.setAttributes(
              // SAFETY: custom attributes are the caller's own, already declared as
              // span-attribute values by the options type they came from.
              customAttrs as Record<string, string | number | boolean>,
            );
          }

          // Record metric
          if (config.enableMetrics) {
            const durationS = (performance.now() - startTime) / 1000;
            const metricAttrs: Record<string, string | boolean> = {
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
            if (paused) {
              // Keeps "asked a question" out of the did-the-work latency bucket.
              metricAttrs[MCP_SEMCONV.INPUT_REQUIRED] = true;
            }
            if (result?.isError) {
              metricAttrs[MCP_SEMCONV.ERROR_TYPE] = 'tool_error';
            }
            if (failureCategory) {
              metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = failureCategory;
            }
            recordServerOperationDuration(durationS, metricAttrs);
          }

          return result;
        } catch (error) {
          const thrownText = failureTextFromError(error);
          const thrownCategory = thrownText
            ? classifyFailure(thrownText)
            : undefined;

          // Record exception if configured
          if (config.captureErrors) {
            if ('recordError' in ctx && typeof ctx.recordError === 'function') {
              ctx.recordError(error);
            } else if (
              'recordException' in ctx &&
              typeof ctx.recordException === 'function'
            ) {
              ctx.recordException(error);
            }
            ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, errorName(error));
            applyFailureGrouping(ctx, thrownText);
          }

          // Record metric on error
          if (config.enableMetrics) {
            const durationS = (performance.now() - startTime) / 1000;
            const metricAttrs: McpMetricAttributes = {
              [MCP_SEMCONV.METHOD_NAME]: methodName,
              [MCP_SEMCONV.ERROR_TYPE]: errorName(error),
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
            if (thrownCategory) {
              metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = thrownCategory;
            }
            recordServerOperationDuration(durationS, metricAttrs);
          }

          throw error;
        }
      })();
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
 * import { McpServer } from '@modelcontextprotocol/server';
 * import { instrumentMcpServer } from 'autotel-mcp-instrumentation/server';
 * import { init } from 'autotel';
 *
 * init({ service: 'mcp-server', endpoint: 'http://localhost:4318' });
 *
 * // MCP 2026-07-28 builds a server per request, so instrument inside the
 * // factory you hand to `createMcpHandler` / `serveStdio`.
 * const createServer = () => {
 *   const server = new McpServer({ name: 'weather', version: '1.0.0' });
 *   const instrumented = instrumentMcpServer(server, {
 *     networkTransport: 'tcp',
 *     captureToolArgs: true,
 *   });
 *
 *   instrumented.registerTool('get_weather', { ... }, async (args, ctx) => {
 *     // Automatically traced, parented to the client's span via ctx.mcpReq._meta
 *   });
 *
 *   return instrumented;
 * };
 * ```
 */
export function instrumentMcpServer<T extends Record<string, any>>(
  server: T,
  config?: McpInstrumentationConfig,
): T {
  const mergedConfig = resolveConfig(config);

  return new Proxy(server, {
    get(target, prop) {
      const value = member(target, prop);

      // Wrap registerTool (McpServer API: name, config, handler)
      if (prop === 'registerTool' && isFunction(value)) {
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

          return callMethod(value, target, [name, toolConfig, wrappedHandler]);
        };
      }

      // Wrap registerResource (McpServer API: name, uriOrTemplate, config, readCallback)
      if (prop === 'registerResource' && isFunction(value)) {
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

          return callMethod(value, target, [
            name,
            uriOrTemplate,
            resourceConfig,
            wrappedCallback,
          ]);
        };
      }

      // Wrap registerPrompt (McpServer API: name, config, cb)
      if (prop === 'registerPrompt' && isFunction(value)) {
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

          return callMethod(value, target, [
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
