/**
 * Pino-compatible structured logger for edge environments.
 *
 * Supports the practical Pino surface used by app code:
 * - Pino-style `LogFn` calls: string-first, object-first, and error-first
 * - Child loggers, level control, custom levels, and `msgPrefix`
 * - Serializers, formatters, mixins, redaction, and browser-style `transmit`
 * - Trace context injection (`traceId`, `spanId`, `correlationId`)
 * - Worker-safe EventEmitter-like methods for `level-change`
 *
 * The implementation stays dependency-light and console/write based so it
 * works in Cloudflare Workers and similar edge runtimes.
 */

import {
  trace,
  context as api_context,
  createContextKey,
} from '@opentelemetry/api';
import { createRedactor, type RedactorConfig } from './redact';

export type LogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'silent';
type LogAttrs = Record<string, any>;
type LevelWithSilentOrString = LogLevel | (string & {});
type SerializerFn = (value: any) => any;
type LevelFormatter = (label: string, number: number) => object;
type BindingsFormatter = (bindings: LogAttrs) => object;
type LogFormatter = (object: Record<string, unknown>) => Record<string, unknown>;
type MixinFn = (mergeObject: object, level: number, logger: EdgeLogger) => object;
type MixinMergeStrategyFn = (mergeObject: object, mixinObject: object) => object;
type PlaceholderSpecifier = 'd' | 's' | 'j' | 'o' | 'O';
type PlaceholderTypeMapping<T extends PlaceholderSpecifier> = T extends 'd'
  ? number
  : T extends 's'
    ? unknown
    : T extends 'j' | 'o' | 'O'
      ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {} | null
      : never;
type ParseLogFnArgs<T, Acc extends unknown[] = []> =
  T extends `${infer _}%${infer Placeholder}${infer Rest}`
    ? Placeholder extends PlaceholderSpecifier
      ? ParseLogFnArgs<Rest, [...Acc, PlaceholderTypeMapping<Placeholder>]>
      : ParseLogFnArgs<Rest, Acc>
    : Acc;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LogFnFields {}
type LogFn = {
  <TMsg extends string = string>(msg: TMsg, ...args: ParseLogFnArgs<TMsg>): void;
  <T, TMsg extends string = string>(
    obj: [T] extends [object] ? T & LogFnFields : T,
    msg?: T extends string ? never : TMsg,
    ...args: ParseLogFnArgs<TMsg> | []
  ): void;
  <T, TMsg extends string = string>(
    obj: [T] extends [object] ? T & LogFnFields : T,
    msg?: T extends string ? never : TMsg,
    ...args: ParseLogFnArgs<TMsg> extends [unknown, ...unknown[]]
      ? ParseLogFnArgs<TMsg>
      : unknown[]
  ): void;
};
type ChildLoggerOptions = {
  level?: LevelWithSilentOrString;
  msgPrefix?: string;
  serializers?: Record<string, SerializerFn>;
  formatters?: {
    level?: LevelFormatter;
    bindings?: BindingsFormatter;
    log?: LogFormatter;
  };
  redact?: RedactorConfig;
};
type LevelMapping = {
  values: Record<string, number>;
  labels: Record<number, string>;
};
type LevelChangeEventListener = (
  levelLabel: LevelWithSilentOrString,
  levelValue: number,
  previousLevelLabel: LevelWithSilentOrString,
  previousLevelValue: number,
  logger: EdgeLogger,
) => void;
type OnChildCallback = (child: EdgeLogger) => void;
type EventListener = (...args: any[]) => void;
export type WriteFn = (o: object) => void;
export type TimeFn = () => string;

export interface LogEvent {
  ts: number;
  messages: any[];
  bindings: LogAttrs[];
  level: { label: string; value: number };
}

