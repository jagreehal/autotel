import {
  describeDownload,
  describeRefusal,
  describeSamplingOption,
} from './describe';
import {
  BUILTIN_AI_APIS,
  SESSION_METHODS,
  isBuiltInApi,
  isCloneMethod,
  isCountable,
  isNonEmptyString,
  isReadableStream,
  isSessionMethod,
  isStreamingMethodName,
  isTextInput,
  type Availability,
  type AwaitedMethod,
  type BuiltInApi,
  type BuiltInApiName,
  type BuiltInSession,
  type CreateOptions,
  type DownloadMonitor,
  type CancellableTransformer,
  type ModelInput,
  type StreamingMethod,
} from './types';

/** Anything this package swaps in for a platform method. */
type Patchable =
  | AwaitedMethod
  | BuiltInApi['availability']
  | BuiltInApi['create']
  | StreamingMethod
  | (() => Promise<BuiltInSession>);

/**
 * OpenTelemetry instrumentation for Chrome's built-in AI APIs, with no
 * telemetry dependency.
 *
 * Patches `availability()` and `create()` on each built-in AI global, and the
 * work method on every session they hand back. Nothing about your calls
 * changes.
 *
 * You supply the span factory. Import from `autotel-builtin-ai` instead to get
 * autotel-web's `span()` filled in for you.
 *
 * Spans carry what the platform actually did rather than what it reports:
 * `availability()` answers differently depending on the options it is passed,
 * `create()` blocks for minutes while a model downloads, a download monitor
 * fires when nothing is downloaded, and a session cannot say how it samples.
 * None of it is recoverable after the call.
 */

export interface SpanApi {
  setAttribute: (key: string, value: string | number | boolean) => void;
  end: () => void;
}

export type SpanFn = <T>(name: string, fn: (span: SpanApi) => T) => T;

export interface InstrumentOptions {
  /**
   * Which built-in AI globals to patch. Defaults to all of them; a global that
   * is absent is skipped either way.
   */
  apis?: readonly BuiltInApiName[];
  /**
   * Record prompts and outputs as span attributes. Off by default: what people
   * put into an on-device model is frequently the reason they wanted it
   * on-device.
   */
  capturePayloads?: boolean;
  /** Truncate captured payloads to this many characters. Default 2048. */
  maxPayloadLength?: number;
  /**
   * Span factory. Injectable so the instrumentation can be driven by any
   * pipeline, or by none at all in a test.
   */
  span?: SpanFn;
}

export interface CoreInstrumentOptions extends InstrumentOptions {
  /** Span factory. Required here; `autotel-builtin-ai` supplies a default. */
  span: SpanFn;
}

export interface Instrumentation {
  uninstall(): void;
}

const DEFAULT_MAX_PAYLOAD = 2048;

interface InstallationState {
  references: number;
  restore(): void;
}

/**
 * Separates two page loads.
 *
 * Not a security boundary — `randomUUID` is unavailable on insecure origins,
 * and a counter-free random string is enough to tell one installation from the
 * next.
 */
