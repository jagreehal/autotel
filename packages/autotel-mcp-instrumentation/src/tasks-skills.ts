/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Decodes tasks/* and skills/* requests and results off the SDK's request-handler map and a client's request(), whose shapes are the wire format's; every field is read through values.ts before it reaches a span. */
/**
 * Tasks and Skills over MCP: the request methods those features add, traced
 * on both sides like the base methods, plus the task facts a tool call that
 * ran as a task carries.
 *
 * Neither SDK has a dedicated API for them: a server's handlers for
 * `tasks/*` and `skills/*` sit on its request-handler map (the SDK's own task
 * store sets the former), and a client sends them with `request()`. So this is
 * a third table for {@link patchRequestHandlers}, beside the low-level and
 * Events ones, and a wrapper around `client.request`.
 *
 * Task ids are span attributes only: one series per task on a metric would
 * be unbounded. A skill name labels the metric, since a server serves a
 * bounded catalog, but only once the server has answered for it: the URI in a
 * request comes from the client.
 */

import { context, SpanStatusCode, type Attributes } from '@opentelemetry/api';
import { SpanKind, withTracing, type TraceContext } from '#runtime';
import { injectOtelContextToMeta, serverParentContext } from './context';
import { recordableError, rethrowOriginal, thrownInSpan } from './content.js';
import { errorName } from './error-name.js';
import {
  applyFailureGrouping,
  classifyFailure,
  extractFailureText,
  failureTextFromError,
} from './failure';
import {
  recordClientOperationDuration,
  recordServerOperationDuration,
} from './metrics';
import { patchRequestHandlers, type RequestHandler } from './request-handlers';
import {
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_METHODS,
  MCP_RELATED_TASK_META_KEY,
  MCP_SEMCONV,
  MCP_TASKS_EXTENSION,
} from './semantic-conventions';
import type { McpMetricAttributes, resolveConfig } from './types';
import {
  asRecord,
  asString,
  readProperty,
  type UnknownRecord,
} from './values.js';

type ResolvedConfig = ReturnType<typeof resolveConfig>;

/** A task's statuses (SEP-2663, and 2025-11-25's experimental tasks). */
const TASK_STATUSES = new Set([
  'working',
  'input_required',
  'completed',
  'failed',
  'cancelled',
]);

/**
 * The request methods Tasks and the Skills extension add. Tasks has two
 * shapes: the `io.modelcontextprotocol/tasks` extension on 2026-07-28
 * (`tasks/get` carries the outcome, `tasks/update` answers its input
 * requests) and the experimental 2025-11-25 feature (`tasks/result`,
 * `tasks/list`). Both are traced; neither exists on the other's protocol.
 */
export const EXTENSION_REQUEST_METHODS: readonly string[] = [
  MCP_METHODS.TASKS_GET,
  MCP_METHODS.TASKS_UPDATE,
  MCP_METHODS.TASKS_RESULT,
  MCP_METHODS.TASKS_CANCEL,
  MCP_METHODS.TASKS_LIST,
  MCP_METHODS.SKILLS_LIST,
  MCP_METHODS.SKILLS_GET,
  MCP_METHODS.RESOURCES_DIRECTORY_READ,
];

/**
 * The task a result created, when the call ran as a task. 2026-07-28's
 * `CreateTaskResult` is the task itself, marked `resultType: "task"`;
 * 2025-11-25's nests it under `task`.
 */
export function createdTask(result: unknown): UnknownRecord | undefined {
  const flat = asRecord(result);
  if (flat?.resultType === 'task' && asString(flat.taskId) !== undefined)
    return flat;
  // The v2 client consumes `resultType` before handing the result back, and
  // keeps the task's own fields: an id, one of its statuses, a creation time.
  if (
    flat?.resultType === undefined &&
    asString(flat?.taskId) !== undefined &&
    TASK_STATUSES.has(asString(flat?.status) ?? '') &&
    asString(flat?.createdAt) !== undefined
  )
    return flat;
  const nested = asRecord(readProperty(result, 'task'));
  return asString(nested?.taskId) === undefined ? undefined : nested;
}

/**
 * Whether what a task reported is the work failing: a `failed` task (a
 * JSON-RPC error during execution), or a completed one whose result is a
 * tool error. Either way the request that learned it carries the failure,
 * as `tasks/result` does on 2025-11-25.
 */