interface EdgeEventEmitter {
  addListener(event: string | symbol, listener: (...args: any[]) => any): any;
  emit(event: string | symbol, ...args: any[]): boolean;
  eventNames(): (string | symbol)[];
  getMaxListeners(): number;
  listenerCount(event: string | symbol): number;
  listeners(event: string | symbol): ((...args: any[]) => any)[];
  off(event: string | symbol, listener: (...args: any[]) => any): any;
  on(event: string | symbol, listener: (...args: any[]) => any): any;
  once(event: string | symbol, listener: (...args: any[]) => any): any;
  prependListener(event: string | symbol, listener: (...args: any[]) => any): any;
  prependOnceListener(event: string | symbol, listener: (...args: any[]) => any): any;
  rawListeners(event: string | symbol): ((...args: any[]) => any)[];
  removeAllListeners(event?: string | symbol): any;
  removeListener(event: string | symbol, listener: (...args: any[]) => any): any;
  setMaxListeners(n: number): any;
}

/**
 * Context key for storing active log level (enables per-request log levels)
 */
const LOG_LEVEL_KEY = createContextKey('autotel-edge-log-level');

export interface EdgeLogger extends EdgeEventEmitter {
  readonly version: string;
  readonly name: string | undefined;
  levels: LevelMapping;
  useLevelLabels: boolean;
  level: LevelWithSilentOrString;
  readonly levelVal: number;
  readonly msgPrefix: string | undefined;
  onChild: OnChildCallback;
  enabled: boolean;
  info: LogFn;
  error: LogFn;
  warn: LogFn;
  debug: LogFn;
  trace: LogFn;
  fatal: LogFn;
  silent: LogFn;
  /**
   * Create a child logger with merged bindings.
   * Like pino's child() — every log call from the child
   * includes the parent's attrs plus the child's bindings.
   */
  child(bindings: LogAttrs, options?: ChildLoggerOptions): EdgeLogger;
  isLevelEnabled(level: LevelWithSilentOrString): boolean;
  bindings(): LogAttrs;
  setBindings(bindings: LogAttrs): void;
  flush(cb?: (err?: Error) => void): void;
  on(event: 'level-change', listener: LevelChangeEventListener): EdgeLogger;
  addListener(
    event: 'level-change',
    listener: LevelChangeEventListener,
  ): EdgeLogger;
  once(event: 'level-change', listener: LevelChangeEventListener): EdgeLogger;
  prependListener(
    event: 'level-change',
    listener: LevelChangeEventListener,
  ): EdgeLogger;
  prependOnceListener(
    event: 'level-change',
    listener: LevelChangeEventListener,
  ): EdgeLogger;
  removeListener(
    event: 'level-change',
    listener: LevelChangeEventListener,
  ): EdgeLogger;
  [key: string]: unknown;
}

const PINO_LEVELS: LevelMapping = {
  values: {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
    silent: Infinity,
  },
  labels: {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
    [Infinity]: 'silent',
  },
};
const LOGGER_VERSION = 'autotel-edge';

/**
 * Get the active log level from context (if set)
 * Falls back to undefined if no log level is set in context
 */
export function getActiveLogLevel(): LogLevel | undefined {
  return api_context.active().getValue(LOG_LEVEL_KEY) as LogLevel | undefined;
}

/**
 * Run a function with a specific log level
 * The log level is stored in OpenTelemetry context and applies to all logger calls within the callback
 *
 * This works in edge runtimes (uses OTel context, not Node.js AsyncLocalStorage)
 *
 * @example
 * ```typescript
 * // Enable debug logging for a specific request
 * runWithLogLevel('debug', () => {
 *   log.debug('This will be logged')
 *   processRequest()
 * })
 *
 * // Disable logging temporarily
 * runWithLogLevel('silent', () => {
 *   log.info('This will NOT be logged')
 * })
 * ```
 */
export function runWithLogLevel<T>(level: LogLevel, callback: () => T): T {
  const ctx = api_context.active().setValue(LOG_LEVEL_KEY, level);
  return api_context.with(ctx, callback);
}

/**
 * Get current trace context from active span
 */