const newInstallationId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `builtin-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const installations = new WeakMap<typeof globalThis, InstallationState>();

const truncate = (value: string, max: number): string =>
  value.length <= max
    ? value
    : `${value.slice(0, max)}...[${value.length} chars]`;

/**
 * Read one built-in AI global.
 *
 * Through a property descriptor rather than an assertion on `globalThis`:
 * these are late-bound platform objects with no ambient declaration, and
 * declaring them would put eight names into every consumer's global scope.
 * `isBuiltInApi` establishes the contract before anything is patched, so a
 * global that is absent or shaped otherwise is skipped rather than trusted.
 */
const readApi = (name: BuiltInApiName): BuiltInApi | undefined => {
  const candidate: BuiltInApi | undefined = Object.getOwnPropertyDescriptor(
    globalThis,
    name,
  )?.value;
  return isBuiltInApi(candidate) ? candidate : undefined;
};

export function instrumentBuiltInAI(
  options: CoreInstrumentOptions,
): Instrumentation {
  const root = globalThis;
  const existing = installations.get(root);
  if (existing) {
    existing.references += 1;
    return handle(root, existing);
  }

  const emit = options.span;
  const capture = options.capturePayloads ?? false;
  const maxLength = options.maxPayloadLength ?? DEFAULT_MAX_PAYLOAD;
  const wanted = options.apis ?? BUILTIN_AI_APIS;
  const installationId = newInstallationId();

  /**
   * The last answer each API gave, from the caller's own `availability()`
   * calls.
   *
   * Recorded rather than probed. Asking the platform again before every
   * `create()` would make installing telemetry add a call the application did
   * not make, and it is the one thing this package refuses to do. The cost is
   * that an application which never calls `availability()` leaves
   * `builtin_ai.download.real` undecidable — which is the honest answer, since
   * a download monitor alone cannot tell a real download from a no-op.
   */
  const lastAvailability = new Map<string, Availability>();

  /**
   * A stable description of every option that can affect availability.
   *
   * The monitor callback observes a create; it cannot change whether a model is
   * available, so it is deliberately omitted. Object keys are sorted at every
   * depth so callers may reuse equivalent options without having to reuse the
   * same object or property order.
   */
  const describeAvailabilityOptions = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(describeAvailabilityOptions);
    if (value === null || typeof value !== 'object') return value;

    const record = value as Record<string, unknown>;
    const described: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (key === 'monitor' || typeof record[key] === 'function') continue;
      described[key] = describeAvailabilityOptions(record[key]);
    }
    return described;
  };

  // Exotic option values (cycles, throwing getters, BigInts) must not make
  // instrumentation reject a platform call that would otherwise run. When a
  // structural description is impossible, the same options object can still
  // be matched safely by identity; a different object remains undecidable.
  const opaqueOptionIds = new WeakMap<CreateOptions, number>();
  let nextOpaqueOptionId = 1;

  // Keyed by the option values too: `availability()` evaluates them rather
  // than model readiness (see `guardWouldRefuse`), so an answer given for one
  // set says nothing about a `create()` made with another.
  const availabilityKey = (
    api: BuiltInApiName,
    callOptions: CreateOptions | undefined,
  ): string => {
    try {
      return `${api}:${JSON.stringify(describeAvailabilityOptions(callOptions))}`;
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

  const replace = (
    target: BuiltInApi | BuiltInSession,
    property: string,
    value: Patchable,
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

  /**
   * Record a rejection. Takes an `Error` because every catch normalises the
   * value where it arrives — the platform rejects with `DOMException`, which
   * is one, and anything else a page throws is carried through as its text.
   */
  const failure = (span: SpanApi, error: Error): void => {
    span.setAttribute('error.type', error.name);
    const message = error.message;
    const refusal = describeRefusal(message);
    // Classified, not quoted: the refusal kind is platform text and carries no
    // caller data, so it is recorded whether or not payload capture is on.
    if (refusal) span.setAttribute('builtin_ai.create.refusal', refusal);
    if (capture) {
      span.setAttribute(
        'builtin_ai.error.message',
        truncate(message, maxLength),
      );
    }
  };

  // ------------------------------------------------------------ session work

  const wrapAwaited = (
    api: BuiltInApiName,
    method: string,
    session: BuiltInSession,
    original: AwaitedMethod,
  ): AwaitedMethod =>
    function instrumented(input: ModelInput): Promise<string> {
      // Read before the call, not inside the span body: the model starts
      // consuming context the moment it is handed the input.
      const usageBefore = session.contextUsage;
      return emit(`${method} ${api}`, async (span) => {
        describeCall(span, api, method, session, input, false, usageBefore);
        const started = performance.now();
        try {
          const output = await original.call(session, input);
          span.setAttribute(
            'builtin_ai.ms',
            Math.round(performance.now() - started),
          );
          span.setAttribute('builtin_ai.output.chars', output.length);
          if (capture) {
            span.setAttribute('builtin_ai.output', truncate(output, maxLength));
          }
          recordUsageAfter(span, session);
          return output;
        } catch (caught) {
          failure(
            span,
            caught instanceof Error ? caught : new Error(String(caught)),
          );
          throw caught;
        }
      });
    };

  const wrapStreaming = (
    api: BuiltInApiName,
    method: string,
    session: BuiltInSession,
    original: StreamingMethod,
  ): StreamingMethod =>
    function instrumented(input: ModelInput): ReadableStream<string> {
      const usageBefore = session.contextUsage;
      const source = original.call(session, input);
      if (!isReadableStream(source)) return source;

      const started = performance.now();
      let firstChunkAt: number | undefined;
      let chunks = 0;
      let chars = 0;
      let settle: ((reason?: unknown) => void) | undefined;
      const drained = new Promise<unknown>((resolve) => {
        settle = resolve;
      });

      const transformer: CancellableTransformer<string, string> = {
        transform(chunk, controller: TransformStreamDefaultController<string>) {
          firstChunkAt ??= performance.now();
          chunks += 1;
          chars += chunk.length;
          controller.enqueue(chunk);
        },
        flush() {
          settle?.();
        },
        // Runs when the caller walks away *and* when the source errors — the
        // writable side is aborted with the error as its reason. Without this
        // the span stays open for the life of the page; without the reason a
        // failed stream would close as a successful span.
        cancel(reason?: unknown) {
          settle?.(reason);
        },
      };
      const measured = source.pipeThrough(new TransformStream(transformer));

      // The span outlives this function, so it is emitted alongside the stream
      // rather than around it: the caller is handed `measured` immediately and
      // the span closes when the stream does. A stream nothing ever reads
      // never closes, and neither does its span — which is the same shape as
      // the request it is measuring.
      void emit(`${method} ${api}`, async (span) => {
        describeCall(span, api, method, session, input, true, usageBefore);
        const reason = await drained;
        if (isCountable(firstChunkAt)) {
          span.setAttribute(
            'builtin_ai.stream.ttft_ms',
            Math.round(firstChunkAt - started),
          );
        }
        span.setAttribute(
          'builtin_ai.stream.total_ms',
          Math.round(performance.now() - started),
        );
        span.setAttribute('builtin_ai.stream.chunks', chunks);
        span.setAttribute('builtin_ai.stream.chars', chars);
        recordUsageAfter(span, session);
        // An Error reason is the source failing; anything else is the caller
        // cancelling, which is not a failure of the model.
        if (reason instanceof Error) {
          failure(span, reason);
        } else if (reason !== undefined) {
          span.setAttribute('builtin_ai.stream.cancelled', true);
        }
      });

      return measured;
    };

  const describeCall = (
    span: SpanApi,
    api: BuiltInApiName,
    method: string,
    session: BuiltInSession,
    input: ModelInput,
    streaming: boolean,
    usageBefore: number | undefined,
  ): void => {
    span.setAttribute('builtin_ai.installation.id', installationId);
    span.setAttribute('builtin_ai.api', api);
    span.setAttribute('builtin_ai.method', method);
    span.setAttribute('gen_ai.operation.name', method);
    span.setAttribute('builtin_ai.streaming', streaming);
    if (isTextInput(input)) {
      span.setAttribute('builtin_ai.input.chars', input.length);
      if (capture) {
        span.setAttribute('builtin_ai.input', truncate(input, maxLength));
      }
    } else {
      // Multimodal input. The part count is the only thing worth recording
      // about it, and the only thing this package looks at.
      span.setAttribute('builtin_ai.input.parts', input.length);
    }
    if (isCountable(usageBefore)) {
      span.setAttribute('builtin_ai.context.usage_before', usageBefore);
    }
  };

  const recordUsageAfter = (span: SpanApi, session: BuiltInSession): void => {
    if (isCountable(session.contextUsage)) {
      span.setAttribute('builtin_ai.context.usage_after', session.contextUsage);
    }
  };

  /**
   * Wrap the work methods on one session, and any clone it produces.
   *
   * A clone is a fresh session object with its own methods. Left alone it
   * would silently emit nothing, and a conversation forked per turn would
   * vanish from the trace after its first turn.
   */
  const instrumentSession = (
    api: BuiltInApiName,
    session: BuiltInSession,
  ): BuiltInSession => {
    for (const method of SESSION_METHODS[api]) {
      // Read after narrowing the name, so the method's own type comes with it
      // and neither branch needs an assertion.
      if (isStreamingMethodName(method)) {
        const original = session[method];
        if (!isSessionMethod(original)) continue;
        replace(session, method, wrapStreaming(api, method, session, original));
      } else {
        const original = session[method];
        if (!isSessionMethod(original)) continue;
        replace(session, method, wrapAwaited(api, method, session, original));
      }
    }

    const clone = session.clone;
    if (isCloneMethod(clone)) {
      replace(
        session,
        'clone',
        async function instrumentedClone(): Promise<BuiltInSession> {
          return instrumentSession(api, await clone.call(session));
        },
      );
    }

    return session;
  };

  // ---------------------------------------------------------------- statics

  const wrapAvailability = (
    api: BuiltInApiName,
    original: BuiltInApi['availability'],
    target: BuiltInApi,
  ): BuiltInApi['availability'] =>
    function instrumented(callOptions?: CreateOptions): Promise<Availability> {
      return emit('builtin_ai.availability', async (span) => {
        span.setAttribute('builtin_ai.installation.id', installationId);
        span.setAttribute('builtin_ai.api', api);
        // The guard trap, as one boolean. A bare call answers for default
        // sampling options, not for model readiness, so a guard written
        // without options can refuse on a browser where create() would work.
        span.setAttribute(
          'builtin_ai.availability.options_supplied',
          callOptions !== undefined,
        );
        span.setAttribute(
          'builtin_ai.availability.sampling_option',
          describeSamplingOption(callOptions),
        );
        try {
          const answer = await original.call(target, callOptions);
          span.setAttribute('builtin_ai.availability.answer', answer);
          lastAvailability.set(availabilityKey(api, callOptions), answer);
          return answer;
        } catch (caught) {
          failure(
            span,
            caught instanceof Error ? caught : new Error(String(caught)),
          );
          throw caught;
        }
      });
    };

  const wrapCreate = (
    api: BuiltInApiName,
    original: BuiltInApi['create'],
    target: BuiltInApi,
  ): BuiltInApi['create'] =>
    function instrumented(
      callOptions?: CreateOptions,
    ): Promise<BuiltInSession> {
      return emit(`create_session ${api}`, async (span) => {
        span.setAttribute('builtin_ai.installation.id', installationId);
        span.setAttribute('builtin_ai.api', api);
        span.setAttribute('gen_ai.operation.name', 'create_session');
        span.setAttribute(
          'builtin_ai.create.sampling_option',
          describeSamplingOption(callOptions),
        );

        const key = availabilityKey(api, callOptions);
        const before = lastAvailability.get(key);
        if (before) span.setAttribute('builtin_ai.availability.before', before);

        const loaded: number[] = [];
        const observing: CreateOptions = {
          ...callOptions,
          monitor(monitor: DownloadMonitor) {
            monitor.addEventListener('downloadprogress', (event) => {
              loaded.push(event.loaded);
            });
            // The caller's monitor still runs, and still runs second, so a
            // progress bar wired to it behaves exactly as it did.
            callOptions?.monitor?.(monitor);
          },
        };

        const started = performance.now();
        try {
          const session = await original.call(target, observing);
          const elapsed = Math.round(performance.now() - started);
          const download = describeDownload(before, loaded);
          // A create() that returned is proof the model is here now. Without
          // this the stale 'downloadable' answer would make every later warm
          // create() report a second real download.
          lastAvailability.set(key, 'available');

          span.setAttribute('builtin_ai.create.ms', elapsed);
          span.setAttribute('builtin_ai.download.events', download.events);
          span.setAttribute('builtin_ai.download.observed', download.observed);
          if (isCountable(download.lastLoaded)) {
            span.setAttribute(
              'builtin_ai.download.last_loaded',
              download.lastLoaded,
            );
          }
          // Undecidable without an availability answer from before the call,
          // so it is left off the span rather than guessed at.
          if (before) {
            span.setAttribute('builtin_ai.download.real', download.real);
            // create() blocks for the whole fetch — measured at 190,163ms
            // against 1-3ms warm. A caller with no progress UI sees a hang.
            span.setAttribute(
              'builtin_ai.create.blocked_on_download',
              download.real,
            );
          }
          if (isCountable(session.contextWindow)) {
            span.setAttribute(
              'builtin_ai.context.window',
              session.contextWindow,
            );
          }
          if (isCountable(session.contextUsage)) {
            span.setAttribute(
              'builtin_ai.context.usage_at_create',
              session.contextUsage,
            );
          }
          // Reads back null for topK and temperature, so the boolean says
          // whether the session could describe itself at all. What was
          // actually passed is on builtin_ai.create.sampling_option.
          const mode = session.samplingMode;
          span.setAttribute(
            'builtin_ai.session.sampling_mode_reported',
            isNonEmptyString(mode),
          );
          if (isNonEmptyString(mode)) {
            span.setAttribute('builtin_ai.session.sampling_mode', mode);
          }

          return instrumentSession(api, session);
        } catch (caught) {
          span.setAttribute(
            'builtin_ai.create.ms',
            Math.round(performance.now() - started),
          );
          failure(
            span,
            caught instanceof Error ? caught : new Error(String(caught)),
          );
          throw caught;
        }
      });
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

  // Emitted after the patch is live, carrying which globals it covers. An
  // installation naming fewer APIs than the page uses is the "instrumented
  // before the flags were on" case, which is otherwise indistinguishable from
  // an application that simply never called them.
  emit('builtin_ai.install', (span) => {
    span.setAttribute('builtin_ai.installation.id', installationId);
    span.setAttribute('builtin_ai.apis', patched.join(','));
  });

  const state: InstallationState = {
    references: 1,
    restore() {
      for (const undo of [...restorers].reverse()) undo();
    },
  };
  installations.set(root, state);
  return handle(root, state);
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
