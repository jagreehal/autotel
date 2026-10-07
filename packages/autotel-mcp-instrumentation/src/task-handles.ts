// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

/**
 * Task handles: what a stateless MCP server cannot see on its own.
 *
 * MCP 2026-07-28 removed the session (SEP-2567), so two calls from one agent
 * doing one task arrive as strangers. The protocol's answer is an explicit
 * handle the agent carries itself: a `session_id` parameter added to every
 * tool, issued on the first call and echoed back on each later one. This
 * module adds it, plus three opt-in neighbours from the same idea:
 *
 * - `agent_id`: a self-chosen identity, so parallel agents on one task stay
 *   apart.
 * - `context`: one sentence of intent per call.
 * - `get_more_tools`: a tool agents call to report a capability they looked
 *   for and did not find.
 *
 * All of it sits on the low-level server's request-handler map, because both
 * SDKs validate tool arguments (and Zod strips unknown keys) before a
 * registered handler runs: an injected parameter has to be read and removed
 * at the request, or the tool span never sees it and a strict schema rejects
 * the call. What is resolved here reaches the tool span through the active
 * OpenTelemetry context, which `server.ts` reads with {@link readTaskFacts}.
 *
 * Off by default: the parameters change the tool schemas agents see.
 */

import { context, createContextKey } from '@opentelemetry/api';

export const SESSION_ID_PARAM = 'session_id';
export const AGENT_ID_PARAM = 'agent_id';
export const INTENT_PARAM = 'context';
export const GET_MORE_TOOLS = 'get_more_tools';
/** Key mirrored into `structuredContent`; also declared on output schemas. */
export const MCP_SESSION_KEY = 'mcp_session';
const START = 'start';
const SESSION_ID = /^ses_[0-9a-f]{32}$/;

// ── Agent-facing copy ──────────────────────────────────────────────────────
// Read by agents, not people: the wording decides whether they echo the
// handle back correctly. Change it only with an eval to back the change.

const SESSION_ID_DESCRIPTION =
  'Session continuity handle, one of two values: the ses_ ID issued for the task underway, or start. This server cannot link your calls between requests on its own, so session continuity travels in this parameter instead. If you were handed a session_id for this task — for example by the agent that spawned you — send that exact value from your first call. Otherwise send start on your first call; the server will issue an opaque correlation ID in the mcp_session field of the result, or in a text block at the start of the result beginning [session_id issued. Then send that exact ses_ value on every later call and hand it to any subagents working the same task. start always begins a new, unrelated task — never send it mid-task. If you send a value this server does not recognize, the result reports it: mcp_session.status of unrecognized, or a text block beginning [session_id unrecognized; re-send the ID issued for this task, or start if none was issued yet. Never invent a ses_ value.';
const SESSION_ID_PATTERN = '^(start|ses_[0-9a-f]{32})$';

const AGENT_ID_DESCRIPTION =
  "Agent identity handle, required on every call including your first. This server cannot tell concurrent agents apart on its own; agent_id is how your calls are attributed to you. It is a self-chosen identifier in the spirit of a User-Agent string — join your model version, your harness name, and a short suffix of 4-6 letters or digits, with '|'. Example: opus-4.80-1m|claude-code|k3n9x. Choose the suffix once at the start of your task and send that same exact value on every call for the entire task; never change it mid-task, and a new task gets a fresh suffix. agent_id identifies exactly one agent and is never inherited: a subagent you spawn generates a new one rather than carrying yours, and if you were spawned by another agent, generate your own rather than reusing your parent's. A call without agent_id cannot be attributed to you.";

export const DEFAULT_INTENT_DESCRIPTION =
  "Explain why you are calling this tool and how it fits into the user's overall goal. This parameter is used for analytics and user intent tracking. YOU MUST provide 15-25 words (count carefully). NEVER use first person ('I', 'we', 'you') - maintain third-person perspective. NEVER include sensitive information such as credentials, passwords, or personal data.";

const ISSUED_TEXT = (id: string) =>
  `[session_id issued — see this tool's session_id parameter description]\nsession_id: ${id}\nThis is the first-call issuance described in this tool's session_id parameter description.`;