function getTraceContext(): {
  traceId: string;
  spanId: string;
  correlationId: string;
} | null {
  const span = trace.getActiveSpan();
  if (!span) return null;

  const ctx = span.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    correlationId: ctx.traceId.slice(0, 16), // First 16 chars for grouping
  };
}

function isRecord(value: unknown): value is LogAttrs {
  return typeof value === 'object' && value !== null;
}

function toErrorAttrs(error: unknown): LogAttrs {
  if (error instanceof Error) {
    return {
      error: {
        message: error.message,
        type: error.name,
        stack: error.stack,
      },
    };
  }

  return { error: { message: String(error), type: 'Error' } };
}

function formatMessage(template: string, args: unknown[]): string {
  if (args.length === 0) return template;

  let argIndex = 0;
  const formatted = template.replaceAll(/%[sdjifoO%]/g, (token) => {
    if (token === '%%') return '%';
    if (argIndex >= args.length) return token;

    const value = args[argIndex++];

    switch (token) {
      case '%d':
      case '%i':
      case '%f': {
        return String(Number(value));
      }
      case '%j': {
        try {
          return JSON.stringify(value);
        } catch {
          return '[Circular]';
        }
      }
      case '%s': {
        return String(value);
      }
      case '%o':
      case '%O': {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      default: {
        return token;
      }
    }
  });

  return formatted;
}

// ANSI color helpers (no dependencies)
const ANSI_RESET = '\u001B[0m';
const ANSI_DIM = '\u001B[2m';
const ANSI_BOLD = '\u001B[1m';
const ANSI_COLORS: Record<string, string> = {
  fatal: '\u001B[41m\u001B[37m', // white on red bg
  error: '\u001B[31m',          // red
  warn: '\u001B[33m',           // yellow
  info: '\u001B[36m',           // cyan
  debug: '\u001B[34m',          // blue
  trace: '\u001B[90m',          // gray
};
const LEVEL_SYMBOLS: Record<string, string> = {
  fatal: '✗',
  error: '✗',
  warn: '⚠',
  info: '●',
  debug: '◦',
  trace: '…',
};

function formatPrettyTimestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatPrettyAttrs(attrs: Record<string, any>): string {
  const keys = Object.keys(attrs);
  if (keys.length === 0) return '';
  return '\n' + JSON.stringify(attrs, null, 2)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function safeStringify(
  obj: unknown,
  depthLimit: number,
  edgeLimit: number,
): string {
  // Stack-based approach: track ancestors on the current path.
  // Objects are added when entered and removed when the replacer
  // moves back up, so shared (non-circular) references serialize
  // normally while true cycles produce '[Circular]'.
  const ancestors: object[] = [];

  return JSON.stringify(obj, function replacer(this: any, _key: string, value: unknown) {
    if (typeof value === 'object' && value !== null) {
      // Unwind: `this` is the object that owns the current key.
      // Pop ancestors until we find `this` (our direct parent).
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }

      // True circular reference: value is already an ancestor
      if (ancestors.includes(value as object)) return '[Circular]';

      if (ancestors.length >= depthLimit) return '[Object]';

      ancestors.push(value as object);

      if (!Array.isArray(value)) {
        const keys = Object.keys(value as Record<string, unknown>);
        if (keys.length > edgeLimit) {
          const truncated: Record<string, unknown> = {};
          for (let i = 0; i < edgeLimit; i++) {
            truncated[keys[i]] = (value as Record<string, unknown>)[keys[i]];
          }
          truncated['...'] = `[${keys.length - edgeLimit} more properties]`;
          return truncated;
        }
      }
    }
    return value;
  });
}

function parseLogArgs(args: unknown[]): { msg: string; attrs?: LogAttrs } {
  const [first, ...rest] = args;

  if (typeof first === 'string') {
    return {
      msg: formatMessage(first, rest),
      attrs: undefined,
    };
  }

  if (first instanceof Error) {
    return {
      msg:
        typeof rest[0] === 'string'
          ? formatMessage(rest[0], rest.slice(1))
          : first.message,
      attrs: toErrorAttrs(first),
    };
  }

  if (isRecord(first)) {
    return {
      msg:
        typeof rest[0] === 'string'
          ? formatMessage(rest[0], rest.slice(1))
          : '',
      attrs: first,
    };
  }

  return {
    msg: String(first ?? ''),
    attrs: undefined,
  };
}

/**
 * Create a lightweight structured logger
 *
 * @param service - Service name for logging
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * const log = createEdgeLogger('user-service')
 *
 * log.info({ email: 'test@example.com' }, 'Creating user')
 * // Output: {"level":"info","service":"user-service","msg":"Creating user",
 * //          "email":"test@example.com","traceId":"...","spanId":"..."}
 *
 * // Dynamic log level control per-request
 * runWithLogLevel('debug', () => {
 *   log.debug('This will be logged even if logger was created with level: "info"')
 * })
 * ```
 */
export type EdgeLoggerOptions = {
  level?: LevelWithSilentOrString;
  pretty?: boolean;
  bindings?: Record<string, any>;
  redact?: RedactorConfig | string[];
  msgPrefix?: string;
  useLevelLabels?: boolean;
  onChild?: OnChildCallback;
  enabled?: boolean;
  messageKey?: string;
  errorKey?: string;
  nestedKey?: string;
  serializers?: Record<string, SerializerFn>;
  formatters?: {
    level?: LevelFormatter;
    bindings?: BindingsFormatter;
    log?: LogFormatter;
  };
  mixin?: MixinFn;
  mixinMergeStrategy?: MixinMergeStrategyFn;
  customLevels?: Record<string, number>;
  useOnlyCustomLevels?: boolean;
  levelComparison?: 'ASC' | 'DESC' | ((current: number, expected: number) => boolean);
  name?: string;
  base?: Record<string, any> | null;
  timestamp?: TimeFn | boolean;
  safe?: boolean;
  crlf?: boolean;
  depthLimit?: number;
  edgeLimit?: number;
  hooks?: {
    logMethod?: (
      args: Parameters<LogFn>,
      method: LogFn,
      level: number,
    ) => void;
  };
  write?: WriteFn | ({ [level: string]: WriteFn });
  transmit?: {
    level?: LevelWithSilentOrString;
    send: (level: string, logEvent: LogEvent) => void;
  };
  /** @internal Binding chain for hierarchical transmit bindings */
  _bindingsChain?: LogAttrs[];
};

export function createEdgeLogger(
  service: string,
  options?: EdgeLoggerOptions,
): EdgeLogger {
  const customLevels: Record<string, number> = {
    ...options?.customLevels,
  };
  const availableLevels: Record<string, number> = options?.useOnlyCustomLevels
    ? { ...customLevels, silent: Infinity }
    : { ...PINO_LEVELS.values, ...customLevels };
  const defaultLevel = options?.level ?? (options?.useOnlyCustomLevels ? Object.keys(customLevels)[0] : 'info') ?? 'info';
  let currentLevel = defaultLevel as LevelWithSilentOrString;
  const pretty = options?.pretty || false;
  const currentBindings = { ...options?.bindings };
  const resolvedRedact = Array.isArray(options?.redact)
    ? { paths: options.redact }
    : options?.redact;
  const redactor = resolvedRedact ? createRedactor(resolvedRedact) : null;
  const msgPrefix = options?.msgPrefix;
  const levelValues = availableLevels;
  const levelListeners: LevelChangeEventListener[] = [];
  const onChildCallback: OnChildCallback = options?.onChild ?? (() => {});
  const listeners = new Map<string | symbol, EventListener[]>();
  let maxListeners = 10;
  const messageKey = options?.messageKey ?? 'msg';
  const errorKey = options?.errorKey ?? 'err';
  const nestedKey = options?.nestedKey;
  const serializers = { ...options?.serializers };
  const bindingsFormatter = options?.formatters?.bindings;
  const levelFormatter = options?.formatters?.level;
  const logFormatter = options?.formatters?.log;
  const mixin = options?.mixin;
  const levelComparison = options?.levelComparison;
  const mixinMergeStrategy =
    options?.mixinMergeStrategy ?? ((mergeObject: object, mixinObject: object) => ({ ...mergeObject, ...mixinObject }));
  let enabled = options?.enabled ?? true;
  const loggerName = options?.name;
  const base = options?.base;
  const timestamp = options?.timestamp ?? true;
  const safe = options?.safe ?? true;
  const crlf = options?.crlf ?? false;
  const depthLimit = options?.depthLimit ?? 5;
  const edgeLimitOpt = options?.edgeLimit ?? 100;
  const hooks = options?.hooks;
  const writeFn = options?.write;
  const transmit = options?.transmit;
  const bindingsChain: LogAttrs[] = options?._bindingsChain ?? [];

  const compareLevels = (
    current: number,
    expected: number,
    comparison: 'ASC' | 'DESC' | ((current: number, expected: number) => boolean) | undefined,
  ) => {
    if (typeof comparison === 'function') return comparison(current, expected);
    if (comparison === 'DESC') return current <= expected;
    return current >= expected;
  };

  const addListener = (
    event: string | symbol,
    listener: EventListener,
    prepend = false,
  ) => {
    const activeListeners = listeners.get(event) ?? [];
    if (prepend) {
      activeListeners.unshift(listener);
    } else {
      activeListeners.push(listener);
    }
    listeners.set(event, activeListeners);
    if (event === 'level-change') {
      levelListeners.length = 0;
      levelListeners.push(
        ...(listeners.get(event) as LevelChangeEventListener[] | undefined ?? []),
      );
    }
  };

  const notifyLevelChange = (
    nextLevel: LevelWithSilentOrString,
    previousLevel: LevelWithSilentOrString,
    instance: EdgeLogger,
  ) => {
    const nextValue = levelValues[nextLevel] ?? Infinity;
    const previousValue = levelValues[previousLevel] ?? Infinity;
    const snapshot = [...levelListeners];
    for (const listener of snapshot) {
      listener(nextLevel, nextValue, previousLevel, previousValue, instance);
    }
  };

  const removeEventListener = (event: string | symbol, listener: EventListener) => {
    const activeListeners = listeners.get(event);
    if (!activeListeners) {
      return;
    }
    const index = activeListeners.indexOf(listener);
    if (index !== -1) {
      activeListeners.splice(index, 1);
    }
    if (activeListeners.length === 0) {
      listeners.delete(event);
    } else {
      listeners.set(event, activeListeners);
    }
    if (event === 'level-change') {
      levelListeners.length = 0;
      levelListeners.push(
        ...((listeners.get(event) as LevelChangeEventListener[] | undefined) ??
          []),
      );
    }
  };

  const shouldLog = (level: LevelWithSilentOrString): boolean => {
    if (!enabled) return false;

    // Priority: context level > options level > 'info' default
    const activeLevel = getActiveLogLevel() ?? currentLevel;

    // 'silent' means suppress all logging
    if (activeLevel === 'silent') return false;
    const currentValue = levelValues[activeLevel];
    const expectedValue = levelValues[level];
    if (currentValue === undefined || expectedValue === undefined) return false;

    return compareLevels(
      expectedValue,
      currentValue,
      levelComparison,
    );
  };

  const stringify = (obj: unknown): string => {
    if (safe) {
      return safeStringify(obj, depthLimit, edgeLimitOpt);
    }
    return JSON.stringify(obj);
  };

  const getTimestamp = (): string | undefined => {
    if (timestamp === false) return undefined;
    if (typeof timestamp === 'function') return timestamp();
    return new Date().toISOString();
  };

  const writeOutput = (level: LevelWithSilentOrString, logObject: Record<string, any>) => {
    if (writeFn) {
      if (typeof writeFn === 'function') {
        writeFn(logObject);
      } else if (typeof writeFn === 'object' && writeFn[level]) {
        writeFn[level](logObject);
      } else {
        console.log(stringify(logObject));
      }
    } else if (pretty) {
      return; // pretty mode handles its own output
    } else {
      const json = stringify(logObject);
      console.log(crlf ? json + '\r\n' : json);
    }
  };

  const applySerializers = (obj: Record<string, any>): Record<string, any> => {
    if (Object.keys(serializers).length === 0) return obj;
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        key in serializers ? serializers[key](value) : value,
      ]),
    );
  };

  const emitTransmit = (
    level: LevelWithSilentOrString,
    rawArgs: unknown[],
  ) => {
    if (!transmit) return;
    if (transmit.level) {
      const transmitValue = levelValues[transmit.level];
      const logValue = levelValues[level];
      if (transmitValue !== undefined && logValue !== undefined && logValue < transmitValue) {
        return;
      }
    }
    // Apply serializers then redaction to messages
    const processedMessages = rawArgs.map((m) => {
      if (typeof m !== 'object' || m === null) return m;
      const serialized = applySerializers(m as Record<string, any>);
      return redactor ? redactor(serialized) : serialized;
    });
    // Apply serializers then redaction to bindings
    const processedBindings = bindingsChain.map((b) => {
      const serialized = applySerializers({ ...b });
      return redactor ? (redactor(serialized) as LogAttrs) : serialized;
    });
    const logEvent: LogEvent = {
      ts: Date.now(),
      messages: processedMessages,
      bindings: processedBindings,
      level: { label: level, value: levelValues[level] },
    };
    transmit.send(level, logEvent);
  };

  const log = (
    level: LevelWithSilentOrString,
    msg: string,
    attrs?: Record<string, any>,
    rawArgs?: unknown[],
  ) => {
    if (!shouldLog(level)) return;

    const ctx = getTraceContext();
    const message = msgPrefix ? `${msgPrefix}${msg}` : msg;
    const baseBindings = bindingsFormatter
      ? (bindingsFormatter({ ...currentBindings }) as LogAttrs)
      : { ...currentBindings };
    const serializedAttrs = attrs
      ? Object.fromEntries(
          Object.entries(attrs).map(([key, value]) => [
            key,
            key in serializers ? serializers[key](value) : value,
          ]),
        )
      : undefined;
    const mergeObject = nestedKey
      ? ({ [nestedKey]: serializedAttrs ?? {} } as Record<string, unknown>)
      : (serializedAttrs ?? {});
    const mixinObject =
      mixin?.(mergeObject, levelValues[level], logger) ?? {};
    const mergedLogObject = mixinMergeStrategy(mergeObject, mixinObject) as Record<
      string,
      unknown
    >;
    const formattedLogObject = logFormatter
      ? logFormatter(mergedLogObject)
      : mergedLogObject;
    const formattedLevel = levelFormatter
      ? levelFormatter(level, levelValues[level])
      : {
          level: logger.useLevelLabels ? level : levelValues[level],
        };
    const ts = getTimestamp();
    const logEntry: Record<string, any> = {
      ...formattedLevel,
      ...(loggerName === undefined ? {} : { name: loggerName }),
      service,
      ...(message === '' ? {} : { [messageKey]: message }),
      ...(base === null || base === undefined ? {} : base),
      ...baseBindings,
      ...formattedLogObject,
      ...ctx, // Auto-inject traceId, spanId, correlationId
      ...(ts === undefined ? {} : { timestamp: ts }),
    };

    if (serializedAttrs && !nestedKey && errorKey !== 'error' && 'error' in logEntry) {
      logEntry[errorKey] = logEntry.error;
      delete logEntry.error;
    }

    if (pretty && !writeFn) {
      // Pretty print for development
      const color = ANSI_COLORS[level] ?? ANSI_COLORS.info;
      const symbol = LEVEL_SYMBOLS[level] ?? '●';
      const time = formatPrettyTimestamp();
      const traceInfo = ctx
        ? ` ${ANSI_DIM}[${ctx.traceId.slice(0, 8)}/${ctx.spanId.slice(0, 8)}]${ANSI_RESET}`
        : '';
      const prettyAttrs = {
        ...baseBindings,
        ...formattedLogObject,
      };
      const safeAttrs = redactor
        ? (redactor(prettyAttrs) as LogAttrs)
        : prettyAttrs;
      const attrsStr = formatPrettyAttrs(safeAttrs);
      console.log(
        `${ANSI_DIM}${time}${ANSI_RESET} ${color}${ANSI_BOLD}${symbol} ${level.toUpperCase()}${ANSI_RESET}${traceInfo} ${ANSI_DIM}(${service})${ANSI_RESET} ${message}${attrsStr}`,
      );
    } else {
      // Structured JSON for production (or custom write)
      const safeEntry = redactor ? (redactor(logEntry) as LogAttrs) : logEntry;
      writeOutput(level, safeEntry);
    }

    emitTransmit(level, rawArgs ?? []);
  };

  const makeLogMethod = (levelName: string): LogFn => {
    return ((...args: unknown[]) => {
      if (hooks?.logMethod) {
        const method = ((...methodArgs: unknown[]) => {
          const { msg, attrs } = parseLogArgs(methodArgs);
          log(levelName, msg, attrs, methodArgs);
        }) as LogFn;
        hooks.logMethod.call(logger, args as Parameters<LogFn>, method, levelValues[levelName]);
        return;
      }
      const { msg, attrs } = parseLogArgs(args);
      log(levelName, msg, attrs, args);
    }) as LogFn;
  };

  const logger: EdgeLogger = {
    version: LOGGER_VERSION,

    get name() {
      return loggerName;
    },

    levels: {
      values: levelValues,
      labels: Object.fromEntries(
        Object.entries(levelValues).map(([label, value]) => [value, label]),
      ),
    },
    useLevelLabels: options?.useLevelLabels ?? false,
    customLevels: { ...customLevels },
    useOnlyCustomLevels: options?.useOnlyCustomLevels ?? false,

    get level() {
      return currentLevel;
    },

    set level(level: LevelWithSilentOrString) {
      const previousLevel = currentLevel;
      currentLevel = level;
      notifyLevelChange(level, previousLevel, logger);
    },

    get levelVal() {
      return levelValues[currentLevel] ?? Infinity;
    },

    get msgPrefix() {
      return msgPrefix;
    },

    onChild: onChildCallback,
    get enabled() {
      return enabled;
    },

    set enabled(value: boolean) {
      enabled = value;
    },

    info: makeLogMethod('info'),

    error: makeLogMethod('error'),

    warn: makeLogMethod('warn'),

    debug: makeLogMethod('debug'),

    trace: makeLogMethod('trace'),

    fatal: makeLogMethod('fatal'),

    silent: (() => {}) as LogFn,

    child: (bindings: LogAttrs, childOptions?: ChildLoggerOptions) => {
      const childLogger = createEdgeLogger(service, {
        level: childOptions?.level ?? currentLevel,
        pretty,
        bindings: { ...currentBindings, ...bindings },
        redact: childOptions?.redact ?? options?.redact,
        msgPrefix:
          childOptions?.msgPrefix === undefined
            ? msgPrefix
            : `${msgPrefix ?? ''}${childOptions.msgPrefix}`,
        useLevelLabels: logger.useLevelLabels,
        onChild: onChildCallback,
        enabled,
        messageKey,
        errorKey,
        nestedKey,
        serializers: { ...serializers, ...childOptions?.serializers },
        formatters: {
          level: childOptions?.formatters?.level ?? levelFormatter,
          bindings: childOptions?.formatters?.bindings ?? bindingsFormatter,
          log: childOptions?.formatters?.log ?? logFormatter,
        },
        mixin,
        mixinMergeStrategy,
        customLevels,
        useOnlyCustomLevels: options?.useOnlyCustomLevels,
        levelComparison: options?.levelComparison,
        name: loggerName,
        base,
        timestamp,
        safe,
        crlf,
        depthLimit,
        edgeLimit: edgeLimitOpt,
        hooks,
        write: writeFn,
        transmit,
        _bindingsChain: [...bindingsChain, bindings],
      });
      onChildCallback(childLogger);
      return childLogger;
    },

    isLevelEnabled: (level: LevelWithSilentOrString) => shouldLog(level),

    bindings: () => ({ ...currentBindings }),

    setBindings: (bindings: LogAttrs) => {
      for (const [key, value] of Object.entries(bindings)) {
        if (!(key in currentBindings)) {
          currentBindings[key] = value;
        }
      }
    },

    flush: (cb?: (err?: Error) => void) => {
      cb?.();
    },

    emit: (event: string | symbol, ...args: any[]) => {
      const activeListeners = listeners.get(event);
      if (!activeListeners || activeListeners.length === 0) {
        return false;
      }
      const snapshot = [...activeListeners];
      for (const listener of snapshot) {
        listener(...args);
      }
      return true;
    },

    eventNames: () => [...listeners.keys()],

    getMaxListeners: () => maxListeners,

    listenerCount: (event: string | symbol) => listeners.get(event)?.length ?? 0,

    listeners: (event: string | symbol) => [...(listeners.get(event) ?? [])],

    on: (event: string | symbol, listener: EventListener) => {
      addListener(event, listener);
      return logger;
    },

    addListener: (event: string | symbol, listener: EventListener) => {
      addListener(event, listener);
      return logger;
    },

    once: (event: string | symbol, listener: EventListener) => {
      const wrapped: EventListener = (...args: any[]) => {
        removeEventListener(event, wrapped);
        listener(...args);
      };
      addListener(event, wrapped);
      return logger;
    },

    prependListener: (
      event: string | symbol,
      listener: EventListener,
    ) => {
      addListener(event, listener, true);
      return logger;
    },

    prependOnceListener: (
      event: string | symbol,
      listener: EventListener,
    ) => {
      const wrapped: EventListener = (...args: any[]) => {
        removeEventListener(event, wrapped);
        listener(...args);
      };
      addListener(event, wrapped, true);
      return logger;
    },

    rawListeners: (event: string | symbol) => [...(listeners.get(event) ?? [])],

    off: (event: string | symbol, listener: EventListener) => {
      removeEventListener(event, listener);
      return logger;
    },

    removeAllListeners: (event?: string | symbol) => {
      if (event === undefined) {
        listeners.clear();
        levelListeners.length = 0;
        return logger;
      }
      listeners.delete(event);
      if (event === 'level-change') {
        levelListeners.length = 0;
      }
      return logger;
    },

    removeListener: (
      event: string | symbol,
      listener: EventListener,
    ) => {
      removeEventListener(event, listener);
      return logger;
    },

    setMaxListeners: (n: number) => {
      maxListeners = n;
      return logger;
    },
  };

  for (const levelName of Object.keys(customLevels)) {
    logger[levelName] = makeLogMethod(levelName);
  }

  return logger;
}

/**
 * Helper to get trace context (useful for BYOL - Bring Your Own Logger)
 *
 * @example
 * ```typescript
 * import bunyan from 'bunyan'
 * import { getEdgeTraceContext } from 'autotel-edge/api/logger'
 *
 * const bunyanLogger = bunyan.createLogger({ name: 'myapp' })
 * const ctx = getEdgeTraceContext()
 * bunyanLogger.info({ ...ctx, email: 'test@example.com' }, 'Creating user')
 * ```
 */
export function getEdgeTraceContext() {
  return getTraceContext();
}
