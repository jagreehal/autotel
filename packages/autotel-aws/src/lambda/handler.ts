/**
 * Lambda handler wrappers
 *
 * Provides instrumentation wrappers for AWS Lambda handlers with automatic
 * trace context extraction from various event sources (API Gateway, SQS, SNS, etc.).
 *
 * @example Simple wrapper
 * ```typescript
 * import { wrapHandler } from 'autotel-aws/lambda';
 *
 * export const handler = wrapHandler(async (event, context) => {
 *   return { statusCode: 200 };
 * });
 * ```
 *
 * @example With context access
 * ```typescript
 * import { traceLambda } from 'autotel-aws/lambda';
 *
 * export const handler = traceLambda(ctx => async (event, context) => {
 *   ctx.setAttribute('user.id', event.userId);
 *   return { statusCode: 200 };
 * });
 * ```
 */

import { context, trace as otelTrace, SpanStatusCode } from '@opentelemetry/api';
import type { SpanContext, Context } from '@opentelemetry/api';
import { trace as autotelTrace, type TraceContext } from 'autotel';
import type { LambdaHandler } from './types';
import type { LambdaEvent, LambdaContext } from '../types';
import { extractTraceContext, detectTriggerType } from './context-extractor';
import { buildLambdaAttributes } from '../attributes';
import type { LambdaInstrumentationConfig } from '../config';

// Track cold starts per function instance
// Using WeakMap-like pattern to avoid memory leaks in long-running containers
const coldStartMap = new Map<string, boolean>();

/**
 * Maximum error message length to prevent span attribute bloat
 */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Create an OpenTelemetry context with the given span context as parent
 *
 * This properly sets up the parent-child relationship for distributed tracing
 * by creating a context that contains the extracted span context.
 */
function createContextWithParent(parentSpanContext: SpanContext): Context {
  // Create a non-recording span that carries the parent context
  // This is the standard OTel pattern for context propagation
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
  // ARN format: arn:aws:lambda:region:account-id:function:name
  const arnParts = arn.split(':');
  if (arnParts.length >= 5) {
    return arnParts[4];
  }
  return undefined;
}

