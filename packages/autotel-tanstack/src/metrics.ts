/**
 * Performance metrics collection for TanStack Start
 *
 * Provides utilities to collect and expose performance metrics
 * following the patterns from TanStack Start observability guide.
 */

/**
 * Performance timing data
 */
export interface TimingStats {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
}

/**
 * Metrics collector for performance data
 *
 * Collects timing metrics and provides statistical analysis.
 * Thread-safe for concurrent access.
 *
 * @example
 * ```typescript
 * import { metricsCollector } from 'autotel-tanstack/metrics';
 *
 * // Record a timing
 * metricsCollector.recordTiming('serverFn.getUser', 150);
 *
 * // Get stats
 * const stats = metricsCollector.getStats('serverFn.getUser');
 * console.log(`Average: ${stats.avg}ms, P95: ${stats.p95}ms`);
 * ```
 */
class MetricsCollector {
  private metrics = new Map<string, number[]>();
  private readonly maxSamples = 1000; // Limit memory usage

  /**
   * Record a timing measurement
   */
  recordTiming(name: string, duration: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const timings = this.metrics.get(name)!;
    timings.push(duration);

    // Limit samples to prevent memory issues
    if (timings.length > this.maxSamples) {
      timings.shift(); // Remove oldest
    }
  }

  /**
   * Get statistics for a metric
   */
  getStats(name: string): TimingStats | null {
    const timings = this.metrics.get(name);
    if (!timings || timings.length === 0) {
      return null;
    }

    const sorted = [...timings].toSorted((a, b) => a - b);
    const sum = timings.reduce((a, b) => a + b, 0);

    return {
      count: timings.length,
      avg: sum / timings.length,
      p50: sorted.at(Math.floor(sorted.length * 0.5)) ?? 0,
      p95: sorted.at(Math.floor(sorted.length * 0.95)) ?? 0,
      min: sorted[0] ?? 0,
      max: sorted.at(-1) ?? 0,
    };
  }

  /**
   * Get all collected metrics
   */
  getAllStats(): Record<string, TimingStats> {
    const stats: Record<string, TimingStats> = {};
    for (const [name] of this.metrics) {
      const stat = this.getStats(name);
      if (stat) {
        stats[name] = stat;
      }
    }
    return stats;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
  }

  /**
   * Reset a specific metric
   */
  resetMetric(name: string): void {
    this.metrics.delete(name);
  }
}

/**
 * Global metrics collector instance
 */
export const metricsCollector = new MetricsCollector();

/**
 * Helper to create a metrics endpoint handler
 *
 * Returns a handler that exposes metrics in JSON format.
 * Use this to create a `/metrics` endpoint.
 *
 * @example
 * ```typescript
 * // routes/metrics.ts
 * import { createFileRoute } from '@tanstack/react-router';
 * import { json } from '@tanstack/react-start';
 * import { createMetricsHandler } from 'autotel-tanstack/metrics';
 *
 * export const Route = createFileRoute('/metrics')({
 *   server: {
 *     handlers: {
 *       GET: createMetricsHandler(),
 *     },
 *   },
 * });
 * ```
 */
export function createMetricsHandler() {
  return async () => {
    const { json } = await import('@tanstack/react-start');

    return json({
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      },
      application: metricsCollector.getAllStats(),
    });
  };
}

/**
 * Auto-record timing from a function execution
 *
 * Wraps a function to automatically record its execution time.
 *
 * @example
 * ```typescript
 * import { recordTiming } from 'autotel-tanstack/metrics';
 *
 * const getUser = createServerFn({ method: 'GET' })
 *   .handler(recordTiming('serverFn.getUser', async ({ data: id }) => {
 *     return await db.users.findUnique({ where: { id } });
 *   }));
 * ```
 */
export function recordTiming<T extends (...args: any[]) => any>(
  metricName: string,
  fn: T,
): T {
  return (async (...args: Parameters<T>) => {
    const startTime = Date.now();
    try {
      const result = await fn(...args);
      const duration = Date.now() - startTime;
      metricsCollector.recordTiming(metricName, duration);
      return result as ReturnType<T>;
    } catch (error) {
      const duration = Date.now() - startTime;
      metricsCollector.recordTiming(`${metricName}.error`, duration);
      throw error;
    }
  }) as T;
}
