import { context, SpanStatusCode } from '@opentelemetry/api';
import { withTracing, SpanKind, type TraceContext } from '#runtime';
import { serverParentContext } from './context';
import {
  GET_MORE_TOOLS,
  installTaskHandles,
  readTaskFacts,
  type TaskFacts,
} from './task-handles';
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
  MCP_CLIENT_INFO_META_KEY,
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
import { traceEventsHandlers } from './events';
import {
  createdTask,
  elicitationActions,
  relatedTaskId,
  taskAttributes,
  traceExtensionHandlers,
} from './tasks-skills';
import {
  LOW_LEVEL,
  patchRequestHandlers,
  type RequestHandler,
} from './request-handlers';
import {
  carryClientIdentity,
  decodeClientIdentity,
} from './client-identity.js';
import {
  failureMessage,
  recordableError,
  capturedPayload,
  rethrowOriginal,
  thrownInSpan,
  redactText,
} from './content.js';
import type { McpMetricAttributes } from './types.js';
import {
  asRecord,
  asString,
  isFunction,
  callMethod,
  member,
  readProperty,
  type UnknownRecord,
} from './values.js';

type ResolvedConfig = ReturnType<typeof resolveConfig> & {
  /** The connection's client, for a 2025-era request (the SDK's getClientVersion). */
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the SDK's getClientVersion result; its shape varies by SDK version and is read by the client-attribute code.
  connectionClient?: () => unknown;
};

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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a tool's arguments or result: any payload the caller or handler supplies, handed to the user's classifier as is.
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
) {
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
 * Unbounded in the number of distinct manifests, which is the tool
 * count for any normal server. Add an LRU bound if a server ever generates tool
 * names or descriptions per request.
 */
const manifestAssessments = new WeakMap<
  object,
  Map<string, Promise<ManifestAssessment | undefined>>
>();
const NO_CLASSIFIER = {};

function getManifestAssessmentPromise(
  type: 'tool' | 'resource' | 'prompt',
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the registration config the SDK accepts, whose shape varies by SDK version; extractManifestTextSurface reads each field it uses.
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
  meta?: UnknownRecord;
  sessionId?: string;
  protocolVersion?: string;
  /** The 2026-07-28 envelope's clientInfo. */
  client?: unknown;
  /** The client an `mcpci1.` id names, on a request with no native session. */
  headerClient?: unknown;
  /** A retried request's answers to its `inputRequests` (2026-07-28). */
  inputResponses?: UnknownRecord;
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
    const arg = asRecord(args[index]);
    if (!arg) continue;

    // 2026-07-28: ServerContext
    if (arg.mcpReq) {
      const meta = asRecord(readProperty(arg.mcpReq, '_meta'));
      const envelope = asRecord(readProperty(arg.mcpReq, 'envelope'));
      return {
        contextIndex: index,
        meta,
        sessionId: asString(arg.sessionId),
        protocolVersion: asString(envelope?.[MCP_PROTOCOL_VERSION_META_KEY]),
        client:
          envelope?.[MCP_CLIENT_INFO_META_KEY] ??
          meta?.[MCP_CLIENT_INFO_META_KEY],
        inputResponses: asRecord(readProperty(arg.mcpReq, 'inputResponses')),
      };
    }

    // 2025-era: RequestHandlerExtra. On stateless HTTP the client named
    // itself only on initialize; the id we issued then carries it.
    if ('_meta' in arg || 'requestId' in arg) {
      // A transport with sessions owns the header: it is no identity of ours.
      const headerClient = arg.sessionId
        ? undefined
        : decodeClientIdentity(
            readProperty(
              readProperty(arg.requestInfo, 'headers'),
              'mcp-session-id',
            ),
          );
      return {
        contextIndex: index,
        meta: asRecord(arg._meta),
        sessionId: asString(arg.sessionId),
        ...(headerClient && { headerClient }),
      };
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
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the handler's own payload, whatever the caller sent; it is only serialized or classified, never read here.
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
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a handler's result, passthrough-typed by the SDK; only its discriminator is read.
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

// oxlint-disable-next-line anti-slop/no-unknown-returns -- forwards getClientVersion's SDK-owned result, whose shape varies by SDK version.
function safely(read: (() => unknown) | undefined): unknown {
  try {
    return read?.();
  } catch {
    return undefined;
  }
}

/** The SDK's getClientVersion on an McpServer (`.server`) or a low-level Server. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- an McpServer or low-level Server of either SDK era, and getClientVersion's SDK-owned result; both shapes vary by SDK version.
function connectionClientOf(server: unknown): () => unknown {
  return () => {
    for (const s of [readProperty(server, 'server'), server]) {
      const owner = asRecord(s);
      const get = readProperty(owner, 'getClientVersion');
      if (owner && isFunction(get)) return callMethod(get, owner, []);
    }
    return;
  };
}

/** What the request-level task handles resolved for this call (task-handles.ts). */
function applyTaskFacts(
  ctx: TraceContext,
  task: TaskFacts,
  config: ResolvedConfig,
  name: string,
): void {
  if (task.conversationId)
    ctx.setAttribute(MCP_SEMCONV.CONVERSATION_ID, task.conversationId);
  if (task.sessionSource)
    ctx.setAttribute(MCP_SEMCONV.SESSION_HANDLE_SOURCE, task.sessionSource);
  if (task.agentId) ctx.setAttribute(MCP_SEMCONV.AGENT_ID, task.agentId);
  const intent = redactText(config, task.intent, { kind: 'intent', name });
  if (intent) ctx.setAttribute(MCP_SEMCONV.TOOL_CALL_INTENT, intent);
  if (task.model) ctx.setAttribute(MCP_SEMCONV.AGENT_MODEL, task.model);
  if (task.missingTool)
    ctx.setAttribute(MCP_SEMCONV.MISSING_TOOL_DESCRIPTION, task.missingTool);
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
  /**
   * True for a request hook that runs before the SDK validates the request:
   * the name comes from the client, and `resourceUri` may expand a template.
   */
  requestHook = false,
): T {
  const methodName = getMethodName(type);
  const spanName = getSpanName(type, name);

  // SAFETY: the wrapper forwards every argument to handler and resolves with
  // its result; the SDK awaits whatever a handler returns, so it stands in for T.
  return (async (...args: any[]) => {
    // The request `_meta` (where traceparent rides) lives on the handler's
    // context argument, never in the validated arguments. Establishing where
    // the context is also tells us whether there is a payload at all.
    const request = readRequestFacts(args);
    const callPayload = readCallPayload(args, request);
    const task = type === 'tool' ? readTaskFacts() : undefined;

    // Parent: the caller's context from _meta, or the host's span when the
    // host has already joined that trace (see serverParentContext).
    const parentContext = serverParentContext(request.meta);

    // Run handler in parent context
    return context.with(parentContext, async () => {
      return withTracing({
        name: spanName,
        spanKind: SpanKind.SERVER,
      })((ctx: TraceContext) => async () => {
        const startTime = performance.now();

        // Required: mcp.method.name
        ctx.setAttribute(MCP_SEMCONV.METHOD_NAME, methodName);
        // A request made on behalf of a task names it in _meta.
        const relatedTask = relatedTaskId(request.meta);
        if (relatedTask) ctx.setAttribute(MCP_SEMCONV.TASK_ID, relatedTask);
        // A retry after a pause: what the user answered.
        const actions = elicitationActions(request.inputResponses);
        if (actions.length > 0)
          ctx.setAttribute(MCP_SEMCONV.ELICITATION_ACTION, actions);

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

        if (task) applyTaskFacts(ctx, task, config, name);
        // Last in the session order: the MCP transport's own session, when
        // nothing chose one (an application session, the agent's handle).
        if (type === 'tool' && !task?.conversationId && request.sessionId) {
          const transportSession = asString(request.sessionId);
          if (transportSession) {
            ctx.setAttribute(MCP_SEMCONV.CONVERSATION_ID, transportSession);
            ctx.setAttribute(MCP_SEMCONV.SESSION_HANDLE_SOURCE, 'transport');
          }
        }

        // Client software as it names itself: per request on 2026-07-28, from
        // the initialize handshake on a 2025-era connection.
        // The negotiated identity wins over the one our header carried.
        const client = asRecord(
          request.client ??
            safely(config.connectionClient) ??
            (config.statelessClientIdentity ? request.headerClient : undefined),
        );
        const clientName = asString(client?.name);
        const clientVersion = asString(client?.version);
        if (clientName) ctx.setAttribute(MCP_SEMCONV.CLIENT_NAME, clientName);
        if (clientVersion)
          ctx.setAttribute(MCP_SEMCONV.CLIENT_VERSION, clientVersion);

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
          const captured = capturedPayload(config, callPayload, {
            kind: 'input',
            type,
            name,
          });
          if (captured !== undefined)
            ctx.setAttribute(MCP_SEMCONV.TOOL_CALL_ARGUMENTS, captured);
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
          // `identify` runs beside the handler; whatever it settled by now
          // is recorded, and it is never waited for.
          const result = await Promise.resolve(handler(...args)).finally(() => {
            if (task?.userId)
              ctx.setAttribute(MCP_SEMCONV.USER_ID, task.userId);
          });

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
            const captured = capturedPayload(config, result, {
              kind: 'output',
              type,
              name,
            });
            if (captured !== undefined)
              ctx.setAttribute(MCP_SEMCONV.TOOL_CALL_RESULT, captured);
          }

          // Multi-round-trip: a paused call is neither a success nor an
          // error, so its status is left UNSET rather than claiming OK — a
          // success-rate panel must not count a pause as completed work.
          const paused = isInputRequired(result);
          if (paused) {
            ctx.setAttribute(MCP_SEMCONV.INPUT_REQUIRED, true);
          }
          // Ran as a task: the call only accepted the work, which tasks/* then
          // report on. Status stays UNSET, as for a pause: nothing completed yet.
          const createdAsTask = createdTask(result);
          if (createdAsTask) {
            ctx.setAttributes(taskAttributes(createdAsTask));
            ctx.setAttribute(MCP_SEMCONV.TASK_AUGMENTED, true);
          }

          // Error handling: tool error via isError
          let failureCategory: McpFailureCategory | undefined;
          if (result?.isError) {
            ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, 'tool_error');
            const failureText = extractFailureText(result);
            failureCategory = applyFailureGrouping(ctx, failureText);
            ctx.setStatus({
              code: SpanStatusCode.ERROR,
              message: config.captureErrors
                ? failureMessage(config, failureText, name)
                : undefined,
            });
          } else if (paused || createdAsTask) {
            // Set, not left: an unset status is reported as OK when the span ends.
            ctx.setStatus({ code: SpanStatusCode.UNSET });
          } else {
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
            const metricAttrs: McpMetricAttributes = {
              [MCP_SEMCONV.METHOD_NAME]: methodName,
            };
            switch (type) {
              case 'tool': {
                metricAttrs[MCP_SEMCONV.TOOL_NAME] = name;
                break;
              }
              case 'resource': {
                if (!requestHook) {
                  metricAttrs[MCP_SEMCONV.RESOURCE_URI] = resourceUri ?? name;
                }
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
            if (createdAsTask) metricAttrs[MCP_SEMCONV.TASK_AUGMENTED] = true;
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
          // In a request hook, -32602 / -32601 means the SDK found no handler
          // for the requested name. That name came from the client, so it stays
          // off the span name and the duration metric.
          const code = readProperty(error, 'code');
          const rejected =
            requestHook && (code === -32_602 || code === -32_601);
          if (rejected) ctx.updateName(methodName);
          const thrownText = failureTextFromError(error);
          const thrownCategory = thrownText
            ? classifyFailure(thrownText)
            : undefined;

          // What the span may say about it: the text only with
          // captureErrorMessages, through redact.
          const recorded = recordableError(config, error, name);

          // Record exception if configured
          if (config.captureErrors) {
            if ('recordError' in ctx && isFunction(ctx.recordError)) {
              callMethod(ctx.recordError, ctx, [recorded]);
            } else if (
              'recordException' in ctx &&
              isFunction(ctx.recordException)
            ) {
              callMethod(ctx.recordException, ctx, [recorded]);
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
            if (!rejected) {
              switch (type) {
                case 'tool': {
                  metricAttrs[MCP_SEMCONV.TOOL_NAME] = name;
                  break;
                }
                case 'resource': {
                  if (!requestHook) {
                    metricAttrs[MCP_SEMCONV.RESOURCE_URI] = resourceUri ?? name;
                  }
                  break;
                }
                case 'prompt': {
                  metricAttrs[MCP_SEMCONV.PROMPT_NAME] = name;
                  break;
                }
              }
            }
            if (thrownCategory) {
              metricAttrs[MCP_SEMCONV.FAILURE_CATEGORY] = thrownCategory;
            }
            recordServerOperationDuration(durationS, metricAttrs);
          }

          // The span records what it throws, so it throws the recordable
          // copy; the SDK gets the original back below.
          throw thrownInSpan(error, recorded);
        }
      })().catch(rethrowOriginal);
    });
  }) as T;
}

/**
 * The low-level `Server` API (`setRequestHandler(CallToolRequestSchema, …)`)
 * has no `registerTool` to wrap, so its request handlers are traced instead,
 * with the same spans as a registered tool. The name comes from the request,
 * as in {@link traceMcpHandler}.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a low-level Server of either SDK era; patchRequestHandlers decodes its private handler map.
function traceLowLevelHandlers(server: unknown, config: ResolvedConfig): void {
  patchRequestHandlers(
    server,
    LOW_LEVEL,
    [...LOW_LEVEL.keys()],
    (method, raw) => (request, extra) => {
      const facts = LOW_LEVEL.get(method)!(
        asRecord(readProperty(request, 'params')),
      );
      const traced = wrapHandler(
        facts.type,
        facts.name,
        (..._args: Parameters<RequestHandler>) => raw(request, extra),
        config,
        facts.type === 'resource' ? facts.name : undefined,
        undefined,
        undefined,
        true,
      );
      return traced(facts.payload, extra);
    },
  );
}

/** What {@link traceMcpHandler} is tracing. */
export interface TraceMcpHandlerOptions {
  type: 'tool' | 'resource' | 'prompt';
  /**
   * Tool or prompt name, or the resource URI. A tool or prompt name also
   * labels the duration metric, so keep it low-cardinality.
   */
  name: string;
  /**
   * Resource URI (`mcp.resource.uri`) on the span; defaults to `name`. The
   * duration metric leaves it out, since it may expand a template.
   */
  resourceUri?: string;
  annotations?: McpToolAnnotations;
  config?: McpInstrumentationConfig;
}

/**
 * Trace one MCP handler with the same spans, attributes and metrics as
 * {@link instrumentMcpServer}, for frameworks that expose a request hook
 * instead of the SDK's `registerTool` / `registerResource` / `registerPrompt`
 * (Skybridge middleware, for example).
 *
 * The handler is called with the arguments the wrapper receives. Pass the
 * request context (v2 `ServerContext` or v1 `RequestHandlerExtra`) as the last
 * argument so the span is parented to the caller's `_meta` trace context.
 */
export function traceMcpHandler<A extends unknown[], R>(
  handler: (...args: A) => R,
  options: TraceMcpHandlerOptions,
): (...args: A) => Promise<Awaited<R>> {
  // A request hook sees no tool description, so no manifest assessment.
  const traced = wrapHandler(
    options.type,
    options.name,
    handler,
    resolveConfig(options.config),
    options.resourceUri,
    options.annotations,
    undefined,
    true,
  );
  return async (...args: A): Promise<Awaited<R>> => await traced(...args);
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
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- public generic constraint: narrowing it would reject SDK instances typed without an index signature and change what ReturnType<typeof instrumentMcpServer> gives callers.
export function instrumentMcpServer<T extends Record<string, any>>(
  server: T,
  config?: McpInstrumentationConfig,
): T {
  const mergedConfig: ResolvedConfig = {
    ...resolveConfig(config),
    connectionClient: connectionClientOf(server),
  };
  // Tracing first, so request-level task handles wrap the traced handler and
  // their facts are in context when its span starts.
  const lowLevel = !isFunction(member(server, 'registerTool'));
  if (lowLevel) traceLowLevelHandlers(server, mergedConfig);
  traceEventsHandlers(server, mergedConfig);
  traceExtensionHandlers(server, mergedConfig);
  if (config)
    installTaskHandles(server, config, (handler) =>
      wrapHandler('tool', GET_MORE_TOOLS, handler, mergedConfig),
    );

  return new Proxy(server, {
    get(target, prop) {
      const value = member(target, prop);

      // Stateless Streamable HTTP: keep the client's identity across requests.
      if (
        prop === 'connect' &&
        isFunction(value) &&
        mergedConfig.statelessClientIdentity
      ) {
        return function wrappedConnect(this: any, ...args: unknown[]) {
          carryClientIdentity(args[0]);
          return callMethod(value, target, args);
        };
      }

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
          // SAFETY: applyToolAnnotations reads each hint through asBoolean, so
          // an annotations value of any other shape sets nothing.
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
          const uri = asString(uriOrTemplate) ?? name;
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
