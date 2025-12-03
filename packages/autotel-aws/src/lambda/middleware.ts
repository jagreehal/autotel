/**
 * Middy-compatible Lambda middleware for OpenTelemetry instrumentation
 *
 * Provides full span lifecycle management for Lambda handlers using Middy.
 *
 * @example Basic usage
 * ```typescript
 * import middy from '@middy/core';
 * import { tracingMiddleware } from 'autotel-aws/lambda';
 *
 * const baseHandler = async (event, context) => {
 *   return { statusCode: 200 };
 * };
 *
 * export const handler = middy(baseHandler)
 *   .use(tracingMiddleware());
 * ```
 *
 * @example With configuration
 * ```typescript
 * export const handler = middy(baseHandler)
 *   .use(tracingMiddleware({
 *     captureResponse: true,
 *     extractTraceContext: true
 *   }));
 * ```
 *
 * @example Combined with other middleware
 * ```typescript
 * export const handler = middy(baseHandler)
 *   .use(tracingMiddleware())
 *   .use(jsonBodyParser())
 *   .use(httpErrorHandler());
 * ```
 */

import type { MiddlewareObj, Request } from '@middy/core';
import type { Context as AWSLambdaContext } from 'aws-lambda';
import { context, trace as otelTrace, SpanStatusCode } from '@opentelemetry/api';
import type { Span, SpanContext, Context as OtelContext } from '@opentelemetry/api';
import type { LambdaEvent } from '../types';
import type { LambdaInstrumentationConfig } from '../config';
import { extractTraceContext, detectTriggerType } from './context-extractor';
import { buildLambdaAttributes } from '../attributes';

// Symbol to store span on request object
const SPAN_SYMBOL = Symbol.for('autotel-aws.span');
const CONTEXT_SYMBOL = Symbol.for('autotel-aws.context');

// Track cold starts per function instance
const coldStartMap = new Map<string, boolean>();

/**
 * Maximum error message length to prevent span attribute bloat
 */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Create an OpenTelemetry context with the given span context as parent
 */
function createContextWithParent(parentSpanContext: SpanContext): OtelContext {
  const parentSpan = otelTrace.wrapSpanContext(parentSpanContext);
  return otelTrace.setSpan(context.active(), parentSpan);
}

/**
 * Truncate error message to prevent span bloat
 */
function truncateErrorMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}... (truncated)`;
}

/**
 * Extract AWS account ID from Lambda ARN
 */
function extractAccountIdFromArn(arn: string): string | undefined {
  const arnParts = arn.split(':');
  if (arnParts.length >= 5) {
    return arnParts[4];
  }
  return undefined;
}

// Extended request type with our symbols
interface TracingRequest<TEvent = LambdaEvent, TResult = unknown>
  extends Request<TEvent, TResult, Error, AWSLambdaContext> {
  [SPAN_SYMBOL]?: Span;
  [CONTEXT_SYMBOL]?: OtelContext;
}

/**
 * Middy middleware for Lambda instrumentation with full span lifecycle
 *
 * Creates a span that wraps the entire handler execution, including:
 * - Trace context extraction from incoming events
 * - Cold start detection
 * - Semantic attributes for Lambda (faas.*, cloud.*)
 * - Error recording and status
 * - Response capture (optional)
 *
 * @param config - Optional instrumentation configuration
 * @returns Middy middleware object
 *
 * @remarks
 * This middleware uses Middy's before/after/onError hooks to manage
 * the span lifecycle. The span is created in `before`, ended in `after`
 * or `onError`.
 *
 * Semantic attributes set automatically:
 * - `faas.name` - Function name
 * - `faas.version` - Function version
 * - `faas.invocation_id` - AWS request ID
 * - `faas.coldstart` - Whether this is a cold start
 * - `faas.trigger` - Trigger type (http, pubsub, datasource, timer, other)
 * - `cloud.provider` - 'aws'
 * - `cloud.region` - AWS region
 * - `cloud.account.id` - AWS account ID (extracted from ARN)
 */
export function tracingMiddleware(
  config?: LambdaInstrumentationConfig,
): MiddlewareObj<LambdaEvent, unknown, Error, AWSLambdaContext> {
  const tracer = otelTrace.getTracer('autotel-aws');

  return {
    before: async (request: TracingRequest) => {
      const { event, context: lambdaContext } = request;
      const functionName = lambdaContext.functionName;

      // Detect cold start
      const isColdStart = !coldStartMap.has(functionName);
      if (isColdStart) {
        coldStartMap.set(functionName, true);
      }

      // Extract parent trace context from event
      const shouldExtractContext = config?.extractTraceContext !== false;
      const parentSpanContext = shouldExtractContext ? extractTraceContext(event) : undefined;

      // Detect trigger type
      const trigger = detectTriggerType(event);

      // Create parent context if available
      let parentContext = context.active();
      if (parentSpanContext) {
        parentContext = createContextWithParent(parentSpanContext);
      }

      // Start span with parent context
      const span = tracer.startSpan(
        `lambda.${functionName}`,
        {
          attributes: buildLambdaAttributes({
            awsRequestId: lambdaContext.awsRequestId,
            functionName,
            functionVersion: lambdaContext.functionVersion,
            coldStart: isColdStart,
            trigger,
          }),
        },
        parentContext,
      );

      // Extract and set account ID from ARN
      const accountId = extractAccountIdFromArn(lambdaContext.invokedFunctionArn);
      if (accountId) {
        span.setAttribute('cloud.account.id', accountId);
      }

      // Set region from environment
      const region = process.env.AWS_REGION;
      if (region) {
        span.setAttribute('cloud.region', region);
      }

      // Store span and context on request for later use
      request[SPAN_SYMBOL] = span;
      request[CONTEXT_SYMBOL] = otelTrace.setSpan(parentContext, span);

      // Set the context as active for the handler execution
      // This ensures child spans created during handler execution are linked
      return new Promise<void>((resolve) => {
        context.with(request[CONTEXT_SYMBOL]!, () => {
          resolve();
        });
      });
    },

    after: async (request: TracingRequest) => {
      const span = request[SPAN_SYMBOL];
      if (!span) return;

      // Capture response if configured
      if (config?.captureResponse && request.response != null) {
        try {
          const responseJson = JSON.stringify(request.response);
          if (responseJson.length <= 4096) {
            span.setAttribute('lambda.response', responseJson);
          } else {
            span.setAttribute('lambda.response.truncated', true);
            span.setAttribute('lambda.response.size', responseJson.length);
          }
        } catch {
          span.setAttribute('lambda.response.serialization_failed', true);
        }
      }

      // Set success status
      span.setStatus({ code: SpanStatusCode.OK });

      // End the span
      span.end();
    },

    onError: async (request: TracingRequest) => {
      const span = request[SPAN_SYMBOL];
      if (!span) return;

      const error = request.error;
      if (error) {
        // Record error details
        const errorMessage = error.message || String(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: truncateErrorMessage(errorMessage),
        });

        // Add exception attributes
        span.setAttribute('exception.type', error.name || 'Error');
        span.setAttribute('exception.message', truncateErrorMessage(errorMessage));

        if (error.stack) {
          span.setAttribute('exception.stacktrace', error.stack.slice(0, MAX_ERROR_MESSAGE_LENGTH));
        }

        // Record exception event
        span.recordException(error);
      }

      // End the span
      span.end();
    },
  };
}

/**
 * @deprecated Use tracingMiddleware instead. LambdaMiddleware is an alias for backwards compatibility.
 */
export const LambdaMiddleware = tracingMiddleware;

/**
 * Get the current span from a Middy request object
 *
 * Useful for setting custom attributes within your handler when using
 * the tracing middleware.
 *
 * @param request - Middy request object
 * @returns The active span, or undefined if not available
 *
 * @example
 * ```typescript
 * const baseHandler = async (event, context) => {
 *   const span = getSpanFromRequest(request);
 *   if (span) {
 *     span.setAttribute('user.id', event.userId);
 *   }
 *   return { statusCode: 200 };
 * };
 * ```
 */
export function getSpanFromRequest(request: Request<any, any, any, any>): Span | undefined {
  return (request as TracingRequest)[SPAN_SYMBOL];
}

/**
 * Get the OpenTelemetry context from a Middy request object
 *
 * @param request - Middy request object
 * @returns The active context, or undefined if not available
 */
export function getContextFromRequest(request: Request<any, any, any, any>): OtelContext | undefined {
  return (request as TracingRequest)[CONTEXT_SYMBOL];
}
