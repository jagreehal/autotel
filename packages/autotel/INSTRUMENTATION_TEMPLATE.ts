/**
 * Custom Instrumentation Template
 *
 * This template provides a starting point for instrumenting any library
 * with OpenTelemetry using autotel utilities.
 *
 * Instructions:
 * 1. Replace "MyLibrary" with your library name
 * 2. Update the interface to match your library's API
 * 3. Customize span attributes to match OpenTelemetry semantic conventions
 * 4. Add any library-specific configuration options
 * 5. Test thoroughly with error cases and edge conditions
 *
 * @example Usage
 * ```typescript
 * import { instrumentMyLibrary } from './my-library-instrumentation'
 * import { MyLibrary } from 'my-library'
 *
 * const client = new MyLibrary(config)
 * instrumentMyLibrary(client, { captureDetails: true })
 *
 * // All operations are now traced
 * await client.someOperation()
 * ```
 */

import { trace, SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api';
import { runWithSpan, finalizeSpan } from 'autotel/trace-helpers';

// ============================================================================
// STEP 1: Define Configuration Interface
// ============================================================================

/**
 * Configuration options for MyLibrary instrumentation.
 */
export interface InstrumentMyLibraryConfig {
  /**
   * Custom tracer name. Defaults to "my-library-instrumentation".
   */
  tracerName?: string;

  /**
   * Whether to capture detailed operation data in spans.
   * Be careful not to capture sensitive information (PII, credentials, etc.)
   * Defaults to false for security.
   */
  captureDetails?: boolean;

  /**
   * Maximum length for captured text fields. Longer values will be truncated.
   * Defaults to 500 characters.
   */
  maxDetailLength?: number;

  /**
   * Add any library-specific configuration options here.
   * Examples: connection info, operation filtering, custom attributes, etc.
   */
}

// ============================================================================
// STEP 2: Create Instrumentation Flag
// ============================================================================

/**
 * Symbol to mark instrumented clients and prevent double-instrumentation.
 * Using Symbol ensures no name collisions with library properties.
 */
const INSTRUMENTED_FLAG = Symbol('myLibraryInstrumented');

/**
 * Type extension to track instrumentation status.
 */
interface InstrumentedClient {
  [INSTRUMENTED_FLAG]?: boolean;
}

// ============================================================================
// STEP 3: Define Client Interface
// ============================================================================

/**
 * Interface matching the library you want to instrument.
 * Update this to match your library's actual API.
 */
interface MyLibraryClient extends InstrumentedClient {
  // Example: HTTP client
  request?: (url: string, options?: any) => Promise<any>;

  // Example: Database client
  query?: (sql: string, params?: any[]) => Promise<any>;

  // Example: Message queue
  send?: (topic: string, message: any) => Promise<void>;

  // Add the methods you want to instrument
  [key: string]: any; // Allow other properties
}

// ============================================================================
// STEP 4: Helper Functions
// ============================================================================

/**
 * Sanitizes and truncates text for safe inclusion in spans.
 * Use this to prevent PII leakage and control span size.
 */
function sanitizeText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.substring(0, maxLength)}...`;
}

/**
 * Creates common span attributes following OpenTelemetry semantic conventions.
 * See: https://opentelemetry.io/docs/specs/semconv/
 */
function createBaseAttributes(
  operation: string,
  config?: InstrumentMyLibraryConfig,
): Record<string, string | number> {
  const attributes: Record<string, string | number> = {
    // Use standard OpenTelemetry semantic conventions
    // Examples for different library types:

    // HTTP client:
    // 'http.method': method,
    // 'http.url': url,

    // Database:
    // 'db.system': 'postgresql',
    // 'db.operation': operation,

    // Messaging:
    // 'messaging.system': 'kafka',
    // 'messaging.operation': operation,

    // Generic:
    'code.function': operation,
  };

  return attributes;
}

// ============================================================================
// STEP 5: Main Instrumentation Function
// ============================================================================

/**
 * Instruments MyLibrary client with OpenTelemetry tracing.
 *
 * This function wraps client methods to create spans for each operation.
 * The instrumentation is idempotent - calling it multiple times on the same
 * client will only instrument it once.
 *
 * @param client - The library client to instrument
 * @param config - Optional configuration for instrumentation behavior
 * @returns The instrumented client (same instance, modified in place)
 *
 * @example
 * ```typescript
 * import { MyLibrary } from 'my-library'
 * import { instrumentMyLibrary } from './my-library-instrumentation'
 *
 * const client = new MyLibrary({ url: 'http://api.example.com' })
 * instrumentMyLibrary(client, {
 *   captureDetails: true,
 *   maxDetailLength: 1000
 * })
 *
 * // All operations are now traced
 * await client.request('/users')
 * ```
 */
export function instrumentMyLibrary<TClient extends MyLibraryClient>(
  client: TClient,
  config?: InstrumentMyLibraryConfig,
): TClient {
  // Validate input
  if (!client) {
    return client;
  }

  // Check if already instrumented (idempotent)
  if (client[INSTRUMENTED_FLAG]) {
    return client;
  }

  // Extract configuration with defaults
  const {
    tracerName = 'my-library-instrumentation',
    captureDetails = false,
    maxDetailLength = 500,
  } = config ?? {};

  // Get tracer instance
  const tracer = trace.getTracer(tracerName);

  // ============================================================================
  // STEP 6: Instrument Each Method
  // ============================================================================

  // Example: Instrument request method
  if (typeof client.request === 'function') {
    const originalRequest = client.request.bind(client);

    client.request = async function instrumentedRequest(
      url: string,
      options?: any,
    ): Promise<any> {
      // Start span with appropriate kind
      // CLIENT: outgoing requests, database queries, etc.
      // INTERNAL: internal operations
      // PRODUCER/CONSUMER: message queues
      const span = tracer.startSpan('mylibrary.request', {
        kind: SpanKind.CLIENT,
      });

      // Set base attributes
      const attributes = createBaseAttributes('request', config);
      span.setAttributes(attributes);

      // Add operation-specific attributes
      span.setAttribute('http.url', url);

      if (captureDetails && options) {
        // Be careful with sensitive data!
        // Consider what you're capturing
        const sanitized = sanitizeText(
          JSON.stringify(options),
          maxDetailLength,
        );
        span.setAttribute('http.request.body', sanitized);
      }

      // Execute operation with proper error handling
      try {
        const result = await runWithSpan(span, () =>
          originalRequest(url, options),
        );

        // Add success attributes
        if (result?.status) {
          span.setAttribute('http.status_code', result.status);
        }

        // Finalize span on success
        finalizeSpan(span);
        return result;
      } catch (error) {
        // Finalize span on error (records exception automatically)
        finalizeSpan(span, error);
        throw error;
      }
    };
  }

  // Example: Instrument query method (for database-like libraries)
  if (typeof client.query === 'function') {
    const originalQuery = client.query.bind(client);

    client.query = async function instrumentedQuery(
      sql: string,
      params?: any[],
    ): Promise<any> {
      const span = tracer.startSpan('mylibrary.query', {
        kind: SpanKind.CLIENT,
      });

      // Database-specific attributes
      span.setAttribute('db.system', 'my-database');
      span.setAttribute('db.operation', 'query');

      if (captureDetails) {
        const sanitized = sanitizeText(sql, maxDetailLength);
        span.setAttribute('db.statement', sanitized);
      }

      try {
        const result = await runWithSpan(span, () =>
          originalQuery(sql, params),
        );

        // Add result metadata if available
        if (Array.isArray(result)) {
          span.setAttribute('db.result.count', result.length);
        }

        finalizeSpan(span);
        return result;
      } catch (error) {
        finalizeSpan(span, error);
        throw error;
      }
    };
  }

  // ============================================================================
  // STEP 7: Handle Synchronous Methods (if needed)
  // ============================================================================

  // Example: Synchronous method (less common)
  if (typeof client.send === 'function') {
    const originalSend = client.send.bind(client);

    client.send = function instrumentedSend(topic: string, message: any): any {
      const span = tracer.startSpan('mylibrary.send', {
        kind: SpanKind.PRODUCER,
      });

      span.setAttribute('messaging.destination', topic);

      // For synchronous operations, use try/finally
      try {
        const result = runWithSpan(span, () => originalSend(topic, message));
        finalizeSpan(span);
        return result;
      } catch (error) {
        finalizeSpan(span, error);
        throw error;
      }
    };
  }

  // Mark as instrumented
  client[INSTRUMENTED_FLAG] = true;

  return client;
}

// ============================================================================
// STEP 8: Export Types
// ============================================================================

/**
 * Re-export types for consumers
 */
export type { MyLibraryClient };
