import { describeResult, diffAnnotations } from './describe';

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
  if (!original) return { uninstall() {} };

  const existing = installations.get(original);
  if (existing) {
    existing.references += 1;
    return installationHandle(original, existing);
  }

  const emit = options.span;
  const capture = options.capturePayloads ?? false;
  const maxLength = options.maxPayloadLength ?? DEFAULT_MAX_PAYLOAD;
  const isErrorResult = options.isErrorResult;
  const installationId = newInstallationId();
  const withdrawalCleanups: Array<() => void> = [];

  const wrapExecute =
    (name: string, execute: (input: unknown, opts: unknown) => unknown) =>
    (input: unknown, opts: unknown) =>
      emit('webmcp.tool.execute', (span) => {
        span.setAttribute('webmcp.installation.id', installationId);
        span.setAttribute('webmcp.tool.name', name);
        span.setAttribute('gen_ai.operation.name', 'execute_tool');
        span.setAttribute('gen_ai.tool.name', name);
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
          // Return the already-serialised value to the browser. Chrome passes
          // strings through, so this preserves the agent-visible result while
          // avoiding a second JSON.stringify() over stateful getters/toJSON().
          return described.serialized;
        };

        const result = execute(input, opts);
        return isThenable(result)
          ? Promise.resolve(result).then(record)
          : record(result);
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
      if (sent)
        span.setAttribute(
          'webmcp.annotations.sent',
          Object.keys(sent).join(','),
        );

      const outcome = await Reflect.apply(nativeRegister, original, [
        instrumented,
        registerOptions,
      ]);

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
