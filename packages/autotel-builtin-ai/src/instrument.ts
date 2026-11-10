import {
  context,
  metrics,
  trace,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Context,
  type Meter,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import {
  describeDownload,
  describeRefusal,
  describeSamplingOption,
} from './describe';
import {
  encodeInput,
  encodeOutput,
  encodeSystemInstructions,
  readTurn,
  fitJson,
  inputSize,
  readChunk,
  toolResponsesIn,
  truncate,
  type ToolCall,
  type ToolResponse,
  type Turn,
} from './messages';
import {
  BUILTIN_AI_APIS,
  SESSION_METHODS,
  isBuiltInApi,
  isCountable,
  type Availability,
  type AwaitedMethod,
  type BuiltInApi,
  type BuiltInApiName,
  type BuiltInSession,
  type CallOptions,
  type CloneOptions,
  type CreateOptions,
  type DownloadMonitor,
  type ModelInput,
  type ModelOutput,
  type SideMethod,
  type StreamChunk,
  type StreamingMethod,
} from './types';

/**
 * OpenTelemetry instrumentation for Chrome's built-in AI APIs.
 *
 * Patches `availability()` and `create()` on each built-in AI global, and the
 * work methods, `clone()` and `destroy()` on every session they hand back.
 * Nothing about your calls changes.
 *
 * Spans carry what the platform actually did rather than what it reports:
 * `availability()` answers differently depending on the options it is passed,
 * `create()` blocks for minutes while a model downloads, a download monitor
 * fires when nothing is downloaded, and a session cannot say how it samples.
 */

export interface InstrumentOptions {
  /**
   * Which built-in AI globals to patch. Defaults to all of them; a global that
   * is absent is skipped either way.
   */
  apis?: readonly BuiltInApiName[];
  /**
   * Record prompts, outputs, tool arguments and results, system instructions
   * and tool definitions. Off by default: what people put into an on-device
   * model is frequently the reason they wanted it on-device.
   */
  capturePayloads?: boolean;
  /**
   * Cap each captured attribute at this many characters. Long strings are cut
   * and trailing entries dropped, so the attribute stays valid JSON. Default
   * 32768.
   */
  maxPayloadLength?: number;
  /** `gen_ai.provider.name`. Default `microsoft.edge` on Edge, else `google.chrome`. */
  providerName?: string;
  /** Default: the global provider's `autotel-builtin-ai` tracer. */
  tracer?: Tracer;
  /**
   * Records `gen_ai.client.operation.duration`,
   * `gen_ai.client.operation.time_to_first_chunk` and
   * `builtin_ai.create.duration`. Default: the global provider's
   * `autotel-builtin-ai` meter, which is a no-op until one is registered.
   */
  meter?: Meter;
}

export interface Instrumentation {
  uninstall(): void;
}

const DEFAULT_MAX_PAYLOAD = 32_768;
/** The GenAI convention's advised boundaries for operation timings, seconds. */
const DURATION_BUCKETS = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48,
  40.96, 81.92,
];
/** Create options `availability()` does not take: content and plumbing. */
const NON_CORE_OPTIONS = new Set([
  'initialPrompts',
  'sharedContext',
  'monitor',
  'signal',
]);

/** Session methods that are not model calls but are worth a span each. */
const SIDE_METHODS = [
  'append',
  'measureContextUsage',
  'measureInputUsage',
] as const;
const ms = (start: number, end = performance.now()) => Math.round(end - start);
/**
 * Epoch milliseconds for explicit span timestamps. The SDK reads a
 * `performance.now()` value through a per-span clock offset, so two spans
 * meant to share a boundary would drift apart; epoch time is taken as is.
 */
const now = () => performance.timeOrigin + performance.now();

/** GenAI operation per method. `detect()` has none. */
const operationOf = (method: string): string | undefined => {
  if (method === 'embed') return 'embeddings';
  if (method === 'detect') return undefined;
  return 'generate_content';
};

interface InstallationState {
  references: number;
  restore(): void;
}

const installations = new WeakMap<typeof globalThis, InstallationState>();

/** Not a security boundary: tells one page load or session from the next. */
const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Read one built-in AI global through a descriptor rather than an assertion
 * on `globalThis`: these are late-bound objects with no ambient declaration.
 */
const readApi = (name: BuiltInApiName): BuiltInApi | undefined => {
  const candidate: BuiltInApi | undefined = Object.getOwnPropertyDescriptor(
    globalThis,
    name,
  )?.value;
  return isBuiltInApi(candidate) ? candidate : undefined;
};

const readWindow = (session: BuiltInSession): number | undefined => {
  const value = session.contextWindow ?? session.inputQuota;
  return isCountable(value) ? value : undefined;
};

const readUsage = (session: BuiltInSession): number | undefined => {
  const value = session.contextUsage ?? session.inputUsage;
  return isCountable(value) ? value : undefined;
};

/** A call the model asked for that the page has not answered yet. */
interface PendingCall extends ToolCall {
  parent: Context;
  /** When the turn that asked for it ended: the earliest the page could act. */
  runnableAt: number;
  turnIndex: number;
}

/**
 * A question answered with tools. Its turns and tool runs are siblings under
 * one `invoke_agent` span, not nested: they run one after another, and the
 * answer arrives on the last turn while a trace is summarised from its root.
 */
interface Exchange {
  context: Context;
  span: Span;
  toolCalls: number;
  turns: number;
  usageBefore: number | undefined;
  /** Calls asked for in this exchange that the page has not answered yet. */
  pending: PendingCall[];
  /** Turns of this exchange still running. */
  inFlight: number;
  closed: boolean;
}

