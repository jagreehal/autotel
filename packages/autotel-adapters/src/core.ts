import {
  createDrainPipeline,
  createStructuredError,
  getRequestLogger,
  parseError,
  type ParsedError,
  type RequestLogger,
  type RequestLoggerOptions,
  type RequestLogSnapshot,
  type DrainPipelineOptions,
  type PipelineDrainFn,
  type StructuredError,
  type StructuredErrorInput,
} from 'autotel';

export interface AdapterUseLoggerOptions<TContext> {
  adapterName: string;
  enrich?: (context: TContext) => Record<string, unknown> | undefined;
}

export interface AdapterToolkit<TContext> {
  useLogger: (
    context?: TContext,
    options?: RequestLoggerOptions,
  ) => RequestLogger;
  parseError: (error: unknown) => ParsedError;
  createStructuredError: (input: StructuredErrorInput) => StructuredError;
  createDrainPipeline: <T = unknown>(
    options?: DrainPipelineOptions<T>,
  ) => (drain: (batch: T[]) => void | Promise<void>) => PipelineDrainFn<T>;
}

export function createUseLogger<TContext = unknown>(
  options: AdapterUseLoggerOptions<TContext>,
) {
  return function useLogger(
    context?: TContext,
    requestLoggerOptions?: RequestLoggerOptions,
  ): RequestLogger {
    let logger: RequestLogger;
    try {
      logger = getRequestLogger(undefined, requestLoggerOptions);
    } catch {
      throw new Error(
        `[autotel-adapters/${options.adapterName}] No active trace context. ` +
          `Wrap your handler with autotel trace instrumentation before calling useLogger().`,
      );
    }

    if (context && options.enrich) {
      const extra = options.enrich(context);
      if (extra && Object.keys(extra).length > 0) {
        logger.set(extra);
      }
    }

    return logger;
  };
}

export function createAdapterToolkit<TContext = unknown>(
  options: AdapterUseLoggerOptions<TContext>,
): AdapterToolkit<TContext> {
  return {
    useLogger: createUseLogger(options),
    parseError,
    createStructuredError,
    createDrainPipeline,
  };
}

export type HeadersLike =
  | { get(name: string): string | null }
  | Record<string, string | undefined>;

export function getHeader(
  headers: HeadersLike | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if ('get' in headers && typeof headers.get === 'function') {
    return headers.get(name) ?? undefined;
  }
  const dictionary = headers as Record<string, string | undefined>;
  const value = dictionary[name] ?? dictionary[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

export type {
  RequestLogger,
  RequestLoggerOptions,
  RequestLogSnapshot,
  ParsedError,
  StructuredError,
  StructuredErrorInput,
  DrainPipelineOptions,
  PipelineDrainFn,
};
