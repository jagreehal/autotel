/**
 * Browser stub for types module
 *
 * Provides type definitions without importing from @opentelemetry/api
 */

/**
 * OpenTelemetry-compatible Attributes type (browser stub)
 */
export type Attributes = Record<string, string | number | boolean | undefined>;

/**
 * Configuration options for TanStack Start instrumentation
 */
export interface TanStackInstrumentationConfig {
  service?: string;
  captureArgs?: boolean;
  captureResults?: boolean;
  captureErrors?: boolean;
  captureHeaders?: string[];
  excludePaths?: (string | RegExp)[];
  sampling?: 'always' | 'adaptive' | 'never';
  customAttributes?: (context: {
    type: 'request' | 'serverFn' | 'loader' | 'beforeLoad' | 'middleware';
    name: string;
    request?: Request;
    args?: unknown;
    result?: unknown;
  }) => Attributes;
}

/**
 * Configuration specific to tracing middleware
 */
export interface TracingMiddlewareConfig extends TanStackInstrumentationConfig {
  type?: 'request' | 'function';
}

/**
 * Configuration for server function tracing
 */
export interface TraceServerFnConfig {
  name?: string;
  captureArgs?: boolean;
  captureResults?: boolean;
}

/**
 * Configuration for loader tracing
 */
export interface TraceLoaderConfig {
  name?: string;
  captureParams?: boolean;
  captureResult?: boolean;
}

/**
 * Configuration for handler wrapper
 */
export interface WrapStartHandlerConfig extends TanStackInstrumentationConfig {
  endpoint?: string;
  headers?: Record<string, string>;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<
  Omit<TanStackInstrumentationConfig, 'customAttributes' | 'service'>
> = {
  captureArgs: true,
  captureResults: false,
  captureErrors: true,
  captureHeaders: ['x-request-id'],
  excludePaths: [],
  sampling: 'adaptive',
};

/**
 * Span attribute keys (stub - values are strings)
 */
export const SPAN_ATTRIBUTES = {
  HTTP_REQUEST_METHOD: 'http.request.method',
  HTTP_RESPONSE_STATUS_CODE: 'http.response.status_code',
  URL_PATH: 'url.path',
  URL_QUERY: 'url.query',
  URL_FULL: 'url.full',
  RPC_SYSTEM: 'rpc.system',
  RPC_METHOD: 'rpc.method',
  TANSTACK_TYPE: 'tanstack.type',
  TANSTACK_SERVER_FN_NAME: 'tanstack.server_function.name',
  TANSTACK_SERVER_FN_METHOD: 'tanstack.server_function.method',
  TANSTACK_SERVER_FN_ARGS: 'tanstack.server_function.args',
  TANSTACK_SERVER_FN_RESULT: 'tanstack.server_function.result',
  TANSTACK_LOADER_ROUTE_ID: 'tanstack.loader.route_id',
  TANSTACK_LOADER_TYPE: 'tanstack.loader.type',
  TANSTACK_LOADER_PARAMS: 'tanstack.loader.params',
  TANSTACK_MIDDLEWARE_NAME: 'tanstack.middleware.name',
  TANSTACK_REQUEST_DURATION_MS: 'tanstack.request.duration_ms',
} as const;
