/**
 * Circuit breaker for event subscribers
 *
 * Prevents cascading failures by fast-failing when an (subscriber) is unhealthy.
 * Uses the circuit breaker pattern with three states:
 * - CLOSED: Normal operation ((subscriber) working)
 * - OPEN: Fast-fail mode ((subscriber) down)
 * - HALF_OPEN: Testing if (subscriber) recovered
 */

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time to wait before trying again in ms (default: 30000 = 30s) */
  resetTimeout: number;
  /** Time window for counting failures in ms (default: 60000 = 1min) */
  windowSize: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30_000, // 30 seconds
  windowSize: 60_000, // 1 minute
};

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export const CircuitState = {
  CLOSED: 'CLOSED' as const, // Normal operation
  OPEN: 'OPEN' as const, // Fast-fail mode
  HALF_OPEN: 'HALF_OPEN' as const, // Testing recovery
} as const;

interface FailureRecord {
  timestamp: number;
  error: string;
}

/**
 * Circuit breaker implementation
 *
 * Tracks failures and automatically opens the circuit to prevent
 * overwhelming failing subscribers.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: FailureRecord[] = [];
  private lastFailureTime: number = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function with circuit breaker protection
   * Throws CircuitOpenError if circuit is open
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      // Check if we should transition to half-open
      const now = Date.now();
      if (now - this.lastFailureTime >= this.config.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new CircuitOpenError(
          `Circuit breaker is OPEN for ${this.name}. ` +
            `Will retry in ${Math.ceil((this.config.resetTimeout - (now - this.lastFailureTime)) / 1000)}s`,
        );
      }
    }

    try {
      const result = await fn();

      // Success! Close circuit if it was half-open
      if (this.state === CircuitState.HALF_OPEN) {
        this.reset();
      }

      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Record a failure and potentially open the circuit
   */
  private recordFailure(error: unknown): void {
    const now = Date.now();

    // Remove old failures outside the time window
    this.failures = this.failures.filter(
      (f) => now - f.timestamp < this.config.windowSize,
    );

    // Record new failure
    this.failures.push({
      timestamp: now,
      error: error instanceof Error ? error.message : String(error),
    });

    this.lastFailureTime = now;

    // Check if we should open the circuit
    if (this.failures.length >= this.config.failureThreshold) {
      if (this.state === CircuitState.HALF_OPEN) {
        // Failed during test - reopen circuit
        this.state = CircuitState.OPEN;
      } else if (this.state === CircuitState.CLOSED) {
        // Too many failures - open circuit
        this.state = CircuitState.OPEN;
      }
    }
  }

  /**
   * Reset the circuit breaker (on success)
   */
  private reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.lastFailureTime = 0;
  }

  /**
   * Get current state (for monitoring)
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get failure count in current window
   */
  getFailureCount(): number {
    const now = Date.now();
    // Clean up old failures
    this.failures = this.failures.filter(
      (f) => now - f.timestamp < this.config.windowSize,
    );
    return this.failures.length;
  }

  /**
   * Get recent failures (for debugging)
   */
  getRecentFailures(): FailureRecord[] {
    const now = Date.now();
    return this.failures.filter(
      (f) => now - f.timestamp < this.config.windowSize,
    );
  }

  /**
   * Manually reset the circuit breaker (for testing or manual intervention)
   */
  forceReset(): void {
    this.reset();
  }

  /**
   * Manually open the circuit (for testing or manual intervention)
   */
  forceOpen(): void {
    this.state = CircuitState.OPEN;
    this.lastFailureTime = Date.now();
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