function taskOutcomeFailed(method: string, result: unknown): boolean {
  if (method === MCP_METHODS.TASKS_RESULT)
    return readProperty(result, 'isError') === true;
  if (method !== MCP_METHODS.TASKS_GET) return false;
  return (
    readProperty(result, 'status') === 'failed' ||
    readProperty(readProperty(result, 'result'), 'isError') === true
  );
}

/** `mcp.task.id` and `mcp.task.status` of a `Task`, as far as it says. */
export function taskAttributes(task: UnknownRecord | undefined): Attributes {
  const attributes: Attributes = {};
  const id = asString(task?.taskId);
  const status = asString(task?.status);
  if (id) attributes[MCP_SEMCONV.TASK_ID] = id;
  if (status) attributes[MCP_SEMCONV.TASK_STATUS] = status;
  return attributes;
}

const ELICITATION_ACTIONS = new Set(['accept', 'decline', 'cancel']);

/** The `action` of each elicitation answer in an `inputResponses` map. */
export function elicitationActions(inputResponses: unknown): string[] {
  const responses = asRecord(inputResponses);
  if (!responses) return [];
  return Object.values(responses)
    .map((response) => asString(readProperty(response, 'action')))
    .filter((action): action is string =>
      ELICITATION_ACTIONS.has(action ?? ''),
    );
}

/** The task a request belongs to, from `_meta`'s related-task entry. */
export function relatedTaskId(meta: unknown): string | undefined {
  return asString(
    readProperty(readProperty(meta, MCP_RELATED_TASK_META_KEY), 'taskId'),
  );
}

/**
 * A `tools/call` the client sent through `request()` ready for a task:
 * `params.task` on 2025-11-25, the `io.modelcontextprotocol/tasks` extension
 * in its per-request capabilities on 2026-07-28. `callTool` is traced on
 * its own; this covers the calls that bypass it to receive a task.
 */
function isTaskAugmentedCall(
  method: string,
  params: UnknownRecord | undefined,
): boolean {
  if (method !== MCP_METHODS.TOOLS_CALL) return false;
  const extensions = readProperty(
    readProperty(params?._meta, MCP_CLIENT_CAPABILITIES_META_KEY),
    'extensions',
  );
  return (
    asRecord(params?.task) !== undefined ||
    asRecord(readProperty(extensions, MCP_TASKS_EXTENSION)) !== undefined
  );
}

/** The span name: the tool for a call, the skill once the server named it. */
function spanName(method: string, params: UnknownRecord | undefined): string {
  const tool = asString(params?.name);
  return method === MCP_METHODS.TOOLS_CALL && tool
    ? `${method} ${tool}`
    : method;
}

/** What a request says about itself, before it is answered. */
function requestAttributes(
  method: string,
  params: UnknownRecord | undefined,
  inputResponses: unknown = params?.inputResponses,
): Attributes {
  const attributes: Attributes = { [MCP_SEMCONV.METHOD_NAME]: method };
  const tool = asString(params?.name);
  if (method === MCP_METHODS.TOOLS_CALL && tool) {
    attributes[MCP_SEMCONV.TOOL_NAME] = tool;
    attributes[MCP_SEMCONV.OPERATION_NAME] = 'execute_tool';
  }
  const taskId = asString(params?.taskId) ?? relatedTaskId(params?._meta);
  if (taskId) attributes[MCP_SEMCONV.TASK_ID] = taskId;
  const actions = elicitationActions(inputResponses);
  if (actions.length > 0) attributes[MCP_SEMCONV.ELICITATION_ACTION] = actions;
  const uri = asString(params?.uri);
  if (uri && method === MCP_METHODS.SKILLS_GET)
    attributes[MCP_SEMCONV.SKILL_URI] = uri;
  if (uri && method === MCP_METHODS.RESOURCES_DIRECTORY_READ)
    attributes[MCP_SEMCONV.RESOURCE_URI] = uri;
  return attributes;
}

