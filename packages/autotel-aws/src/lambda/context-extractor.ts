/**
 * Extract trace context from Lambda events
 */

import { context, propagation, trace } from '@opentelemetry/api';
import type { Context, SpanContext } from '@opentelemetry/api';
import type { LambdaEvent } from '../types';
import type { LambdaInstrumentationConfig } from '../config';
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';

/**
 * Extract trace context from Lambda event
 *
 * Supports:
 * - API Gateway (W3C Trace Context headers)
 * - SQS (message attributes)
 * - SNS (message attributes)
 * - X-Ray header (Lambda integration)
 * - Step Functions (payload context)
 */
export function extractTraceContext(
  event: LambdaEvent,
): SpanContext | undefined {
  const extracted = extractEventContext(event);
  return extracted ? trace.getSpanContext(extracted) : undefined;
}

/** Keep the full context internally so baggage survives extraction. */
function extractEventContext(event: LambdaEvent): Context | undefined {
  // API Gateway - W3C Trace Context
  if (event.headers?.traceparent) {
    const carrier: Record<string, string> = {};
    if (event.headers.traceparent)
      carrier.traceparent = event.headers.traceparent;
    if (event.headers.tracestate) carrier.tracestate = event.headers.tracestate;
    if (event.headers.baggage) carrier.baggage = event.headers.baggage;

    const extractedContext = propagation.extract(context.active(), carrier);
    return extractedContext;
  }

  // SQS - message attributes
  if (event.Records?.[0]?.messageAttributes?.traceparent) {
    const record = event.Records[0];
    if (!record.messageAttributes) return undefined;

    const carrier: Record<string, string> = {};
    if (record.messageAttributes.traceparent?.StringValue) {
      carrier.traceparent = record.messageAttributes.traceparent.StringValue;
    }
    if (record.messageAttributes.tracestate?.StringValue) {
      carrier.tracestate = record.messageAttributes.tracestate.StringValue;
    }
    if (record.messageAttributes.baggage?.StringValue) {
      carrier.baggage = record.messageAttributes.baggage.StringValue;
    }

    const extractedContext = propagation.extract(context.active(), carrier);
    return extractedContext;
  }

  // SNS - message attributes
  if (event.Records?.[0]?.Sns?.MessageAttributes?.traceparent) {
    const sns = event.Records[0].Sns;
    if (!sns.MessageAttributes) return undefined;

    const carrier: Record<string, string> = {};
    if (sns.MessageAttributes.traceparent?.Value) {
      carrier.traceparent = sns.MessageAttributes.traceparent.Value;
    }
    if (sns.MessageAttributes.tracestate?.Value) {
      carrier.tracestate = sns.MessageAttributes.tracestate.Value;
    }
    if (sns.MessageAttributes.baggage?.Value) {
      carrier.baggage = sns.MessageAttributes.baggage.Value;
    }

    const extractedContext = propagation.extract(context.active(), carrier);
    return extractedContext;
  }

  // X-Ray header (Lambda integration)
  if (event.headers?.['x-amzn-trace-id']) {
    const xrayPropagator = new AWSXRayPropagator();
    const carrier: Record<string, string> = {
      'x-amzn-trace-id': event.headers['x-amzn-trace-id'],
    };

    // AWSXRayPropagator.extract() requires a getter function
    // Use a simple getter for Record<string, string>
    const getter = {
      get(
        carrier: Record<string, string>,
        key: string,
      ): string | string[] | undefined {
        return carrier[key];
      },
      keys(carrier: Record<string, string>): string[] {
        return Object.keys(carrier);
      },
    };

    const extractedContext = xrayPropagator.extract(
      context.active(),
      carrier,
      getter,
    );
    return extractedContext;
  }

  // Step Functions - payload context
  if (event._autotel_trace_context) {
    return trace.setSpanContext(context.active(), event._autotel_trace_context);
  }

  return undefined;
}

/**
 * Detect Lambda trigger type from event
 */
export function detectTriggerType(
  event: LambdaEvent,
): 'http' | 'pubsub' | 'datasource' | 'timer' | 'other' {
  // API Gateway / ALB
  if (event.headers || event.requestContext || event.httpMethod) {
    return 'http';
  }

  // SQS
  if (event.Records?.some((r) => r.messageAttributes || 'messageId' in r)) {
    return 'pubsub';
  }

  // SNS
  if (event.Records?.some((r) => r.Sns)) {
    return 'pubsub';
  }

  // Kinesis
  if (event.Records?.some((r) => r.kinesis)) {
    return 'datasource';
  }

  // EventBridge / Scheduled
  if (event.source === 'aws.events' || event['detail-type']) {
    return 'timer';
  }

  return 'other';
}

/**
 * The invocation's parent: from a caller-supplied carrier when one is configured
 * and yields a valid span context, else from wherever AWS put it.
 */
export function parentContextOf<TEvent>(
  event: TEvent,
  option?: LambdaInstrumentationConfig<TEvent>['extractTraceContext'],
): Context | undefined {
  if (option === false) return undefined;

  if (option !== undefined && option !== true) {
    const carrier = option(event);
    // Drop only the active span so the carrier alone decides the parent;
    // baggage, suppression and app context stay.
    const fromCarrier = carrier
      ? propagation.extract(trace.deleteSpan(context.active()), carrier)
      : undefined;

    const spanContext = fromCarrier
      ? trace.getSpanContext(fromCarrier)
      : undefined;
    if (spanContext && trace.isSpanContextValid(spanContext))
      return fromCarrier;
  }

  // SAFETY: extractEventContext only probes optional fields (headers, Records,
  // X-Ray) and returns undefined for an event that has none of them.
  return extractEventContext(event as LambdaEvent);
}