interface SessionState {
  api: BuiltInApiName;
  conversationId: string;
  sessionId: string;
  parentSessionId?: string;
  turnIndex: number;
  /** Set once the session has compacted its context; sticky. */
  compacted: boolean;
  /**
   * An overflow fired and no call has reported it yet. The first call to
   * finish takes it: the one in flight when it fired, or the next one.
   */
  pendingOverflow: boolean;
  /** Declared tools by name, so a tool span can carry its description. */
  tools: Map<string, string | undefined>;
  /**
   * The exchange a tool response on this session continues. A clone shares
   * its parent's, so the page can answer a call on either.
   */
  exchange?: Exchange | undefined;
}

export function instrumentBuiltInAI(
  options: InstrumentOptions = {},
): Instrumentation {
  const root = globalThis;
  const existing = installations.get(root);
  if (existing) {
    existing.references += 1;
    return handle(root, existing);
  }

  const tracer = options.tracer ?? trace.getTracer('autotel-builtin-ai');
  const meter = options.meter ?? metrics.getMeter('autotel-builtin-ai');
  const operationDuration = meter.createHistogram(
    'gen_ai.client.operation.duration',
    {
      unit: 's',
      description: 'Duration of a built-in AI model call',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS },
    },
  );
  const timeToFirstChunk = meter.createHistogram(
    'gen_ai.client.operation.time_to_first_chunk',
    {
      unit: 's',
      description: 'Time to the first streamed chunk of a built-in AI call',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS },
    },
  );
  // Separate from operation duration: a create() that downloads a model
  // blocks for minutes, and averaging that into model calls would hide both.
  const createDuration = meter.createHistogram('builtin_ai.create.duration', {
    unit: 's',
    description: 'How long a built-in AI create() blocked',
    advice: { explicitBucketBoundaries: DURATION_BUCKETS },
  });
  /** Per in-flight call: when it started, and its first chunk if streamed. */
  const timings = new WeakMap<
    Span,
    { method: string; start: number; ttfc?: number }
  >();
  const capture = options.capturePayloads ?? false;
  const max = options.maxPayloadLength ?? DEFAULT_MAX_PAYLOAD;
  const provider = options.providerName ?? detectProvider();
  const wanted = options.apis ?? BUILTIN_AI_APIS;
  const installationId = newId();

  /**
   * The last answer each API gave, from the caller's own `availability()`
   * calls. Recorded rather than probed: asking the platform again before every
   * `create()` would make installing telemetry add a call the application did
   * not make.
   */
  const lastAvailability = new Map<string, Availability>();

  /**
   * A stable description of every option that can affect availability: the
   * API's *core* create options. `availability()` takes only those — Chrome's
   * own error names the type, `…CreateCoreOptions` — so the content a page
   * adds at create (`initialPrompts`, `sharedContext`) and the plumbing
   * (`monitor`, `signal`) are left out. Including them made every real
   * `create()` look like a question `availability()` was never asked: a page
   * checks with its options and creates with its prompts. Keys are sorted so
   * equivalent options match whatever their order.
   */
  const coreOptionsOnly = (_key: string, value: CreateOptions) => {
    // Plain objects get their keys sorted and the non-core ones dropped;
    // arrays and primitives pass through. Functions vanish on their own:
    // JSON has no representation for them.
    if (!(value instanceof Object) || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !NON_CORE_OPTIONS.has(key))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  };

  // Exotic option values (cycles, throwing getters, BigInts) must not make
  // instrumentation reject a platform call. Undescribable options still match
  // by identity; a different object stays undecidable.
  const opaqueOptionIds = new WeakMap<CreateOptions, number>();
  let nextOpaqueOptionId = 1;

  // Keyed by option values too: `availability()` evaluates them rather than
  // model readiness (see `guardWouldRefuse`).
  const availabilityKey = (
    api: BuiltInApiName,
    callOptions: CreateOptions | undefined,
  ): string => {
    try {
      return `${api}:${JSON.stringify(callOptions, coreOptionsOnly)}`;
    } catch {
      if (callOptions === undefined) return `${api}:undefined`;
      let id = opaqueOptionIds.get(callOptions);
      if (id === undefined) {
        id = nextOpaqueOptionId++;
        opaqueOptionIds.set(callOptions, id);
      }
      return `${api}:opaque:${id}`;
    }
  };

  const restorers: Array<() => void> = [];
  /**
   * Off once the installation is uninstalled. Session methods are patched
   * without a restore entry, so a session the page drops is collected with
   * its wrappers; after uninstall each wrapper calls the platform directly.
   */
  let live = true;

  const patch = <T extends object, K extends keyof T & string>(
    target: T,
    property: K,
    value: T[K],
  ): void => {
    Object.defineProperty(target, property, {
      value,
      configurable: true,
      writable: true,
    });
  };

  const replace = <T extends object, K extends keyof T & string>(
    target: T,
    property: K,
    value: T[K],
  ): void => {
    const own = Object.getOwnPropertyDescriptor(target, property);
    Object.defineProperty(target, property, {
      value,
      configurable: true,
      writable: true,
    });
    restorers.push(() => {
      if (own) Object.defineProperty(target, property, own);
      else Reflect.deleteProperty(target, property);
    });
  };

  const hardware = readHardware();
  const base = (api: BuiltInApiName): Attributes => ({
    'builtin_ai.installation.id': installationId,
    'builtin_ai.api': api,
    ...hardware,
  });

  /**
   * The GenAI operation and its provider, always together. A GenAI-aware
   * backend reads `gen_ai.provider.name` as "this span is a model call", so a
   * clone, a destroy or an availability check leaves it off.
   */
  const operation = (name: string): Attributes => ({
    'gen_ai.operation.name': name,
    'gen_ai.provider.name': provider,
  });

  const identity = (state: SessionState): Attributes => {
    const attributes: Attributes = {
      ...base(state.api),
      'gen_ai.conversation.id': state.conversationId,
      'builtin_ai.session.id': state.sessionId,
    };
    if (state.parentSessionId) {
      attributes['builtin_ai.session.parent_id'] = state.parentSessionId;
    }
    return attributes;
  };

  /**
   * Record a rejection. The refusal kind is platform text classified into a
   * fixed set, so it is recorded whether or not payload capture is on; the
   * message itself only with capture.
   */
  const fail = (span: Span, error: Error): void => {
    span.setAttribute('error.type', error.name);
    const refusal = describeRefusal(error.message, error.name);
    if (refusal) span.setAttribute('builtin_ai.create.refusal', refusal);
    if (capture) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: truncate(error.message, max),
      });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  };

  const contextAttributes = (
    window: number | undefined,
    before: number | undefined,
    after: number | undefined,
  ): Attributes => {
    const attributes: Attributes = {};
    if (isCountable(before))
      attributes['builtin_ai.context.usage_before'] = before;
    if (!isCountable(after)) return attributes;
    attributes['builtin_ai.context.usage_after'] = after;
    if (isCountable(before))
      attributes['builtin_ai.context.usage_delta'] = after - before;
    if (isCountable(window) && window > 0) {
      attributes['builtin_ai.context.remaining'] = window - after;
      attributes['builtin_ai.context.utilization'] = after / window;
    }
    return attributes;
  };

  // ------------------------------------------------------------ exchanges

  /** The exchange a tool response on this session would continue. */
  const openExchange = (state: SessionState): Exchange | undefined =>
    state.exchange && !state.exchange.closed ? state.exchange : undefined;

  /** Ends an exchange once; abandoned when no answering turn is given. */
  const closeExchange = (
    state: SessionState,
    exchange: Exchange | undefined,
    session: BuiltInSession,
    at: number,
    answer?: Turn,
  ): void => {
    if (!exchange || exchange.closed) return;
    exchange.closed = true;
    exchange.pending = [];
    if (state.exchange === exchange) state.exchange = undefined;
    const span = exchange.span;
    span.setAttributes({
      'builtin_ai.exchange.turns': exchange.turns,
      'builtin_ai.exchange.tool_calls': exchange.toolCalls,
      ...contextAttributes(
        readWindow(session),
        exchange.usageBefore,
        readUsage(session),
      ),
    });
    if (answer) {
      span.setAttribute('gen_ai.response.finish_reasons', ['stop']);
      if (capture) {
        const output = encodeOutput(answer, 'stop', max);
        if (output) span.setAttribute('gen_ai.output.messages', output);
      }
    } else {
      span.setAttribute('builtin_ai.exchange.abandoned', true);
    }
    span.end(at);
  };

  /**
   * One `execute_tool` span per response. The tool runs in page code this
   * instrumentation never sees, so the span is rebuilt from outside: from the
   * end of the turn that asked for it to the moment the page answered.
   */
  const emitToolSpans = (
    state: SessionState,
    exchange: Exchange | undefined,
    responses: readonly ToolResponse[],
    at: number,
    fallbackParent: Context,
  ): void => {
    for (const response of responses) {
      // Matched by `callId` only: borrowing a call by name would hand this
      // response another call's arguments and clock.
      const index = response.id
        ? (exchange?.pending.findIndex((call) => call.id === response.id) ?? -1)
        : -1;
      const call =
        index === -1 ? undefined : exchange?.pending.splice(index, 1)[0];
      const name = response.name || call?.name || 'unknown';
      const attributes: Attributes = {
        ...identity(state),
        ...operation('execute_tool'),
        'gen_ai.tool.name': name,
        'gen_ai.tool.type': 'function',
      };
      if (response.id) attributes['gen_ai.tool.call.id'] = response.id;
      if (call) attributes['builtin_ai.turn.index'] = call.turnIndex;
      const description = state.tools.get(name);
      // Part of what the model was prompted with, so it follows the same
      // gate as the definitions on the create span.
      if (capture && description) {
        attributes['gen_ai.tool.description'] = description;
      }
      if (capture && call?.arguments !== undefined) {
        const json = fitJson(call.arguments, max);
        if (json) attributes['gen_ai.tool.call.arguments'] = json;
      }
      if (capture && response.result !== undefined) {
        const json = fitJson(response.result, max);
        if (json) attributes['gen_ai.tool.call.result'] = json;
      }
      const span = tracer.startSpan(
        `execute_tool ${name}`,
        {
          kind: SpanKind.INTERNAL,
          attributes,
          startTime: call?.runnableAt ?? at,
        },
        call?.parent ?? fallbackParent,
      );
      if (response.error !== undefined) {
        span.setAttribute('error.type', 'ToolError');
        span.setStatus(
          capture
            ? {
                code: SpanStatusCode.ERROR,
                message: truncate(response.error, max),
              }
            : { code: SpanStatusCode.ERROR },
        );
      }
      span.end(at);
    }
  };

  interface TurnStart {
    at: number;
    /** The exchange this turn belongs to, on a session with tools. */
    exchange: Exchange | undefined;
    parent: Context;
    responses: readonly ToolResponse[];
  }

  /**
   * Decide where a call hangs. A turn carrying tool responses continues the
   * exchange in flight; anything else is a new question, which ends whatever
   * came before and, on a session with tools, opens its own exchange.
   */
  const beginTurn = (
    state: SessionState,
    session: BuiltInSession,
    input: ModelInput,
  ): TurnStart => {
    const at = now();
    const responses = toolResponsesIn(input);
    const open = openExchange(state);
    const continuing = responses.length > 0 && open !== undefined;
    if (!continuing && open) {
      // A new question. The exchange before it ends here, unless one of its
      // turns is still running: that turn ends it when it finishes.
      if (open.inFlight === 0) closeExchange(state, open, session, at);
      else state.exchange = undefined;
    }

    let exchange = continuing ? open : undefined;
    if (!exchange && state.tools.size > 0) {
      const attributes: Attributes = {
        ...identity(state),
        ...operation('invoke_agent'),
        'builtin_ai.tool.names': [...state.tools.keys()],
      };
      if (capture) {
        const messages = encodeInput(input, max);
        if (messages) attributes['gen_ai.input.messages'] = messages;
      }
      const span = tracer.startSpan(
        `invoke_agent ${state.api}`,
        { kind: SpanKind.INTERNAL, attributes, startTime: at },
        context.active(),
      );
      exchange = {
        context: trace.setSpan(context.active(), span),
        span,
        toolCalls: 0,
        turns: 0,
        usageBefore: readUsage(session),
        pending: [],
        inFlight: 0,
        closed: false,
      };
      state.exchange = exchange;
    }

    const parent = exchange?.context ?? context.active();
    // Emitted before the turn opens, sharing its start, so a tool run sits
    // beside the turns rather than inside the one being told its result.
    if (responses.length > 0) {
      emitToolSpans(state, exchange, responses, at, parent);
    }
    if (exchange) {
      exchange.turns += 1;
      exchange.inFlight += 1;
    }
    return { at, exchange, parent, responses };
  };

  const startCall = (
    state: SessionState,
    session: BuiltInSession,
    method: string,
    input: ModelInput,
    callOptions: CallOptions | undefined,
    streaming: boolean,
    turn: TurnStart,
  ): Span => {
    state.turnIndex += 1;
    const attributes: Attributes = {
      ...identity(state),
      'builtin_ai.method': method,
      'builtin_ai.streaming': streaming,
      'builtin_ai.turn.index': state.turnIndex,
    };
    const operationName = operationOf(method);
    if (operationName) Object.assign(attributes, operation(operationName));
    if (streaming) attributes['gen_ai.request.stream'] = true;
    if (callOptions?.responseConstraint !== undefined) {
      attributes['gen_ai.output.type'] = 'json';
    }
    const size = inputSize(input);
    if (size.chars !== undefined)
      attributes['builtin_ai.input.chars'] = size.chars;
    if (size.parts !== undefined)
      attributes['builtin_ai.input.parts'] = size.parts;
    if (turn.responses.length > 0) {
      attributes['builtin_ai.turn.continuation'] = true;
      attributes['builtin_ai.tool.response_count'] = turn.responses.length;
    }
    const usage = readUsage(session);
    if (isCountable(usage))
      attributes['builtin_ai.context.usage_before'] = usage;
    // The only model identity these APIs expose. Canary 159's one space is
    // `embeddinggemma-300m`: named for the model that produces it, so it is
    // the model as far as a reader can tell. Vectors compare only within one
    // space.
    if (session.embeddingSpace) {
      attributes['builtin_ai.embedding.space'] = session.embeddingSpace;
      attributes['gen_ai.request.model'] = session.embeddingSpace;
    }
    if (capture) {
      const messages = encodeInput(input, max);
      if (messages) attributes['gen_ai.input.messages'] = messages;
    }
    const span = tracer.startSpan(
      `${method} ${state.api}`,
      { kind: SpanKind.INTERNAL, attributes, startTime: turn.at },
      turn.parent,
    );
    timings.set(span, { method, start: turn.at });
    return span;
  };

  type Outcome =
    | { kind: 'done'; turn: Turn }
    | { kind: 'failed'; error: Error; partial?: Turn }
    | { kind: 'cancelled'; partial: Turn };

  const finishCall = (
    state: SessionState,
    session: BuiltInSession,
    span: Span,
    usageBefore: number | undefined,
    exchange: Exchange | undefined,
    outcome: Outcome,
  ): void => {
    const at = now();
    const usageAfter = readUsage(session);
    span.setAttributes(
      contextAttributes(readWindow(session), usageBefore, usageAfter),
    );

    // A usage drop across the call means the model compacted its context,
    // whether or not an overflow event fired.
    const dropped =
      isCountable(usageBefore) &&
      isCountable(usageAfter) &&
      usageAfter < usageBefore;
    if (state.pendingOverflow || dropped) {
      state.pendingOverflow = false;
      state.compacted = true;
      span.addEvent(
        'builtin_ai.context.overflow',
        contextAttributes(undefined, usageBefore, usageAfter),
      );
    }
    if (state.compacted)
      span.setAttribute('builtin_ai.context.compacted', true);

    const turn = outcome.kind === 'done' ? outcome.turn : outcome.partial;
    if (turn) {
      // A tool session's text answer arrives in content parts; a turn that
      // only asks for a tool has no text.
      if (turn.text || (turn.textOnly && turn.toolCalls.length === 0)) {
        span.setAttribute('builtin_ai.output.chars', turn.text.length);
      }
      if (turn.toolCalls.length > 0) {
        span.setAttribute('builtin_ai.tool.call_count', turn.toolCalls.length);
        span.setAttribute(
          'builtin_ai.tool.call_names',
          turn.toolCalls.map((call) => call.name),
        );
      }
    }

    let finishReason: string | undefined;
    if (outcome.kind === 'done') {
      finishReason = outcome.turn.toolCalls.length > 0 ? 'tool_call' : 'stop';
    } else if (outcome.kind === 'failed') {
      finishReason = failureFinishReason(outcome.error);
      fail(span, outcome.error);
    } else {
      span.setAttribute('builtin_ai.stream.cancelled', true);
    }
    if (finishReason)
      span.setAttribute('gen_ai.response.finish_reasons', [finishReason]);

    const timing = timings.get(span);
    if (timing) {
      const method = timing.method;
      const metricAttributes: Attributes = {
        'gen_ai.provider.name': provider,
        'builtin_ai.api': state.api,
        'builtin_ai.method': method,
      };
      const operation = operationOf(method);
      if (operation) metricAttributes['gen_ai.operation.name'] = operation;
      if (outcome.kind === 'failed') {
        metricAttributes['error.type'] = outcome.error.name;
      }
      operationDuration.record((at - timing.start) / 1000, metricAttributes);
      if (isCountable(timing.ttfc)) {
        timeToFirstChunk.record(timing.ttfc, metricAttributes);
      }
    }
    if (
      capture &&
      turn &&
      finishReason &&
      (turn.text || turn.toolCalls.length > 0)
    ) {
      const messages = encodeOutput(turn, finishReason, max);
      if (messages) span.setAttribute('gen_ai.output.messages', messages);
    }
    span.end(at);

    if (exchange) exchange.inFlight -= 1;

    // Calls asked for here stay pending until the page answers them, from the
    // moment this turn ended: the earliest the page could act on them. Only
    // the exchange the page can still continue takes them; one a newer
    // question has replaced ends here.
    const asked = outcome.kind === 'done' ? outcome.turn.toolCalls : [];
    if (asked.length > 0 && exchange && openExchange(state) === exchange) {
      exchange.toolCalls += asked.length;
      for (const call of asked) {
        exchange.pending.push({
          ...call,
          parent: exchange.context,
          runnableAt: at,
          turnIndex: state.turnIndex,
        });
      }
      return;
    }
    // A turn that asked for nothing is the answer; one that failed or was
    // cancelled ends the exchange without one.
    closeExchange(
      state,
      exchange,
      session,
      at,
      outcome.kind === 'done' && asked.length === 0 ? outcome.turn : undefined,
    );
  };

  // ------------------------------------------------------------ session work

  const wrapAwaited = (
    state: SessionState,
    session: BuiltInSession,
    method: string,
    original: AwaitedMethod,
  ): AwaitedMethod =>
    async function instrumented(input, ...rest): Promise<ModelOutput> {
      if (!live) return original.call(session, input, ...rest);
      const turn = beginTurn(state, session, input);
      const usageBefore = readUsage(session);
      const span = startCall(
        state,
        session,
        method,
        input,
        rest[0],
        false,
        turn,
      );
      try {
        const output = await context.with(
          trace.setSpan(turn.parent, span),
          () => original.call(session, input, ...rest),
        );
        finishCall(state, session, span, usageBefore, turn.exchange, {
          kind: 'done',
          turn: readTurn(output),
        });
        return output;
      } catch (caught) {
        finishCall(state, session, span, usageBefore, turn.exchange, {
          kind: 'failed',
          error: caught instanceof Error ? caught : new Error(String(caught)),
        });
        throw caught;
      }
    };

  const wrapStreaming = (
    state: SessionState,
    session: BuiltInSession,
    method: string,
    original: StreamingMethod,
  ): StreamingMethod =>
    function instrumented(input, ...rest): ReadableStream<StreamChunk> {
      if (!live) return original.call(session, input, ...rest);
      const turn = beginTurn(state, session, input);
      const usageBefore = readUsage(session);
      const span = startCall(
        state,
        session,
        method,
        input,
        rest[0],
        true,
        turn,
      );
      let source: ReadableStream<StreamChunk>;
      try {
        source = context.with(trace.setSpan(turn.parent, span), () =>
          original.call(session, input, ...rest),
        );
      } catch (caught) {
        finishCall(state, session, span, usageBefore, turn.exchange, {
          kind: 'failed',
          error: caught instanceof Error ? caught : new Error(String(caught)),
        });
        throw caught;
      }
      if (!(source instanceof ReadableStream)) {
        finishCall(state, session, span, usageBefore, turn.exchange, {
          kind: 'done',
          turn: { text: '', textOnly: false, toolCalls: [] },
        });
        return source;
      }

      const started = performance.now();
      let firstChunkAt: number | undefined;
      let chunks = 0;
      // Text-only until a tool call arrives, as a prompt() turn would be.
      const partial: Turn = { text: '', textOnly: true, toolCalls: [] };
      const record = () => {
        span.setAttribute('builtin_ai.stream.chunks', chunks);
        span.setAttribute('builtin_ai.stream.chars', partial.text.length);
        if (isCountable(firstChunkAt)) {
          const ttfc = (firstChunkAt - started) / 1000;
          span.setAttribute('gen_ai.response.time_to_first_chunk', ttfc);
          const timing = timings.get(span);
          if (timing) timing.ttfc = ttfc;
        }
      };

      // Settled exactly once, whichever of end, error or cancel comes first.
      let settled = false;
      const settle = (outcome: Outcome): void => {
        if (settled) return;
        settled = true;
        record();
        finishCall(state, session, span, usageBefore, turn.exchange, outcome);
      };

      // The source is read directly so that its end, an error and a cancel
      // all arrive here: Chrome (Canary 159) does not run a TransformStream
      // transformer's `cancel` hook. The caller receives the platform's
      // chunks untouched, one per pull: text as strings, each tool call as
      // its own structured chunk.
      const reader = source.getReader();
      return new ReadableStream<StreamChunk>({
        async pull(controller) {
          let next: ReadableStreamReadResult<StreamChunk>;
          try {
            next = await reader.read();
          } catch (caught) {
            settle({
              kind: 'failed',
              error:
                caught instanceof Error ? caught : new Error(String(caught)),
              partial,
            });
            controller.error(caught);
            return;
          }
          if (next.done) {
            settle({ kind: 'done', turn: partial });
            controller.close();
            return;
          }
          const chunk = next.value;
          firstChunkAt ??= performance.now();
          chunks += 1;
          const read = readChunk(chunk);
          if (read.text !== undefined) partial.text += read.text;
          if (read.call) partial.toolCalls.push(read.call);
          controller.enqueue(chunk);
        },
        // The caller stopped reading: cancel the source too, so the model
        // stops generating.
        cancel(reason) {
          settle({ kind: 'cancelled', partial });
          return reader.cancel(reason);
        },
      });
    };

  /**
   * `append()` adds to the context without asking for an answer, and the
   * `measure*Usage()` pair price an input without spending it. Neither is a
   * model turn, so neither touches the exchange; both move or read the
   * context, which is what their spans record.
   */
  const wrapSide = (
    state: SessionState,
    session: BuiltInSession,
    method: (typeof SIDE_METHODS)[number],
    original: SideMethod,
  ): SideMethod =>
    async function instrumented(input, ...rest): Promise<number | undefined> {
      if (!live) return original.call(session, input, ...rest);
      const usageBefore = readUsage(session);
      const attributes: Attributes = {
        ...identity(state),
        'builtin_ai.method': method,
      };
      const size = inputSize(input);
      if (size.chars !== undefined)
        attributes['builtin_ai.input.chars'] = size.chars;
      if (size.parts !== undefined)
        attributes['builtin_ai.input.parts'] = size.parts;
      if (capture && method === 'append') {
        const messages = encodeInput(input, max);
        if (messages) attributes['gen_ai.input.messages'] = messages;
      }
      const parent = state.exchange?.context ?? context.active();
      const span = tracer.startSpan(
        `${method} ${state.api}`,
        { kind: SpanKind.INTERNAL, attributes },
        parent,
      );
      try {
        const result = await context.with(trace.setSpan(parent, span), () =>
          original.call(session, input, ...rest),
        );
        if (method === 'append') {
          span.setAttributes(
            contextAttributes(
              readWindow(session),
              usageBefore,
              readUsage(session),
            ),
          );
        } else if (isCountable(result)) {
          span.setAttribute('builtin_ai.context.measured', result);
          const window = readWindow(session);
          // Whether the input would fit: the question these calls exist to
          // answer before a prompt overflows the session.
          if (isCountable(window) && isCountable(usageBefore)) {
            span.setAttribute(
              'builtin_ai.context.would_overflow',
              usageBefore + result > window,
            );
          }
        }
        return result;
      } catch (caught) {
        fail(
          span,
          caught instanceof Error ? caught : new Error(String(caught)),
        );
        throw caught;
      } finally {
        span.end();
      }
    };

  /**
   * Wrap the work methods, `clone()` and `destroy()` on one session.
   *
   * A clone is a fresh session object with its own methods; left alone a
   * conversation forked per turn would fall silent after its first fork. It
   * keeps the conversation id and gets its own session id.
   */
  const instrumentSession = (
    session: BuiltInSession,
    state: SessionState,
  ): BuiltInSession => {
    for (const method of SESSION_METHODS[state.api]) {
      const original = session[method];
      if (!(original instanceof Function)) continue;
      // SAFETY: SESSION_METHODS names a `*Streaming` method exactly when the
      // platform returns a stream from it, which is what `BuiltInSession`
      // declares; the union read above only lost which half this name is.
      patch(
        session,
        method,
        method.endsWith('Streaming')
          ? wrapStreaming(state, session, method, original as StreamingMethod)
          : wrapAwaited(state, session, method, original as AwaitedMethod),
      );
    }

    for (const method of SIDE_METHODS) {
      const original = session[method];
      if (!(original instanceof Function)) continue;
      patch(session, method, wrapSide(state, session, method, original));
    }

    const onOverflow = () => {
      if (!live) return;
      state.compacted = true;
      state.pendingOverflow = true;
    };
    if (session.addEventListener instanceof Function) {
      for (const type of ['contextoverflow', 'quotaoverflow']) {
        session.addEventListener(type, onOverflow);
      }
    }

    const clone = session.clone;
    if (clone instanceof Function) {
      patch(
        session,
        'clone',
        async function instrumentedClone(options?: CloneOptions) {
          if (!live) return clone.call(session, options);
          const span = tracer.startSpan(`clone ${state.api}`, {
            kind: SpanKind.INTERNAL,
            attributes: identity(state),
          });
          try {
            const cloned = await context.with(
              trace.setSpan(context.active(), span),
              () => clone.call(session, options),
            );
            // The clone shares an open exchange, so the page can send a
            // tool response on either session.
            const child: SessionState = {
              ...newState(state.api, state.conversationId, state.sessionId),
              tools: new Map(state.tools),
              exchange: openExchange(state),
            };
            span.setAttribute('builtin_ai.clone.session_id', child.sessionId);
            return instrumentSession(cloned, child);
          } catch (caught) {
            fail(
              span,
              caught instanceof Error ? caught : new Error(String(caught)),
            );
            throw caught;
          } finally {
            span.end();
          }
        },
      );
    }

    const destroy = session.destroy;
    if (destroy instanceof Function) {
      patch(session, 'destroy', function instrumentedDestroy() {
        if (!live) return destroy.call(session);
        // Destroyed mid-exchange: no tool results will follow.
        closeExchange(state, openExchange(state), session, now());
        const span = tracer.startSpan(`destroy ${state.api}`, {
          kind: SpanKind.INTERNAL,
          attributes: identity(state),
        });
        try {
          destroy.call(session);
        } catch (caught) {
          fail(
            span,
            caught instanceof Error ? caught : new Error(String(caught)),
          );
          throw caught;
        } finally {
          span.end();
        }
      });
    }

    return session;
  };

  // ---------------------------------------------------------------- statics

  const wrapAvailability = (
    api: BuiltInApiName,
    original: BuiltInApi['availability'],
    target: BuiltInApi,
  ): BuiltInApi['availability'] =>
    async function instrumented(
      callOptions?: CreateOptions,
    ): Promise<Availability> {
      const span = tracer.startSpan('builtin_ai.availability', {
        kind: SpanKind.INTERNAL,
        attributes: {
          ...base(api),
          // Whether the guard passed options: on Canary 154 a bare call
          // answered for default sampling options (see `guardWouldRefuse`).
          'builtin_ai.availability.options_supplied': callOptions !== undefined,
          'builtin_ai.availability.sampling_option':
            describeSamplingOption(callOptions),
        },
      });
      try {
        const answer = await context.with(
          trace.setSpan(context.active(), span),
          () => original.call(target, callOptions),
        );
        span.setAttribute('builtin_ai.availability.answer', answer);
        lastAvailability.set(availabilityKey(api, callOptions), answer);
        return answer;
      } catch (caught) {
        fail(
          span,
          caught instanceof Error ? caught : new Error(String(caught)),
        );
        throw caught;
      } finally {
        span.end();
      }
    };

  const createAttributes = (
    state: SessionState,
    callOptions: CreateOptions | undefined,
  ): Attributes => {
    const attributes: Attributes = {
      ...identity(state),
      ...operation('create_session'),
      'builtin_ai.create.sampling_option': describeSamplingOption(callOptions),
      ...userActivation(),
    };
    if (callOptions?.embeddingSpace) {
      attributes['builtin_ai.embedding.space'] = callOptions.embeddingSpace;
      attributes['gen_ai.request.model'] = callOptions.embeddingSpace;
    }
    const tools = callOptions?.tools ?? [];
    if (tools.length > 0) {
      attributes['builtin_ai.tool.names'] = tools.map((tool) => tool.name);
      if (capture) {
        const json = fitJson(
          tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description ?? null,
            parameters: tool.inputSchema ?? null,
          })),
          max,
        );
        if (json) attributes['gen_ai.tool.definitions'] = json;
      }
    }
    // Recorded whether or not it was given: a LanguageModel session with no
    // output language is one Chrome warns degrades quality and safety
    // attestation, so its absence is the fact worth querying.
    const languages = new Set<string>();
    if (callOptions?.outputLanguage) languages.add(callOptions.outputLanguage);
    for (const entry of callOptions?.expectedOutputs ?? []) {
      if (entry.type === 'text') {
        for (const language of entry.languages ?? []) languages.add(language);
      }
    }
    if (languages.size > 0) {
      attributes['builtin_ai.request.output_languages'] = [...languages];
    }
    for (const key of ['expectedInputs', 'expectedOutputs'] as const) {
      const value = callOptions?.[key];
      const json = value && value.length > 0 ? fitJson(value, max) : undefined;
      if (json) {
        attributes[
          `builtin_ai.session.${key === 'expectedInputs' ? 'expected_inputs' : 'expected_outputs'}`
        ] = json;
      }
    }
    if (capture) {
      const instructions = encodeSystemInstructions(
        callOptions?.initialPrompts,
        max,
      );
      if (instructions) attributes['gen_ai.system_instructions'] = instructions;
    }
    return attributes;
  };

  const wrapCreate = (
    api: BuiltInApiName,
    original: BuiltInApi['create'],
    target: BuiltInApi,
  ): BuiltInApi['create'] =>
    async function instrumented(
      callOptions?: CreateOptions,
    ): Promise<BuiltInSession> {
      const conversationId = newId();
      const state: SessionState = {
        ...newState(api, conversationId),
        tools: new Map(
          (callOptions?.tools ?? []).map((tool) => [
            tool.name,
            tool.description,
          ]),
        ),
      };
      const span = tracer.startSpan(`create_session ${api}`, {
        kind: SpanKind.INTERNAL,
        attributes: createAttributes(state, callOptions),
      });

      const key = availabilityKey(api, callOptions);
      const before = lastAvailability.get(key);
      if (before) span.setAttribute('builtin_ai.availability.before', before);

      const loaded: number[] = [];
      let firstEventAt: number | undefined;
      let lastEventAt: number | undefined;
      const observing: CreateOptions = {
        ...callOptions,
        monitor(monitor: DownloadMonitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            firstEventAt ??= performance.now();
            lastEventAt = performance.now();
            loaded.push(event.loaded);
          });
          // The caller's monitor still runs, second, so a progress bar wired
          // to it behaves exactly as it did.
          callOptions?.monitor?.(monitor);
        },
      };

      const started = performance.now();
      try {
        const session = await context.with(
          trace.setSpan(context.active(), span),
          () => original.call(target, observing),
        );
        span.setAttribute('builtin_ai.create.ms', ms(started));
        const downloadReal = describeDownload(before, loaded).real;
        const createMetric: Attributes = {
          'gen_ai.provider.name': provider,
          'builtin_ai.api': api,
        };
        if (downloadReal !== undefined) {
          createMetric['builtin_ai.download.real'] = downloadReal;
        }
        createDuration.record(
          (performance.now() - started) / 1000,
          createMetric,
        );
        // A create() that returned is proof the model is here now; without
        // this every later warm create() would report another real download.
        lastAvailability.set(key, 'available');

        const download = describeDownload(before, loaded);
        span.setAttribute('builtin_ai.download.events', download.events);
        span.setAttribute('builtin_ai.download.observed', download.observed);
        if (isCountable(download.lastLoaded)) {
          span.setAttribute(
            'builtin_ai.download.last_loaded',
            download.lastLoaded,
          );
        }
        // Undecidable without fractional progress or an earlier availability
        // answer, so left off the span rather than guessed at.
        if (download.real !== undefined) {
          span.setAttribute('builtin_ai.download.real', download.real);
          span.setAttribute(
            'builtin_ai.create.blocked_on_download',
            download.real,
          );
        }
        if (
          download.real &&
          isCountable(firstEventAt) &&
          isCountable(lastEventAt)
        ) {
          span.setAttribute(
            'builtin_ai.download.ms',
            ms(firstEventAt, lastEventAt),
          );
          span.addEvent('builtin_ai.download.complete', {
            'builtin_ai.download.last_loaded': download.lastLoaded ?? 0,
          });
        }

        const window = readWindow(session);
        if (isCountable(window))
          span.setAttribute('builtin_ai.context.window', window);
        const usage = readUsage(session);
        if (isCountable(usage))
          span.setAttribute('builtin_ai.context.usage_at_create', usage);
        // What the session says it samples with: on Canary 159 a `topK` or
        // `temperature` session reads back `balanced`, since web pages
        // ignore those knobs.
        const mode = session.samplingMode;
        const reported = mode !== null && mode !== undefined && mode.length > 0;
        span.setAttribute(
          'builtin_ai.session.sampling_mode_reported',
          reported,
        );
        if (reported)
          span.setAttribute('builtin_ai.session.sampling_mode', mode);

        return instrumentSession(session, state);
      } catch (caught) {
        span.setAttribute('builtin_ai.create.ms', ms(started));
        fail(
          span,
          caught instanceof Error ? caught : new Error(String(caught)),
        );
        throw caught;
      } finally {
        span.end();
      }
    };

  // ---------------------------------------------------------------- install

  const patched: BuiltInApiName[] = [];
  for (const name of wanted) {
    const api = readApi(name);
    if (!api) continue;
    replace(api, 'availability', wrapAvailability(name, api.availability, api));
    replace(api, 'create', wrapCreate(name, api.create, api));
    patched.push(name);
  }

  if (patched.length === 0) return { uninstall() {} };

  // An installation naming fewer APIs than the page uses is the "instrumented
  // before the flags were on" case, otherwise indistinguishable from an
  // application that never called them.
  tracer
    .startSpan('builtin_ai.install', {
      attributes: {
        'builtin_ai.installation.id': installationId,
        'builtin_ai.apis': patched.join(','),
      },
    })
    .end();

  const state: InstallationState = {
    references: 1,
    restore() {
      live = false;
      for (const undo of [...restorers].reverse()) undo();
    },
  };
  installations.set(root, state);
  return handle(root, state);
}