/**
 * Wrap Lambda handler with OpenTelemetry instrumentation
 *
 * Automatically extracts trace context from incoming events and creates
 * a root span for the Lambda invocation with proper semantic attributes.
 *
 * @param handler - The Lambda handler function to wrap
 * @param config - Optional instrumentation configuration
 * @returns Wrapped handler with automatic tracing
 *
 * @example Basic usage
 * ```typescript
 * export const handler = wrapHandler(async (event, context) => {
 *   // Your handler code - automatically traced
 *   return { statusCode: 200 };
 * });
 * ```
 *
 * @example With configuration
 * ```typescript
 * export const handler = wrapHandler(
 *   async (event, context) => {
 *     return { statusCode: 200, body: JSON.stringify({ result: 'ok' }) };
 *   },
 *   { captureResponse: true, extractTraceContext: true }
 * );
 * ```
 *
 * @remarks
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
export function wrapHandler<TEvent = LambdaEvent, TResult = unknown>(
  handler: LambdaHandler<TEvent, TResult>,
  config?: LambdaInstrumentationConfig,
): LambdaHandler<TEvent, TResult> {
  // Return the wrapped handler
  return async (event: TEvent, lambdaContext: LambdaContext): Promise<TResult> => {
    const functionName = lambdaContext.functionName;

    // Detect cold start (first invocation for this function instance)
    const isColdStart = !coldStartMap.has(functionName);
    if (isColdStart) {
      coldStartMap.set(functionName, true);
    }

    // Extract parent trace context from event (if enabled, default: true)
    const shouldExtractContext = config?.extractTraceContext !== false;
    const parentSpanContext = shouldExtractContext
      ? extractTraceContext(event as LambdaEvent)
      : undefined;

    // Detect trigger type for semantic attributes
    const trigger = detectTriggerType(event as LambdaEvent);

    // Core tracing logic
    const executeWithTracing = async (): Promise<TResult> => {
      return autotelTrace(
        `lambda.${functionName}`,
        async (ctx: TraceContext): Promise<TResult> => {
          // Set Lambda semantic attributes
          ctx.setAttributes(
            buildLambdaAttributes({
              awsRequestId: lambdaContext.awsRequestId,
              functionName,
              functionVersion: lambdaContext.functionVersion,
              coldStart: isColdStart,
              trigger,
            }),
          );

          // Extract and set account ID from ARN
          const accountId = extractAccountIdFromArn(lambdaContext.invokedFunctionArn);
          if (accountId) {
            ctx.setAttribute('cloud.account.id', accountId);
          }

          // Set region from environment
          const region = process.env.AWS_REGION;
          if (region) {
            ctx.setAttribute('cloud.region', region);
          }

          try {
            const result = await handler(event, lambdaContext);

            // Capture response if configured (be careful with large payloads)
            if (config?.captureResponse && result != null) {
              try {
                const responseJson = JSON.stringify(result);
                // Only capture if not too large
                if (responseJson.length <= 4096) {
                  ctx.setAttribute('lambda.response', responseJson);
                } else {
                  ctx.setAttribute('lambda.response.truncated', true);
                  ctx.setAttribute('lambda.response.size', responseJson.length);
                }
              } catch {
                // Ignore serialization errors (circular references, etc.)
                ctx.setAttribute('lambda.response.serialization_failed', true);
              }
            }

            return result;
          } catch (error) {
            // Record error details
            const errorMessage = error instanceof Error ? error.message : String(error);
            ctx.setStatus({
              code: SpanStatusCode.ERROR,
              message: truncateErrorMessage(errorMessage),
            });

            // Add exception attributes
            ctx.setAttribute('exception.type', error instanceof Error ? error.constructor.name : 'Error');
            ctx.setAttribute('exception.message', truncateErrorMessage(errorMessage));

            if (error instanceof Error && error.stack) {
              ctx.setAttribute('exception.stacktrace', error.stack.slice(0, MAX_ERROR_MESSAGE_LENGTH));
            }

            throw error;
          }
        },
      );
    };

    // Execute with proper parent context if available
    if (parentSpanContext) {
      const parentContext = createContextWithParent(parentSpanContext);
      return context.with(parentContext, executeWithTracing);
    }

    return executeWithTracing();
  };
}

/**
 * Functional API for Lambda with trace context access
 *
 * Similar to `wrapHandler`, but provides access to the trace context
 * for setting custom attributes during handler execution.
 *
 * @param factory - Factory function that receives trace context and returns a handler
 * @param config - Optional instrumentation configuration
 * @returns Wrapped handler with automatic tracing
 *
 * @example
 * ```typescript
 * export const handler = traceLambda(ctx => async (event, context) => {
 *   // Access trace context for custom attributes
 *   ctx.setAttribute('user.id', event.userId);
 *   ctx.setAttribute('order.id', event.orderId);
 *
 *   // Use X-Ray annotations for indexed attributes
 *   setXRayAnnotation('user.tier', event.userTier);
 *
 *   const result = await processOrder(event);
 *   ctx.setAttribute('order.status', result.status);
 *
 *   return { statusCode: 200, body: JSON.stringify(result) };
 * });
 * ```
 *
 * @remarks
 * The trace context (`ctx`) provides:
 * - `setAttribute(key, value)` - Set a single attribute
 * - `setAttributes(attrs)` - Set multiple attributes
 * - `setStatus(status)` - Set span status
 * - `recordException(error)` - Record an exception
 * - `traceId`, `spanId` - Trace identifiers
 */
export function traceLambda<TEvent = LambdaEvent, TResult = unknown>(
  factory: (ctx: TraceContext) => LambdaHandler<TEvent, TResult>,
  config?: LambdaInstrumentationConfig,
): LambdaHandler<TEvent, TResult> {
  return async (event: TEvent, lambdaContext: LambdaContext): Promise<TResult> => {
    const functionName = lambdaContext.functionName;

    // Detect cold start
    const isColdStart = !coldStartMap.has(functionName);
    if (isColdStart) {
      coldStartMap.set(functionName, true);
    }

    // Extract parent trace context
    const shouldExtractContext = config?.extractTraceContext !== false;
    const parentSpanContext = shouldExtractContext
      ? extractTraceContext(event as LambdaEvent)
      : undefined;

    // Detect trigger type
    const trigger = detectTriggerType(event as LambdaEvent);

    // Core tracing logic
    const executeWithTracing = async (): Promise<TResult> => {
      return autotelTrace(
        `lambda.${functionName}`,
        async (ctx: TraceContext): Promise<TResult> => {
          // Set Lambda semantic attributes
          ctx.setAttributes(
            buildLambdaAttributes({
              awsRequestId: lambdaContext.awsRequestId,
              functionName,
              functionVersion: lambdaContext.functionVersion,
              coldStart: isColdStart,
              trigger,
            }),
          );

          // Extract and set account ID from ARN
          const accountId = extractAccountIdFromArn(lambdaContext.invokedFunctionArn);
          if (accountId) {
            ctx.setAttribute('cloud.account.id', accountId);
          }

          // Set region from environment
          const region = process.env.AWS_REGION;
          if (region) {
            ctx.setAttribute('cloud.region', region);
          }

          // Create handler with context access and execute
          const handler = factory(ctx);
          return handler(event, lambdaContext);
        },
      );
    };

    // Execute with proper parent context if available
    if (parentSpanContext) {
      const parentContext = createContextWithParent(parentSpanContext);
      return context.with(parentContext, executeWithTracing);
    }

    return executeWithTracing();
  };
}
