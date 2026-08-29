import {
  describeRefusal,
  describeResult,
  descriptorFingerprint,
  diffAnnotations,
  labelMismatch,
} from './describe';

/**
 * OpenTelemetry instrumentation for WebMCP, with no telemetry dependency.
 *
 * Patches `registerTool` on the shared ModelContext so every tool registration
 * and every agent invocation becomes a span. Nothing about your tools changes.
 *
 * You supply the span factory. Import from `autotel-webmcp` instead to get
 * autotel-web's `span()` filled in for you.
 *
 * Spans carry what the agent *actually received* — Chrome serialises return
 * values, substitutes a message for empty ones, and silently discards
 * annotations it does not recognise. Intent is not observable; this is.
 */

export interface SpanApi {
  setAttribute: (key: string, value: string | number | boolean) => void;
  end: () => void;
}

export type SpanFn = <T>(name: string, fn: (span: SpanApi) => T) => T;

export interface InstrumentOptions {
  /**
   * Span factory. Injectable so the instrumentation can be driven by any
   * pipeline, or by none at all in a test.
   */
  span?: SpanFn;
  /**
   * Record tool inputs and results as span attributes. Off by default because
   * tool calls commonly contain personal or confidential data.
   */
  capturePayloads?: boolean;
  /** Truncate captured payloads to this many characters. Default 2048. */
  maxPayloadLength?: number;
  /** Classify application-normalised failures that are returned instead of thrown. */
  isErrorResult?: (value: unknown) => boolean;
  /**
   * Classify a returned value as a refusal — the tool declining to act, which
   * is not a failure. Defaults to `describeRefusal` and its two recognised
   * sentences; supply your own when your tools refuse in their own words, or
   * when that wording changes.
   */
  isRefusal?: (value: unknown) => string | undefined;
  /**
   * Fold the handler's source into `webmcp.tool.descriptor`.
   *
   * A descriptor is what a tool claims to be. Registering the same name, the
   * same description and a different function is a swap that the descriptor
   * alone cannot see — the fingerprint matches and `webmcp.tool.redefined`
   * stays quiet. Off by default: a handler built by a bundler, or one whose
   * source moves for reasons of its own, produces a new fingerprint on every
   * load, which is noise rather than evidence.
   */
  fingerprintHandler?: boolean;
}

/** What a host's consent dialogue showed, and what it was consent for. */
export interface ConsentRecord {
  /** Arguments the call carries. Recorded only when payload capture is on. */
  arguments?: unknown;
  /** Whether the human said yes. */
  granted: boolean;
  /** The tool that will actually run. */
  resolved: string;
  /** The label the human read — a friendly name, a description, a summary. */
  shown: string;
}

export interface Instrumentation {
  /**
   * Record a consent decision alongside the call it was consent for.
   *
   * The instrumentation cannot see a consent dialogue: it patches
   * `registerTool`, and the dialogue is the host's own UI. So the host reports
   * it here, and the label the human read lands on the same trace as the call
   * that ran. `webmcp.consent.mismatch` is then a query rather than an
   * investigation, and an execution with no consent span before it is visible
   * as exactly that.
   */
  recordConsent(record: ConsentRecord): void;
  uninstall(): void;
}

const DEFAULT_MAX_PAYLOAD = 2048;

interface InstallationState {
  recordConsent(record: ConsentRecord): void;
  references: number;
  restore(): void;
}

/**
 * A tool set is only meaningful relative to the installation that registered
 * it. A reload tears the page down without aborting any signal, so load 1's
 * tools are registered and never withdrawn; without this id a reader pairing
 * registrations with withdrawals cannot tell the two loads apart, and reports
 * tools the agent can no longer see as still offered.
 *
 * Not a security boundary — `randomUUID` is unavailable on insecure origins,
 * and a counter-free random string is enough to separate two page loads.
 */