const UNRECOGNIZED_TEXT =
  "[session_id unrecognized — see this tool's session_id parameter description]\nThe value sent was not issued by this server. Re-send the session_id issued earlier for this task; if none was issued yet, send start and one will be issued.";

const GET_MORE_TOOLS_DESCRIPTOR = {
  name: GET_MORE_TOOLS,
  description:
    'Check for additional tools whenever your task might benefit from specialized capabilities - even if existing tools could work as a fallback.',
  inputSchema: {
    type: 'object',
    properties: {
      context: {
        type: 'string',
        description:
          'A description of your goal and what kind of tool would help accomplish it.',
      },
    },
    required: ['context'],
  },
  annotations: {
    title: 'Get More Tools',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const GET_MORE_TOOLS_RESULT = {
  content: [
    {
      type: 'text',
      text: 'Unfortunately, we have shown you the full tool list. We have noted your feedback and will work to improve the tool list in the future.',
    },
  ],
};

// ── Config ─────────────────────────────────────────────────────────────────

/** Settles to a stable user id, or nothing. Never delays the tool call. */
export type IdentifyFn = (
  request: unknown,
  ctx: unknown,
) => string | null | undefined | Promise<string | null | undefined>;

export interface TaskHandleOptions {
  /** Ask every agent for a self-chosen `agent_id` (`gen_ai.agent.id`). */
  agentId?: boolean;
  /**
   * Derive the session from something you already have (an auth token hash,
   * your own session id) instead of injecting `session_id`. The returned value
   * becomes `gen_ai.conversation.id`; nothing is added to tool schemas.
   */
  resolveSessionId?: IdentifyFn;
}

export interface TaskHandleConfig {
  sessionHandles?: boolean | TaskHandleOptions;
  captureIntent?: boolean | { description?: string };
  reportMissingTools?: boolean;
  identify?: IdentifyFn;
}

// ── What the tool span reads ───────────────────────────────────────────────

export type SessionSource =
  'minted' | 'supplied' | 'invalid' | 'foreign' | 'hook';

export interface TaskFacts {
  conversationId?: string;
  sessionSource?: SessionSource;
  agentId?: string;
  intent?: string;
  /** What a `get_more_tools` call said was missing. */
  missingTool?: string;
  /** Set once `identify` settles; read when the span ends, never awaited. */
  userId?: string;
}

const TASK_FACTS = createContextKey('autotel-mcp-instrumentation.task-facts');

/** Facts the request-level wrapper resolved for the call now running. */
export function readTaskFacts(): TaskFacts | undefined {
  // SAFETY: only `runWithFacts` writes this key, always with a TaskFacts.
  return context.active().getValue(TASK_FACTS) as TaskFacts | undefined;
}

// ── Pure pieces ────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const newSessionId = (): string =>
  `ses_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;

function handleArg(args: unknown, name: string): string | undefined {
  if (!isRecord(args)) return undefined;
  const value = args[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

interface Plan {
  session: boolean;
  agentId: boolean;
  intent?: string;
  missingTools: boolean;
}

/** Per tool: the parameters we added, so we strip exactly those. */
export interface Injected {
  params: Map<string, Set<string>>;
  /** The server registers its own get_more_tools: leave its calls alone. */
  ownsMissingTool: boolean;
  /**
   * Tools whose output schema now declares `mcp_session`. Only their
   * `structuredContent` may carry it: on any other schema (composed, strict,
   * or none we could extend) the field would be a violation, so the handle
   * is announced in text alone.
   */
  structured: Set<string>;
}

const isComposed = (schema: Json) =>
  'oneOf' in schema || 'allOf' in schema || 'anyOf' in schema;

/**
 * The tool list agents see: our parameters added to each input schema, and
 * `mcp_session` declared on output schemas so a validating client accepts the
 * mirrored field. A parameter the tool already declares is the tool's own and
 * is left alone; a composed schema (oneOf/allOf/anyOf) has no single property
 * bag to extend and is listed unchanged. Pure, so a per-request server can
 * rebuild exactly what a listing instance advertised.
 */
export interface InjectedListing {
  tools: unknown[];
  injected: Injected;
}

export function injectIntoTools(tools: unknown[], plan: Plan): InjectedListing {
  const params = new Map<string, Set<string>>();
  const structured = new Set<string>();
  const ownsMissingTool = tools.some(
    (t) => isRecord(t) && t.name === GET_MORE_TOOLS,
  );
  const listed = [...tools];
  if (plan.missingTools && !ownsMissingTool)
    listed.push(GET_MORE_TOOLS_DESCRIPTOR);

  const out = listed.map((tool) => {
    if (!isRecord(tool) || typeof tool.name !== 'string') return tool;
    const added = new Set<string>();
    params.set(tool.name, added);
    const original = isRecord(tool.inputSchema) ? tool.inputSchema : {};
    if (isComposed(original)) return tool;

    // SAFETY: a tool's inputSchema is JSON Schema, which round-trips JSON.
    const schema = structuredClone(original) as Json;
    schema.type ??= 'object';
    const properties = isRecord(schema.properties) ? schema.properties : {};
    schema.properties = properties;
    const required = Array.isArray(schema.required) ? schema.required : [];
    const add = (name: string, property: Json) => {
      if (name in properties) return;
      properties[name] = property;
      if (!required.includes(name)) required.push(name);
      added.add(name);
    };

    if (plan.session)
      add(SESSION_ID_PARAM, {
        type: 'string',
        description: SESSION_ID_DESCRIPTION,
        pattern: SESSION_ID_PATTERN,
      });
    if (plan.agentId)
      add(AGENT_ID_PARAM, {
        type: 'string',
        description: AGENT_ID_DESCRIPTION,
      });
    // get_more_tools' own `context` is its real parameter, not intent.
    if (plan.intent && tool.name !== GET_MORE_TOOLS)
      add(INTENT_PARAM, { type: 'string', description: plan.intent });

    if (added.size === 0) return tool;
    schema.required = required;
    // Zod emits additionalProperties: false; it would reject what we added.
    if (schema.additionalProperties === false)
      delete schema.additionalProperties;
    const outputSchema = withSessionOutput(tool.outputSchema, plan);
    if (outputSchema !== tool.outputSchema) structured.add(tool.name);
    return { ...tool, inputSchema: schema, outputSchema };
  });
  return { tools: out, injected: { params, ownsMissingTool, structured } };
}

function withSessionOutput(outputSchema: unknown, plan: Plan): unknown {
  if (!plan.session && !plan.agentId) return outputSchema;
  if (!isRecord(outputSchema) || isComposed(outputSchema)) return outputSchema;
  const properties = isRecord(outputSchema.properties)
    ? outputSchema.properties
    : {};
  if (MCP_SESSION_KEY in properties) return outputSchema;
  return {
    ...outputSchema,
    properties: {
      ...properties,
      [MCP_SESSION_KEY]: {
        type: 'object',
        description:
          'Session continuity and agent attribution state for this task. This server cannot link your calls between requests on its own, so session continuity travels here instead.',
        properties: {
          session_id: { type: 'string' },
          agent_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['issued', 'active', 'unrecognized'],
          },
        },
      },
    },
  };
}

/** Resolve the session handle for one call. Stateless: nothing is stored. */
export function resolveSession(
  args: unknown,
  sessionParamIsOurs: boolean,
): { conversationId?: string; sessionSource: SessionSource } {
  if (!sessionParamIsOurs) return { sessionSource: 'foreign' };
  const supplied = handleArg(args, SESSION_ID_PARAM);
  if (supplied === undefined || supplied.toLowerCase() === START)
    return { conversationId: newSessionId(), sessionSource: 'minted' };
  // Adopting a value we did not issue would let any caller merge its calls
  // into someone else's task.
  return SESSION_ID.test(supplied)
    ? { conversationId: supplied, sessionSource: 'supplied' }
    : { sessionSource: 'invalid' };
}

/**
 * Tell the agent its handle: a text block first in `content` (long results
 * get truncated from the end), and `mcp_session` first in `structuredContent`
 * for clients that read only structured output. Never mutates `result`.
 */
export function announce(
  result: unknown,
  facts: TaskFacts,
  structured: boolean,
): unknown {
  // A paused round (input_required) is not the answer; the retry announces.
  if (!isRecord(result) || result.resultType === 'input_required')
    return result;
  let out = result;
  const { sessionSource, conversationId, agentId } = facts;
  const text =
    sessionSource === 'minted' && conversationId
      ? ISSUED_TEXT(conversationId)
      : sessionSource === 'invalid'
        ? UNRECOGNIZED_TEXT
        : undefined;
  if (text && Array.isArray(out.content))
    out = { ...out, content: [{ type: 'text', text }, ...out.content] };

  const sc = out.structuredContent;
  if (structured && isRecord(sc) && !(MCP_SESSION_KEY in sc)) {
    const state: Json = {};
    const ours = sessionSource !== 'foreign' && sessionSource !== 'hook';
    if (ours && conversationId) state.session_id = conversationId;
    if (agentId) state.agent_id = agentId;
    if (ours && sessionSource)
      state.status =
        sessionSource === 'minted'
          ? 'issued'
          : sessionSource === 'invalid'
            ? 'unrecognized'
            : 'active';
    if (Object.keys(state).length > 0)
      out = { ...out, structuredContent: { [MCP_SESSION_KEY]: state, ...sc } };
  }
  return out;
}

// ── Installing on a server ─────────────────────────────────────────────────

type Handler = (request: unknown, ctx: unknown) => unknown;

interface LowLevelServer {
  _requestHandlers: Map<string, Handler>;
  setRequestHandler: (...args: unknown[]) => unknown;
}

function lowLevelOf(server: unknown): LowLevelServer | undefined {
  const candidates = isRecord(server) ? [server.server, server] : [];
  for (const candidate of candidates) {
    if (
      isRecord(candidate) &&
      candidate._requestHandlers instanceof Map &&
      typeof candidate.setRequestHandler === 'function'
    )
      // SAFETY: both members were just checked for the shape used here.
      return candidate as unknown as LowLevelServer;
  }
  return undefined;
}

function planOf(config: TaskHandleConfig): Plan | undefined {
  const handles = config.sessionHandles;
  const options: TaskHandleOptions = isRecord(handles) ? handles : {};
  const plan: Plan = {
    // A resolver replaces the injected parameter: nothing to ask the agent.
    session: Boolean(handles) && !options.resolveSessionId,
    agentId: Boolean(handles) && options.agentId === true,
    intent: config.captureIntent
      ? (isRecord(config.captureIntent) && config.captureIntent.description) ||
        DEFAULT_INTENT_DESCRIPTION
      : undefined,
    missingTools: config.reportMissingTools === true,
  };
  const hooks = options.resolveSessionId || config.identify;
  return plan.session ||
    plan.agentId ||
    plan.intent ||
    plan.missingTools ||
    hooks
    ? plan
    : undefined;
}

/** A hook that may be slow or throw, contained: it can only lose its value. */
function settle(
  hook: IdentifyFn | undefined,
  request: unknown,
  ctx: unknown,
): Promise<string | undefined> {
  const usable = (value: unknown) =>
    typeof value === 'string' && value !== '' ? value : undefined;
  if (!hook) return Promise.resolve(usable(null));
  try {
    return Promise.resolve(hook(request, ctx)).then(usable, () => usable(null));
  } catch {
    return Promise.resolve(usable(null));
  }
}

const installed = new WeakSet<object>();

/**
 * Wrap `tools/list` and `tools/call` on the server's request-handler map, and
 * re-wrap whenever the SDK (re)registers them — McpServer does that lazily, on
 * the first `registerTool`, after this has run.
 *
 * `traceMissingTool` turns a `get_more_tools` call into a tool span like any
 * other, so the report lands in the same trace as the work around it.
 */
export function installTaskHandles(
  server: unknown,
  config: TaskHandleConfig,
  traceMissingTool: (handler: Handler) => Handler,
): void {
  const plan = planOf(config);
  const low = lowLevelOf(server);
  if (!plan || !low || installed.has(low)) return;
  installed.add(low);
  const options: TaskHandleOptions = isRecord(config.sessionHandles)
    ? config.sessionHandles
    : {};

  let originalList: Handler | undefined;
  let listWrapper: Handler | undefined;
  let callWrapper: Handler | undefined;
  let injected: Injected | undefined;

  const missingTool = traceMissingTool(async () => GET_MORE_TOOLS_RESULT);

  /**
   * What was injected into `name`, from this instance's own listing when it
   * has none yet or does not know the tool: a per-request (2026-07-28) server
   * never served the tools/list the agent read, and a tool registered after
   * the last listing is missing from it. Bounded: a hanging list handler must
   * not hang every tool call.
   */
  async function ensureInjected(
    name: string,
    ctx: unknown,
  ): Promise<Injected | undefined> {
    if (injected?.params.has(name) || !originalList) return injected;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const listing = await Promise.race([
        Promise.resolve(
          originalList({ method: 'tools/list', params: {} }, ctx),
        ),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), 5000);
        }),
      ]);
      if (isRecord(listing) && Array.isArray(listing.tools))
        injected = injectIntoTools(listing.tools, plan!).injected;
    } catch {
      // keep what we had: nothing unproven gets stripped
    } finally {
      clearTimeout(timer);
    }
    return injected;
  }

  const arm = () => {
    const handlers = low._requestHandlers;
    const list = handlers.get('tools/list');
    if (list && list !== listWrapper) {
      originalList = list;
      injected = undefined;
      listWrapper = async (request, ctx) => {
        const response = await list(request, ctx);
        if (!isRecord(response) || !Array.isArray(response.tools))
          return response;
        try {
          const result = injectIntoTools(response.tools, plan);
          injected = result.injected;
          return { ...response, tools: result.tools };
        } catch {
          return response; // the server's own listing, unmodified
        }
      };
      handlers.set('tools/list', listWrapper);
    }

    const call = handlers.get('tools/call');
    if (call && call !== callWrapper) {
      callWrapper = async (request, ctx) => {
        const params =
          isRecord(request) && isRecord(request.params)
            ? request.params
            : undefined;
        const name = typeof params?.name === 'string' ? params.name : '';
        const args = params?.arguments;
        const map = await ensureInjected(name, ctx);
        // Strip only what the listing proves we added to this tool. A tool we
        // cannot find was never advertised with our parameters, so every
        // argument it receives is its own.
        const strip = map?.params.get(name) ?? new Set<string>();
        const userId = settle(config.identify, request, ctx);

        const facts: TaskFacts = {};
        if (plan.session) {
          Object.assign(
            facts,
            resolveSession(args, strip.has(SESSION_ID_PARAM)),
          );
        } else if (options.resolveSessionId) {
          // The id is a label, not worth latency: give up quickly.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const hooked = await Promise.race([
            settle(options.resolveSessionId, request, ctx),
            new Promise<undefined>((resolve) => {
              timer = setTimeout(() => resolve(undefined), 200);
            }),
          ]);
          clearTimeout(timer);
          if (hooked) {
            facts.conversationId = hooked;
            facts.sessionSource = 'hook';
          }
        }
        if (plan.agentId && strip.has(AGENT_ID_PARAM))
          facts.agentId = handleArg(args, AGENT_ID_PARAM);
        if (plan.intent && strip.has(INTENT_PARAM))
          facts.intent = handleArg(args, INTENT_PARAM);
        const answerMissing =
          plan.missingTools && name === GET_MORE_TOOLS && !map?.ownsMissingTool;
        if (answerMissing) facts.missingTool = handleArg(args, INTENT_PARAM);
        void userId.then((id) => {
          if (id) facts.userId = id;
        });

        let cleaned = request;
        if (isRecord(request) && params && isRecord(args)) {
          const kept = { ...args };
          for (const key of strip) delete kept[key];
          cleaned = { ...request, params: { ...params, arguments: kept } };
        }

        const run = () =>
          answerMissing ? missingTool({}, ctx) : call(cleaned, ctx);
        const result = await context.with(
          context.active().setValue(TASK_FACTS, facts),
          run,
        );
        return plan.session || plan.agentId
          ? announce(result, facts, map?.structured.has(name) ?? false)
          : result;
      };
      handlers.set('tools/call', callWrapper);
    }
  };

  const original = low.setRequestHandler.bind(low);
  low.setRequestHandler = (...args: unknown[]) => {
    const result = original(...args);
    arm();
    return result;
  };
  arm();
}
