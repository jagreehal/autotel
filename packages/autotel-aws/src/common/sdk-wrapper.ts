/**
 * Generic AWS SDK v3 client wrapper utilities
 */

// Type-only imports from optional peer dependencies
// @ts-expect-error - Optional peer dependency, may not be installed
import type { Client, Command } from '@aws-sdk/smithy-client';
import { extractRequestMetadata, extractServiceName, extractOperationName } from './request-builder';
import { extractResponseMetadata } from './response-builder';
import { classifyAWSError, extractErrorAttributes } from './error-handlers';
import { buildSDKAttributes } from '../attributes';
import { trace } from 'autotel';
import { SpanStatusCode } from '@opentelemetry/api';

/**
 * Wrap AWS SDK v3 client with OpenTelemetry instrumentation
 */
export function wrapSDKClient<T extends Client<any, any, any, any>>(
  client: T,
  serviceName?: string
): T {
  const clientName = (client.constructor as { name: string }).name;
  const resolvedServiceName = serviceName || extractServiceName(clientName);

  // Create a proxy that intercepts send() calls
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'send') {
        return async function tracedSend(command: Command<any, any, any, any, any>) {
          const metadata = extractRequestMetadata(command, { clientName });
          const operationName = extractOperationName(metadata.commandName);

          return trace(`aws.${resolvedServiceName}.${operationName}`, async (ctx) => {
            // Set request attributes
            ctx.setAttributes(
              buildSDKAttributes({
                service: resolvedServiceName,
                operation: operationName,
              })
            );

            try {
              const response = await target.send(command);

              // Extract and set response metadata
              const responseMetadata = extractResponseMetadata(response);
              if (responseMetadata.requestId) {
                ctx.setAttribute('aws.request_id', responseMetadata.requestId);
              }
              if (responseMetadata.httpStatusCode) {
                ctx.setAttribute('http.status_code', responseMetadata.httpStatusCode);
              }
              if (responseMetadata.extendedRequestId) {
                ctx.setAttribute('aws.extended_request_id', responseMetadata.extendedRequestId);
              }
              if (responseMetadata.cfId) {
                ctx.setAttribute('aws.cf_id', responseMetadata.cfId);
              }

              // Set span status based on HTTP status code
              if (responseMetadata.httpStatusCode) {
                if (responseMetadata.httpStatusCode >= 400) {
                  ctx.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: `HTTP ${responseMetadata.httpStatusCode}`,
                  });
                } else {
                  ctx.setStatus({ code: SpanStatusCode.OK });
                }
              }

              return response;
            } catch (error) {
              // Classify and handle error
              const errorInfo = classifyAWSError(error);
              const errorAttrs = extractErrorAttributes(error);

              ctx.setAttributes(errorAttrs);

              if (errorInfo.isError) {
                ctx.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: errorInfo.errorCode || 'AWS Error',
                });
              }

              throw error;
            }
          });
        };
      }

      return (target as any)[prop];
    },
  }) as T;
}
