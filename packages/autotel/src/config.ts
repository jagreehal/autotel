/**
 * Global configuration for OpenTelemetry decorators
 *
 * Allows users to inject custom loggers, tracers, and meters
 * while maintaining sensible defaults.
 */

import { trace, metrics, type Tracer, type Meter } from '@opentelemetry/api';
import { getAutotelTracer } from './tracer-provider';

export type { ILogger } from './logger';

/**
 * Environment-based feature flags for performance optimization
 *
 * Disables expensive features in development while maintaining
 * full observability in production.
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_DEV = process.env.NODE_ENV === 'development';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const IS_TEST = process.env.NODE_ENV === 'test';

export const FEATURE_FLAGS = {
  /** Enable full auto-instrumentation (expensive, production only) */
  ENABLE_AUTO_INSTRUMENTATION:
    IS_PRODUCTION && process.env.autotel_AUTO_INSTRUMENT !== 'false',

  /** Enable verbose logging (development only) */
  ENABLE_VERBOSE_LOGGING: IS_DEV || process.env.autotel_VERBOSE === 'true',

  /** Enable metrics collection (production only) */
  ENABLE_METRICS_BY_DEFAULT:
    IS_PRODUCTION && process.env.autotel_METRICS !== 'false',

  /** Enable async resource detection (production only) */
  ENABLE_RESOURCE_DETECTION:
    IS_PRODUCTION && process.env.autotel_RESOURCE_DETECTION === 'true',

  /** Enable tracing in all environments (can be disabled via autotel_TRACING=false) */
  ENABLE_TRACING: process.env.autotel_TRACING !== 'false',

  /** Enable log redaction for sensitive fields (can be disabled via autotel_REDACTION=false) */
  ENABLE_REDACTION: process.env.autotel_REDACTION !== 'false',
} as const;

/**
 * Runtime configuration for OpenTelemetry instrumentation
 *
 * This configures the tracer and meter used by autotel's functional API.
 * Use `configure()` to set custom tracer/meter instances.
 */
export interface RuntimeConfig {
  /**
   * Tracer name for OpenTelemetry
   * @default 'app'
   */
  tracerName?: string;

  /**
   * Meter name for OpenTelemetry metrics
   * @default 'app'
   */
  meterName?: string;

  /**
   * Custom tracer instance (for advanced use cases like Datadog direct)
   * @default trace.getTracer(tracerName)
   */
  tracer?: Tracer;

  /**
   * Custom meter instance
   * @default metrics.getMeter(meterName)
   */
  meter?: Meter;
}

/**
 * Internal configuration state
 */
class Config {
  private config: Required<RuntimeConfig> = {
    tracerName: 'app',
    meterName: 'app',
    tracer: getAutotelTracer('app'),
    meter: metrics.getMeter('app'),
  };

  /**
   * Get feature flags
   */
  get featureFlags() {
    return FEATURE_FLAGS;
  }

  /**
   * Update global configuration
   */
  configure(options: RuntimeConfig): void {
    if (options.tracerName) {
      this.config.tracerName = options.tracerName;
      this.config.tracer = getAutotelTracer(options.tracerName);
    }
    if (options.meterName) {
      this.config.meterName = options.meterName;
      this.config.meter = metrics.getMeter(options.meterName);
    }
    if (options.tracer) {
      this.config.tracer = options.tracer;
    }
    if (options.meter) {
      this.config.meter = options.meter;
    }
  }

  /**
   * Get current configuration
   */
  get(): Required<RuntimeConfig> {
    return this.config;
  }

  /**
   * Reset to defaults (mainly for testing)
   */
  reset(): void {
    this.config = {
      tracerName: 'app',
      meterName: 'app',
      tracer: trace.getTracer('app'),
      meter: metrics.getMeter('app'),
    };
  }
}

const globalConfig = new Config();

/**
 * Configure global instrumentation behavior
 *
 * @example
 * ```typescript
 * import { configure } from 'autotel/config'
 *
 * configure({
 *   tracerName: 'my-app'
 * })
 * ```
 */
export function configure(options: RuntimeConfig): void {
  globalConfig.configure(options);
}

/**
 * Get current configuration (internal use)
 */
export function getConfig(): Required<RuntimeConfig> & {
  featureFlags: typeof FEATURE_FLAGS;
} {
  return {
    ...globalConfig.get(),
    featureFlags: FEATURE_FLAGS,
  };
}

/**
 * Reset configuration to defaults (internal use - mainly for testing)
 */
export function resetConfig(): void {
  globalConfig.reset();
}
