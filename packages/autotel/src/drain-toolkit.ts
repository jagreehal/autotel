export interface DrainOptions<TContext, TConfig, TPayload = TContext> {
  /** Stable identifier used in error logs. */
  name: string;
  /** Return null to skip draining (e.g. missing API key in dev). */
  resolve: () => TConfig | null | Promise<TConfig | null>;
  /** Transform contexts into payloads. Defaults to identity. */
  transform?: (contexts: TContext[]) => TPayload[];
  /** Transport implementation. */
  send: (payloads: TPayload[], config: TConfig) => Promise<void>;
}

export interface HttpDrainRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpDrainOptions<
  TContext,
  TConfig,
  TPayload = TContext,
> extends Omit<DrainOptions<TContext, TConfig, TPayload>, 'send'> {
  encode: (payloads: TPayload[], config: TConfig) => HttpDrainRequest | null;
  timeoutMs?: number;
  retries?: number;
  resolveTimeoutMs?: (config: TConfig) => number | undefined;
  resolveRetries?: (config: TConfig) => number | undefined;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRIES = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

async function postWithRetry(options: {
  name: string;
  request: HttpDrainRequest;
  timeoutMs: number;
  retries: number;
}): Promise<void> {
  const { name, request, timeoutMs, retries } = options;
  const attempts = Math.max(1, retries);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `[autotel/${name}] HTTP ${response.status} draining ${request.url}`,
        );
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(100 * attempt);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

export function defineDrain<TContext, TConfig, TPayload = TContext>(
  options: DrainOptions<TContext, TConfig, TPayload>,
): (ctx: TContext | TContext[]) => Promise<void> {
  return async (ctx: TContext | TContext[]) => {
    const contexts = Array.isArray(ctx) ? ctx : [ctx];
    if (contexts.length === 0) return;

    const config = await options.resolve();
    if (!config) return;

    const payloads = options.transform
      ? options.transform(contexts)
      : (contexts as unknown as TPayload[]);

    if (payloads.length === 0) return;

    try {
      await options.send(payloads, config);
    } catch (error) {
      console.error(`[autotel/${options.name}] drain failed:`, error);
    }
  };
}

export function defineHttpDrain<TContext, TConfig, TPayload = TContext>(
  options: HttpDrainOptions<TContext, TConfig, TPayload>,
): (ctx: TContext | TContext[]) => Promise<void> {
  return defineDrain<TContext, TConfig, TPayload>({
    name: options.name,
    resolve: options.resolve,
    transform: options.transform,
    send: async (payloads, config) => {
      const request = options.encode(payloads, config);
      if (!request) return;
      const timeoutMs =
        options.resolveTimeoutMs?.(config) ??
        options.timeoutMs ??
        DEFAULT_TIMEOUT_MS;
      const retries =
        options.resolveRetries?.(config) ?? options.retries ?? DEFAULT_RETRIES;

      await postWithRetry({
        name: options.name,
        request,
        timeoutMs,
        retries,
      });
    },
  });
}
