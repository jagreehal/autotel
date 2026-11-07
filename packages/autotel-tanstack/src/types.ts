import type { Attributes } from '@opentelemetry/api';

/**
 * The part of a TanStack router that matches a pathname to its route:
 * `router.getMatchedRoutes`, whose third entry is the route found.
 */
export interface RouteMatcher {
  /** Where the router is mounted, such as `/app`; `/` at the root. */
  basepath?: string;
  /**
   * The router's input rewrite, which strips its `basepath` and applies any
   * `rewrite` option. Request paths go through it before matching, as the
   * router's own locations do.
   */
  rewrite?: {
    input?: (location: { url: URL }) => undefined | string | URL;
  };
  getMatchedRoutes(
    pathname: string,
  ): readonly [
    ReadonlyArray<object>,
    Record<string, string>,
    { fullPath: string } | undefined,
  ];
}

/**
 * Configuration options for TanStack Start instrumentation
 */
export interface TanStackInstrumentationConfig {
  /**
   * Service name for spans
   * @default process.env.OTEL_SERVICE_NAME || 'tanstack-start'
   */
  service?: string;

  /**
   * Whether to capture function arguments as span attributes
   * Warning: May contain PII, review before enabling in production
   * @default true
   */
  captureArgs?: boolean;

  /**
   * Whether to capture function results as span attributes
   * Warning: May contain PII, disable in production
   * @default false
   */
  captureResults?: boolean;

  /**
   * Whether to capture errors and record exceptions
   * @default true
   */
  captureErrors?: boolean;

  /**
   * HTTP headers to capture as span attributes
   * @default ['x-request-id']
   */
  captureHeaders?: string[];

  /**
   * URL paths to exclude from tracing (glob patterns)
   * @default []
   */
  excludePaths?: (string | RegExp)[];

  /**
   * A router built from your route tree, such as `getRouter()` from
   * `src/router.tsx`. Request spans are then named after the matched route
   * (`GET /posts/$postId`), which also becomes `http.route` on the request
   * span and the HTTP server span. Without it, request spans are named after
   * the path.
   */
  router?: RouteMatcher;

  /**
   * Sampling strategy
   * - 'always': Sample all requests (100%)
   * - 'adaptive': Use autotel's adaptive sampling (errors + slow = 100%, baseline 10%)
   * - 'never': Disable sampling (for testing/debugging)
   * @default 'adaptive'
   */
  sampling?: 'always' | 'adaptive' | 'never';

  /**
   * Custom function to extract additional span attributes
   */
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
  /**
   * Type of middleware
   * - 'request': For global request middleware (routes, SSR)
   * - 'function': For server function middleware
   * @default 'request'
   */
  type?: 'request' | 'function';
}

/**
 * Configuration for server function tracing
 */
export interface TraceServerFnConfig {
  /**
   * Explicit name for the span
   * If not provided, will attempt to infer from function name
   */
  name?: string;

  /**
   * Whether to capture function arguments
   * @default true
   */
  captureArgs?: boolean;

  /**
   * Whether to capture function results
   * @default false
   */
  captureResults?: boolean;
}

/**
 * Configuration for loader tracing
 */
export interface TraceLoaderConfig {
  /**
   * Explicit name for the span
   * If not provided, will use route ID
   */
  name?: string;

  /**
   * Whether to capture route params
   * @default true
   */
  captureParams?: boolean;

  /**
   * Whether to capture loader result
   * @default false
   */
  captureResult?: boolean;
}

/**
 * Configuration for handler wrapper
 */
export interface WrapStartHandlerConfig extends TanStackInstrumentationConfig {
  /**
   * OTLP endpoint URL
   * @default process.env.OTEL_EXPORTER_OTLP_ENDPOINT
   */
  endpoint?: string;

  /**
   * OTLP headers (e.g., for authentication)
   * @default parsed from process.env.OTEL_EXPORTER_OTLP_HEADERS
   */
  headers?: Record<string, string>;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<
  Omit<TanStackInstrumentationConfig, 'customAttributes' | 'service' | 'router'>
> = {
  captureArgs: true,
  captureResults: false,
  captureErrors: true,
  captureHeaders: ['x-request-id'],
  excludePaths: [],
  sampling: 'adaptive',
};

/**
 * Span attribute keys following OpenTelemetry semantic conventions
 */
export const SPAN_ATTRIBUTES = {
  // HTTP semantic conventions
  HTTP_REQUEST_METHOD: 'http.request.method',
  HTTP_RESPONSE_STATUS_CODE: 'http.response.status_code',
  HTTP_ROUTE: 'http.route',
  URL_PATH: 'url.path',
  URL_QUERY: 'url.query',
  URL_FULL: 'url.full',

  // RPC semantic conventions (for server functions)
  RPC_SYSTEM: 'rpc.system.name',
  RPC_METHOD: 'rpc.method',

  // TanStack-specific attributes
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