/** What the answer adds: a task's status, a count, the skill served. */
function resultAttributes(method: string, result: unknown): Attributes {
  switch (method) {
    case MCP_METHODS.TOOLS_CALL: {
      const task = createdTask(result);
      return task
        ? { ...taskAttributes(task), [MCP_SEMCONV.TASK_AUGMENTED]: true }
        : {};
    }
    case MCP_METHODS.TASKS_GET:
    case MCP_METHODS.TASKS_UPDATE:
    case MCP_METHODS.TASKS_CANCEL: {
      return taskAttributes(asRecord(result));
    }
    case MCP_METHODS.TASKS_LIST: {
      const tasks = readProperty(result, 'tasks');
      return Array.isArray(tasks)
        ? { [MCP_SEMCONV.TASK_COUNT]: tasks.length }
        : {};
    }
    case MCP_METHODS.SKILLS_LIST: {
      const skills = readProperty(result, 'skills');
      return Array.isArray(skills)
        ? { [MCP_SEMCONV.SKILL_COUNT]: skills.length }
        : {};
    }
    case MCP_METHODS.SKILLS_GET: {
      const skill = readProperty(result, 'skill');
      const name = asString(
        readProperty(readProperty(skill, 'frontmatter'), 'name'),
      );
      const uri = asString(readProperty(skill, 'uri'));
      const attributes: Attributes = {};
      if (name) attributes[MCP_SEMCONV.SKILL_NAME] = name;
      if (uri) attributes[MCP_SEMCONV.SKILL_URI] = uri;
      return attributes;
    }
    default: {
      return {};
    }
  }
}

/**
 * The text a failed outcome carries: a failed task's JSON-RPC error message,
 * the tool error inside a completed task's result, or the result's own.
 */
function outcomeFailureText(result: unknown): string {
  if (readProperty(result, 'status') === 'failed')
    return (
      asString(readProperty(readProperty(result, 'error'), 'message')) ?? ''
    );
  const nested = readProperty(result, 'result');
  return extractFailureText(nested === undefined ? result : nested);
}

/** Duration-metric labels: the method, the tool, and the skill once the server named it. Never a task id. */
function metricAttributes(
  method: string,
  params: UnknownRecord | undefined,
  answered: Attributes,
): McpMetricAttributes {
  const labels: McpMetricAttributes = { [MCP_SEMCONV.METHOD_NAME]: method };
  const tool = asString(params?.name);
  if (method === MCP_METHODS.TOOLS_CALL && tool)
    labels[MCP_SEMCONV.TOOL_NAME] = tool;
  const skill = asString(answered[MCP_SEMCONV.SKILL_NAME]);
  if (skill) labels[MCP_SEMCONV.SKILL_NAME] = skill;
  if (answered[MCP_SEMCONV.TASK_AUGMENTED] === true)
    labels[MCP_SEMCONV.TASK_AUGMENTED] = true;
  return labels;
}

/**
 * One span for one request, recording a failure the way every traced path in
 * this package must (see content.ts), and the duration metric either way.
 */
