import type { AsyncLocalStorage } from 'node:async_hooks';
import {
  getRequestLogger,
  trace,
  type ParsedError,
  type RequestLogger,
  type RequestLoggerOptions,
  type RequestLogSnapshot,
  type DrainPipelineOptions,
  type PipelineDrainFn,
  type StructuredError,
  type StructuredErrorInput,
} from 'autotel';
import {
  mergeRequestLoggerOptions,
  shouldInstrumentPath,
  type RouteAdapterOptions,
} from './toolkit/middleware';
import {
  toRouteAdapterOptions,
  type FrameworkHandlerOptions,
  type IntegratedCompletionOptions,
} from './toolkit/integration';

export { toRouteAdapterOptions };
export type {
  RouteAdapterOptions,
  FrameworkHandlerOptions,
  IntegratedCompletionOptions,
};
export type BaseAdapterOptions = RouteAdapterOptions;

export interface AdapterUseLoggerOptions<TContext> {
  adapterName: string;
  enrich?: (context: TContext) => Record<string, unknown> | undefined;
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

export interface RequestRunnerOptions extends RouteAdapterOptions {
  requestLoggerOptions?: RequestLoggerOptions;
  /** HTTP route used for include/exclude filtering. */
  path?: string;
  /** Emit one wide event automatically when the handler settles. Default `true`. */
  autoEmit?: boolean;
  /** Fields merged into the wide event at emit time (e.g. response status). */
  finalize?: () => Record<string, unknown> | undefined;
}

/**
 * Build a request runner bound to one framework's logger storage. The returned
 * function opens a span, creates a request logger, runs `handler` inside the
 * storage so `useLogger()` resolves it, records thrown errors, and emits one
 * wide event when the handler settles (unless `autoEmit` is `false`).
 */
export function createRequestRunner(storage: AsyncLocalStorage<RequestLogger>) {
  return function runRequest<T>(
    spanName: string,
    enrich: (log: RequestLogger) => void,
    handler: () => T | Promise<T>,
    options?: RequestRunnerOptions,
  ): Promise<T> {
    if (options?.path && !shouldInstrumentPath(options.path, options)) {
      return Promise.resolve(handler());
    }

    const loggerOptions = mergeRequestLoggerOptions(
      options?.requestLoggerOptions,
      options?.waitUntil,
    );

    const wrapped = trace(
      { name: spanName },
      (ctx) => async (): Promise<T> => {
        const log = getRequestLogger(ctx, loggerOptions);
        enrich(log);
        try {
          return await storage.run(log, () => handler());
        } catch (error) {
          log.error(error instanceof Error ? error : new Error(String(error)));
          throw error;
        } finally {
          if (options?.autoEmit !== false) {
            log.emitNow(options?.finalize?.());
          }
        }
      },
    );
    return wrapped();
  };
}

/**
 * Description of a single adapter config field. `env` is the ordered list of
 * environment variables to fall back to.
 */
export interface ConfigField<T> {
  key: keyof T & string;
  env?: string[];
}

function resolveEnv(envKeys?: string[]): string | undefined {
  if (!envKeys) return undefined;
  for (const key of envKeys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

/**
 * Returns true when at least one env-backed field is not provided via
 * `overrides`, meaning runtime config may still contribute and should be
 * probed to preserve precedence (`overrides > runtime > env`).
 *
 * @example
 * ```ts
 * const FIELDS: ConfigField<MyAdapterConfig>[] = [
 *   { key: 'token', env: ['MY_ADAPTER_TOKEN'] },
 *   { key: 'endpoint', env: ['MY_ADAPTER_URL'] },
 * ]
 *
 * if (shouldProbeRuntime(FIELDS, overrides)) {
 *   runtimeConfig = await loadRuntimeConfig()
 * }
 * ```
 */
export function shouldProbeRuntime<T>(
  fields: ConfigField<T>[],
  overrides?: Partial<T>,
): boolean {
  return fields.some(({ key, env }) => {
    if (!env || env.length === 0) return false;
    if (overrides?.[key] !== undefined) return false;
    return true;
  });
}

/**
 * Resolve adapter configuration with the standard priority chain:
 *
 * 1. `overrides` passed to the adapter factory
 * 2. `runtimeConfig.autotel.{namespace}.{key}` (if a probe was performed)
 * 3. `runtimeConfig.{namespace}.{key}` (if a probe was performed)
 * 4. `process.env[envKey]` for each env in `field.env`
 *
 * Pass an async `probe` to defer the runtime config lookup so it is only
 * invoked when runtime resolution is needed (i.e. at least one env-backed
 * field is not set by overrides). Adapters that have no probe target may pass
 * `() => Promise.resolve(undefined)`.
 */
export async function resolveAdapterConfig<T>(
  namespace: string,
  fields: ConfigField<T>[],
  overrides: Partial<T> | undefined,
  probe: () => Promise<Record<string, any> | undefined>,
): Promise<Partial<T>> {
  const runtimeConfig = shouldProbeRuntime(fields, overrides)
    ? await probe()
    : undefined;
  const autotelNs = runtimeConfig?.autotel?.[namespace];
  const rootNs = runtimeConfig?.[namespace];

  const config: Record<string, unknown> = {};
  for (const { key, env } of fields) {
    config[key] =
      overrides?.[key] ??
      autotelNs?.[key] ??
      rootNs?.[key] ??
      resolveEnv(env);
  }

  return config as Partial<T>;
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
