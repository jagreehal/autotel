export interface DrainPipelineOptions<T = unknown> {
  batch?: {
    /** Maximum events per batch. @default 50 */
    size?: number;
    /** Max time an event can stay buffered before flush. @default 5000 */
    intervalMs?: number;
  };
  retry?: {
    /** Total attempts including first try. @default 3 */
    maxAttempts?: number;
    /** Delay strategy between attempts. @default 'exponential' */
    backoff?: 'exponential' | 'linear' | 'fixed';
    /** Base delay for first retry. @default 1000 */
    initialDelayMs?: number;
    /** Max delay cap. @default 30000 */
    maxDelayMs?: number;
    /** Add random jitter to delays. @default true */
    jitter?: boolean;
  };
  /** Max buffered events before dropping. @default 1000 */
  maxBufferSize?: number;
  /** Overflow policy. @default 'oldest' */
  dropPolicy?: 'oldest' | 'newest';
  /** Called when events are dropped from overflow or exhausted retries. */
  onDropped?: (events: T[], error?: Error) => void;
}

export interface PipelineDrainFn<T> {
  (ctx: T): void;
  /** Flush all buffered events. */
  flush: () => Promise<void>;
  /** Flush and stop scheduling future timer work. */
  shutdown: () => Promise<void>;
  readonly pending: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export function createDrainPipeline<T = unknown>(
  options?: DrainPipelineOptions<T>,
): (drain: (batch: T[]) => void | Promise<void>) => PipelineDrainFn<T> {
  const batchSize = options?.batch?.size ?? 50;
  const intervalMs = options?.batch?.intervalMs ?? 5000;
  const maxBufferSize = options?.maxBufferSize ?? 1000;
  const maxAttempts = options?.retry?.maxAttempts ?? 3;
  const backoff = options?.retry?.backoff ?? 'exponential';
  const initialDelayMs = options?.retry?.initialDelayMs ?? 1000;
  const maxDelayMs = options?.retry?.maxDelayMs ?? 30_000;
  const jitter = options?.retry?.jitter ?? true;
  const dropPolicy = options?.dropPolicy ?? 'oldest';
  const onDropped = options?.onDropped;

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error(
      `[autotel/drain-pipeline] batch.size must be a positive finite number, got: ${batchSize}`,
    );
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `[autotel/drain-pipeline] batch.intervalMs must be a positive finite number, got: ${intervalMs}`,
    );
  }
  if (!Number.isFinite(maxBufferSize) || maxBufferSize <= 0) {
    throw new Error(
      `[autotel/drain-pipeline] maxBufferSize must be a positive finite number, got: ${maxBufferSize}`,
    );
  }
  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    throw new Error(
      `[autotel/drain-pipeline] retry.maxAttempts must be a positive finite number, got: ${maxAttempts}`,
    );
  }

  return (drain: (batch: T[]) => void | Promise<void>): PipelineDrainFn<T> => {
    const buffer: T[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let activeFlush: Promise<void> | null = null;
    let isShutdown = false;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const computeDelay = (attempt: number): number => {
      const base =
        backoff === 'fixed'
          ? initialDelayMs
          : backoff === 'linear'
            ? initialDelayMs * attempt
            : initialDelayMs * 2 ** (attempt - 1);

      const bounded = Math.min(base, maxDelayMs);
      if (!jitter || bounded <= 0) return bounded;
      const factor = 0.5 + Math.random(); // [0.5, 1.5)
      return Math.max(0, Math.round(bounded * factor));
    };

    const sendWithRetry = async (batch: T[]): Promise<void> => {
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await drain(batch);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < maxAttempts) {
            await wait(computeDelay(attempt));
          }
        }
      }
      onDropped?.(batch, lastError);
    };

    const drainBuffer = async (): Promise<void> => {
      while (buffer.length > 0) {
        const batch = buffer.splice(0, batchSize);
        await sendWithRetry(batch);
      }
    };

    const scheduleFlush = () => {
      if (isShutdown || timer || activeFlush) return;
      timer = setTimeout(() => {
        timer = null;
        startFlush();
      }, intervalMs);
      timer.unref?.();
    };

    const startFlush = () => {
      if (activeFlush || isShutdown) return;
      activeFlush = drainBuffer().finally(() => {
        activeFlush = null;
        if (isShutdown) return;
        if (buffer.length >= batchSize) {
          startFlush();
        } else if (buffer.length > 0) {
          scheduleFlush();
        }
      });
    };

    const push = (ctx: T) => {
      if (isShutdown) return;

      if (buffer.length >= maxBufferSize) {
        if (dropPolicy === 'newest') {
          onDropped?.([ctx]);
          return;
        }
        const dropped = buffer.splice(0, 1);
        onDropped?.(dropped);
      }

      buffer.push(ctx);
      if (buffer.length >= batchSize) {
        clearTimer();
        startFlush();
      } else {
        scheduleFlush();
      }
    };

    const flush = async (): Promise<void> => {
      clearTimer();
      if (activeFlush) await activeFlush;

      const snapshot = buffer.length;
      if (snapshot <= 0) return;
      const toFlush = buffer.splice(0, snapshot);
      while (toFlush.length > 0) {
        const batch = toFlush.splice(0, batchSize);
        await sendWithRetry(batch);
      }
    };

    const shutdown = async (): Promise<void> => {
      isShutdown = true;
      await flush();
    };

    const fn = push as PipelineDrainFn<T>;
    fn.flush = flush;
    fn.shutdown = shutdown;
    Object.defineProperty(fn, 'pending', {
      enumerable: true,
      get: () => buffer.length,
    });
    return fn;
  };
}