function traceRequest(
  method: string,
  params: UnknownRecord | undefined,
  kind: SpanKind,
  config: ResolvedConfig,
  send: () => unknown,
  inputResponses?: unknown,
): Promise<unknown> {
  const record =
    kind === SpanKind.SERVER
      ? recordServerOperationDuration
      : recordClientOperationDuration;
  return withTracing({ name: spanName(method, params), spanKind: kind })(
    (ctx: TraceContext) => async () => {
      const startTime = performance.now();
      ctx.setAttributes(
        requestAttributes(
          method,
          params,
          inputResponses ?? params?.inputResponses,
        ),
      );
      try {
        const result = await send();
        const answered = resultAttributes(method, result);
        ctx.setAttributes(answered);
        // The skill's name, not the URI the client asked for, goes in the span name.
        const skill = asString(answered[MCP_SEMCONV.SKILL_NAME]);
        if (skill) ctx.updateName(`${method} ${skill}`);
        // A tool error, from the call itself or from the task that ran it.
        const failed =
          readProperty(result, 'isError') === true ||
          taskOutcomeFailed(method, result);
        let errorType: string | undefined;
        let category: string | undefined;
        if (failed) {
          errorType =
            readProperty(result, 'status') === 'failed'
              ? 'task_failed'
              : 'tool_error';
          ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, errorType);
          category = applyFailureGrouping(ctx, outcomeFailureText(result));
          ctx.setStatus({ code: SpanStatusCode.ERROR });
        } else {
          // A call accepted as a task is UNSET: nothing completed yet. Set, not
          // left: an unset status is reported as OK when the span ends.
          ctx.setStatus({
            code:
              answered[MCP_SEMCONV.TASK_AUGMENTED] === true
                ? SpanStatusCode.UNSET
                : SpanStatusCode.OK,
          });
        }
        if (config.enableMetrics) {
          const labels = metricAttributes(method, params, answered);
          if (errorType) labels[MCP_SEMCONV.ERROR_TYPE] = errorType;
          if (category) labels[MCP_SEMCONV.FAILURE_CATEGORY] = category;
          record((performance.now() - startTime) / 1000, labels);
        }
        return result;
      } catch (error) {
        const recorded = recordableError(config, error, method);
        const text = failureTextFromError(error);
        if (config.captureErrors) {
          ctx.recordError(recorded);
          ctx.setAttribute(MCP_SEMCONV.ERROR_TYPE, errorName(error));
          applyFailureGrouping(ctx, text);
        }
        if (config.enableMetrics) {
          const labels = metricAttributes(method, params, {});
          labels[MCP_SEMCONV.ERROR_TYPE] = errorName(error);
          if (text)
            labels[MCP_SEMCONV.FAILURE_CATEGORY] = classifyFailure(text);
          record((performance.now() - startTime) / 1000, labels);
        }
        throw thrownInSpan(error, recorded);
      }
    },
  )().catch(rethrowOriginal);
}

// ── Server ─────────────────────────────────────────────────────────────────

/** v2 `ctx.mcpReq._meta`, v1 `extra._meta`, else the params'. */
function requestMeta(params: UnknownRecord | undefined, extra: unknown) {
  return asRecord(
    readProperty(readProperty(extra, 'mcpReq'), '_meta') ??
      readProperty(extra, '_meta') ??
      params?._meta,
  );
}

/** Trace the `tasks/*` and `skills/*` handlers a server sets, now and later. */
export function traceExtensionHandlers(
  server: unknown,
  config: ResolvedConfig,
): void {
  const owner =
    readProperty(server, '_requestHandlers') instanceof Map
      ? server
      : readProperty(server, 'server');
  patchRequestHandlers(
    owner,
    EXTENSION_REQUEST_METHODS,
    EXTENSION_REQUEST_METHODS,
    (method, raw): RequestHandler =>
      (request, extra) => {
        const params = asRecord(readProperty(request, 'params'));
        const parent = serverParentContext(requestMeta(params, extra));
        return context.with(parent, () =>
          traceRequest(
            method,
            params,
            SpanKind.SERVER,
            config,
            () => raw(request, extra),
            // The SDK lifts a retry's answers off the params onto its context.
            readProperty(readProperty(extra, 'mcpReq'), 'inputResponses'),
          ),
        );
      },
  );
}

// ── Client ─────────────────────────────────────────────────────────────────

/** The client `request` belongs to: it is called with this as `this`. */
interface RequestOwner {
  readonly request?: unknown;
}

/**
 * `client.request` with `tasks/*`, `skills/*` and a task-augmented
 * `tools/call` traced, and trace context in `_meta`. Other methods pass
 * straight through to `request`.
 */
export function traceExtensionClientRequest(
  request: (...args: unknown[]) => unknown,
  target: RequestOwner,
  config: ResolvedConfig,
): (...args: unknown[]) => unknown {
  return (message: unknown, ...rest: unknown[]) => {
    const method = asString(readProperty(message, 'method'));
    const params = asRecord(readProperty(message, 'params')) ?? {};
    if (
      !method ||
      !(
        EXTENSION_REQUEST_METHODS.includes(method) ||
        isTaskAugmentedCall(method, params)
      )
    )
      return request.call(target, message, ...rest);
    return traceRequest(method, params, SpanKind.CLIENT, config, () =>
      request.call(
        target,
        {
          ...asRecord(message),
          // Keys the caller put in `_meta` win.
          params: {
            ...params,
            _meta: { ...injectOtelContextToMeta(), ...asRecord(params._meta) },
          },
        },
        ...rest,
      ),
    );
  };
}