/**
 * The device the model runs on. On-device latency is set by the hardware, so
 * these sit on every span rather than leaving the reader to join a resource.
 * Each hint is browser-reported and coarse; an absent or nonsensical one is
 * left off rather than recorded as zero.
 */
interface HardwareNavigator {
  cpuPerformance?: number;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

function readHardware(): Attributes {
  const nav: HardwareNavigator | undefined = globalThis.navigator;
  const attributes: Attributes = {};
  if (!nav) return attributes;
  const { cpuPerformance, deviceMemory, hardwareConcurrency } = nav;
  if (
    isCountable(deviceMemory) &&
    deviceMemory !== undefined &&
    deviceMemory > 0
  ) {
    attributes['builtin_ai.runtime.device_memory_gib'] = deviceMemory;
  }
  if (Number.isInteger(cpuPerformance) && (cpuPerformance ?? -1) >= 0) {
    attributes['builtin_ai.runtime.cpu_performance_tier'] = cpuPerformance;
  }
  if (Number.isInteger(hardwareConcurrency) && (hardwareConcurrency ?? 0) > 0) {
    attributes['builtin_ai.runtime.logical_cores'] = hardwareConcurrency;
  }
  return attributes;
}

/**
 * Whose model answers. The model is the user agent's, not the page's: Chrome
 * ships Gemini Nano or Gemma, Edge ships Phi-4-mini (or Aion-1.0-Instruct
 * behind a flag) behind the same APIs. So a
 * fixed provider would mislabel every Edge span. Read from the low-entropy
 * brand list, which is synchronous; Chrome is the fallback because it is the
 * only other browser shipping these APIs.
 */
interface BrandNavigator {
  userAgent?: string;
  userAgentData?: { brands?: ReadonlyArray<{ brand: string }> };
}

function detectProvider(): string {
  const nav: BrandNavigator | undefined = globalThis.navigator;
  const brands = nav?.userAgentData?.brands ?? [];
  // `Edg/` covers a context without client hints.
  if (
    brands.some((entry) => entry.brand === 'Microsoft Edge') ||
    / Edg\//.test(nav?.userAgent ?? '')
  ) {
    return 'microsoft.edge';
  }
  return 'google.chrome';
}

/**
 * Whether the page had a live user gesture when `create()` ran. Chrome refuses
 * a `create()` that has to download the model without one, so a failed create
 * on a fresh device with this `false` is the cause, not a mystery.
 */
interface ActivationNavigator {
  userActivation?: { isActive?: boolean };
}

function userActivation(): Attributes {
  const nav: ActivationNavigator | undefined = globalThis.navigator;
  const active = nav?.userActivation?.isActive;
  return active === undefined
    ? {}
    : { 'builtin_ai.create.user_activation': active };
}

/**
 * The GenAI finish reason for a call that rejected. Truncation is `length`,
 * as the convention names it: measured on Canary 159, a generation that runs
 * past the output limit rejects with `QuotaExceededError: The response
 * exceeded output limits and was truncated.` The same error name is used for
 * input that does not fit, so the message decides.
 */
function failureFinishReason(error: Error): string {
  if (error.name === 'AbortError') return 'abort';
  if (
    error.name === 'QuotaExceededError' &&
    /output limit/i.test(error.message)
  ) {
    return 'length';
  }
  return 'error';
}

function newState(
  api: BuiltInApiName,
  conversationId: string,
  parentSessionId?: string,
): SessionState {
  const state: SessionState = {
    api,
    conversationId,
    sessionId: parentSessionId ? newId() : conversationId,
    turnIndex: 0,
    compacted: false,
    pendingOverflow: false,
    tools: new Map(),
  };
  if (parentSessionId) state.parentSessionId = parentSessionId;
  return state;
}

function handle(
  root: typeof globalThis,
  state: InstallationState,
): Instrumentation {
  let active = true;
  return {
    uninstall() {
      if (!active) return;
      active = false;
      state.references -= 1;
      if (state.references > 0) return;
      state.restore();
      installations.delete(root);
    },
  };
}