const newInstallationId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `webmcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const installations = new WeakMap<WebMCP.ModelContext, InstallationState>();

function installationHandle(
  modelContext: WebMCP.ModelContext,
  state: InstallationState,
): Instrumentation {
  let active = true;
  return {
    recordConsent: state.recordConsent,
    uninstall() {
      if (!active) return;
      active = false;
      state.references -= 1;
      if (state.references > 0) return;
      state.restore();
      installations.delete(modelContext);
    },
  };
}

const truncate = (value: string, max: number) =>
  value.length <= max
    ? value
    : `${value.slice(0, max)}...[${value.length} chars]`;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as PromiseLike<unknown>).then === 'function';

export interface CoreInstrumentOptions extends InstrumentOptions {
  /** Span factory. Required here; `autotel-webmcp` supplies a default. */
  span: SpanFn;
}

export function instrumentWebMCP(
  options: CoreInstrumentOptions,
): Instrumentation {
  const browserDocument = globalThis.document;
  const original = browserDocument?.modelContext;
  if (!original) return { recordConsent() {}, uninstall() {} };

  const existing = installations.get(original);
  if (existing) {
    existing.references += 1;
    return installationHandle(original, existing);
  }

  const emit = options.span;
  const capture = options.capturePayloads ?? false;
  const maxLength = options.maxPayloadLength ?? DEFAULT_MAX_PAYLOAD;
  const isErrorResult = options.isErrorResult;
  const classifyRefusal = options.isRefusal ?? describeRefusal;
  const installationId = newInstallationId();
  const withdrawalCleanups: Array<() => void> = [];
  const fingerprints = new Map<string, string>();
  const fingerprintHandler = options.fingerprintHandler ?? false;
  /**
   * Executions that have started and not yet settled, innermost last.
   *
   * A tool whose handler calls another tool spends its consent twice: the
   * human approved one call and two ran. That shows up here as an execution
   * beginning while another is in flight. Two calls the agent fired in
   * parallel overlap the same way, so this is recorded as the fact it is —
   * what else was running — and whether that amounts to a chain is the
   * reader's call, not this package's.
   */
  const inFlight: string[] = [];
  let executeSeq = 0;

  /**
   * A consent decision, on the same trace as the call it authorised.
   *
   * Emitted through the host's span factory like everything else, so it is
   * joinable to the execution by installation id, tool name and descriptor —
   * including when the descriptor changed between the two, which is the swap
   * a consent dialogue cannot show.
   */
  const recordConsent = (record: ConsentRecord) =>
    emit('webmcp.consent', (span) => {
      span.setAttribute('webmcp.installation.id', installationId);
      span.setAttribute('webmcp.consent.shown', record.shown);
      span.setAttribute('webmcp.consent.resolved', record.resolved);
      span.setAttribute('gen_ai.tool.name', record.resolved);
      span.setAttribute('webmcp.consent.granted', record.granted);
      // A string comparison, not a verdict: the label the human read is not
      // the name of the call it authorised.
      span.setAttribute(
        'webmcp.consent.mismatch',
        record.shown !== record.resolved,
      );
      const descriptor = fingerprints.get(record.resolved);
      if (descriptor) span.setAttribute('webmcp.tool.descriptor', descriptor);
      if (capture && record.arguments !== undefined) {
        span.setAttribute(
          'webmcp.consent.arguments',
          truncate(JSON.stringify(record.arguments) ?? '', maxLength),
        );
      }
    });

  const wrapExecute =
    (name: string, execute: (input: unknown, opts: unknown) => unknown) =>
    (input: unknown, opts: unknown) =>
      // Named for the GenAI convention — `execute_tool {gen_ai.tool.name}` —
      // so a trace list reads as the tools that ran rather than one repeated
      // string. The tool name stays on `webmcp.tool.name` for filtering.
      emit(`execute_tool ${name}`, (span) => {
        executeSeq += 1;
        span.setAttribute('webmcp.installation.id', installationId);
        span.setAttribute('webmcp.tool.name', name);
        span.setAttribute('webmcp.execute.seq', executeSeq);
        span.setAttribute('webmcp.execute.depth', inFlight.length);
        const outer = inFlight.at(-1);
        if (outer !== undefined) {
          span.setAttribute('webmcp.execute.parent', outer);
        }
        span.setAttribute('gen_ai.operation.name', 'execute_tool');
        span.setAttribute('gen_ai.tool.name', name);
        const descriptor = fingerprints.get(name);
        if (descriptor) span.setAttribute('webmcp.tool.descriptor', descriptor);
        const serializedInput =
          input === undefined ? undefined : (JSON.stringify(input) ?? '');
        if (serializedInput !== undefined) {
          span.setAttribute(
            'mcp.tool.arguments.size',
            new TextEncoder().encode(serializedInput).length,
          );
        }
        if (capture && serializedInput !== undefined) {
          const capturedInput = truncate(serializedInput, maxLength);
          span.setAttribute('webmcp.input', capturedInput);
          span.setAttribute('gen_ai.tool.call.arguments', capturedInput);
        }

        const record = (value: unknown) => {
          const described = describeResult(value);
          try {
            const refusal = classifyRefusal(value);
            if (refusal) {
              span.setAttribute('webmcp.result.refused', true);
              span.setAttribute('webmcp.result.refusal', refusal);
            }
          } catch (error) {
            span.setAttribute(
              'webmcp.classifier.error.type',
              error instanceof Error ? error.name : typeof error,
            );
          }
          if (isErrorResult) {
            try {
              if (isErrorResult(value)) {
                span.setAttribute('error.type', 'tool_error');
                span.setAttribute('webmcp.result.error', true);
              }
            } catch (error) {
              span.setAttribute(
                'webmcp.classifier.error.type',
                error instanceof Error ? error.name : typeof error,
              );
            }
          }
          span.setAttribute('webmcp.result.type', described.type);
          span.setAttribute('webmcp.result.bytes', described.bytes);
          span.setAttribute('mcp.tool.result.size', described.bytes);
          span.setAttribute('webmcp.result.envelope', described.envelope);
          span.setAttribute('webmcp.result.substituted', described.substituted);
          if (capture) {
            const capturedResult = truncate(described.serialized, maxLength);
            span.setAttribute('webmcp.result', capturedResult);
            span.setAttribute('gen_ai.tool.call.result', capturedResult);
          }
          // Hand back what the handler produced. Serialising an object here
          // avoids a second JSON.stringify() over stateful getters/toJSON(),
          // but a string and `undefined` are returned untouched: substituting
          // Chrome's "Operation succeeded" for an empty result would make
          // installing telemetry change what the agent receives, and would go
          // on doing it after Chrome stopped.
          return value === undefined || typeof value === 'string'
            ? value
            : described.serialized;
        };

        /**
         * Chrome replaces a thrown error with a generic UnknownError before
         * the agent sees it, so this span is the only place the reason
         * survives. Recording it here rather than leaving it to the span
         * factory means it survives under `autotel-webmcp/core` too, where
         * the factory is whatever the host supplied.
         */
        const failed = (error: unknown): never => {
          span.setAttribute(
            'error.type',
            error instanceof Error ? error.name : typeof error,
          );
          span.setAttribute('webmcp.result.error', true);
          if (capture) {
            span.setAttribute(
              'webmcp.error.message',
              truncate(
                error instanceof Error ? error.message : String(error),
                maxLength,
              ),
            );
          }
          throw error;
        };

        const settled = () => {
          const at = inFlight.lastIndexOf(name);
          if (at !== -1) inFlight.splice(at, 1);
        };

        inFlight.push(name);
        try {
          const result = execute(input, opts);
          if (!isThenable(result)) {
            settled();
            return record(result);
          }
          return Promise.resolve(result)
            .then(record, failed)
            .finally(settled) as never;
        } catch (error) {
          settled();
          return failed(error);
        }
      });

  /**
   * Withdrawal is an abort.
   *
   * `registerTool(tool, { signal })` is how the platform hands a tool back:
   * a library holds one AbortController per tool and aborts it when the tool
   * should no longer be offered. Under `when:`-style gating that happens
   * continuously, not at teardown — so an inventory built from registrations
   * alone only ever grows, and lists tools the agent can no longer see.
   */
  const watchWithdrawal = (name: string, registerOptions: unknown) => {
    const signal = (registerOptions as { signal?: AbortSignal } | undefined)
      ?.signal;
    if (!signal) return;
    const record = () =>
      emit('webmcp.tool.withdraw', (span) => {
        span.setAttribute('webmcp.installation.id', installationId);
        span.setAttribute('webmcp.tool.name', name);
        span.setAttribute('gen_ai.tool.name', name);
      });
    if (signal.aborted) record();
    else {
      signal.addEventListener('abort', record, { once: true });
      withdrawalCleanups.push(() =>
        signal.removeEventListener('abort', record),
      );
    }
  };

  const ownRegisterDescriptor = Object.getOwnPropertyDescriptor(
    original,
    'registerTool',
  );
  const nativeRegister = original.registerTool;
  const instrumentedRegister = async (
    tool: Record<string, unknown>,
    registerOptions?: unknown,
  ) => {
    const name = String(tool['name']);
    const sent = tool['annotations'] as Record<string, unknown> | undefined;
    const title = tool['title'];
    const fingerprint = descriptorFingerprint({
      annotations: sent,
      description: tool['description'],
      handler: fingerprintHandler ? tool['execute'] : undefined,
      inputSchema: tool['inputSchema'],
      name,
      title,
    });

    const instrumented = {
      ...tool,
      execute: wrapExecute(
        name,
        tool['execute'] as (i: unknown, o: unknown) => unknown,
      ),
    };

    watchWithdrawal(name, registerOptions);

    return emit('webmcp.tool.register', async (span) => {
      span.setAttribute('webmcp.installation.id', installationId);
      span.setAttribute('webmcp.tool.name', name);
      span.setAttribute('gen_ai.tool.name', name);
      span.setAttribute(
        'webmcp.tool.description.length',
        String(tool['description'] ?? '').length,
      );
      span.setAttribute(
        'webmcp.tool.has_input_schema',
        tool['inputSchema'] !== undefined,
      );
      span.setAttribute('webmcp.tool.descriptor', fingerprint);
      span.setAttribute(
        'webmcp.tool.label_mismatch',
        labelMismatch(name, title),
      );
      if (typeof title === 'string' && title.length > 0) {
        span.setAttribute('webmcp.tool.title', title);
      }
      if (sent)
        span.setAttribute(
          'webmcp.annotations.sent',
          Object.keys(sent).join(','),
        );

      const outcome = await Reflect.apply(nativeRegister, original, [
        instrumented,
        registerOptions,
      ]);

      const previous = fingerprints.get(name);
      fingerprints.set(name, fingerprint);
      if (previous !== undefined && previous !== fingerprint) {
        span.setAttribute('webmcp.tool.redefined', true);
      }

      // Introspection is diagnostic only. It must never change the outcome of
      // a registration that the browser already accepted.
      let registered: WebMCP.RegisteredTool | undefined;
      let introspectionErrorType: string | undefined;
      try {
        registered = (await original.getTools()).find(
          (registeredTool) => registeredTool.name === name,
        );
      } catch (error) {
        introspectionErrorType =
          error instanceof Error ? error.name : typeof error;
      }
      const dropped = registered
        ? diffAnnotations(
            sent,
            registered.annotations as Record<string, unknown> | undefined,
          )
        : [];

      if (dropped.length > 0)
        span.setAttribute('webmcp.annotations.dropped', dropped.join(','));
      if (introspectionErrorType) {
        span.setAttribute(
          'webmcp.introspection.error.type',
          introspectionErrorType,
        );
      }
      return outcome;
    });
  };

  // Emitted before the patch is live, so it exists even when nothing registers
  // afterwards. An installation with no registration spans is the "called
  // instrumentWebMCP() after registering your tools" mistake, which is
  // otherwise indistinguishable from having no tools at all.
  emit('webmcp.install', (span) => {
    span.setAttribute('webmcp.installation.id', installationId);
  });

  Object.defineProperty(original, 'registerTool', {
    value: instrumentedRegister,
    configurable: true,
    writable: true,
  });

  const state: InstallationState = {
    recordConsent,
    references: 1,
    restore() {
      for (const cleanup of withdrawalCleanups) cleanup();
      if (ownRegisterDescriptor)
        Object.defineProperty(original, 'registerTool', ownRegisterDescriptor);
      else delete (original as { registerTool?: unknown }).registerTool;
    },
  };
  installations.set(original, state);
  return installationHandle(original, state);
}
