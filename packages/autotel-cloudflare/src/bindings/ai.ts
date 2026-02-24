/**
 * Workers AI binding instrumentation
 */

import {
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap, setAttr } from './common';

/**
 * Instrument Workers AI binding
 */
export function instrumentAI<T extends Ai>(ai: T, bindingName?: string): T {
  const name = bindingName || 'ai';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'run' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, thisArg, args) => {
            const [model] = args as [string, unknown, unknown];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `AI ${name}: run ${model}`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'gen_ai.system': 'cloudflare-workers-ai',
                  'gen_ai.operation.name': 'run',
                  'gen_ai.request.model': model,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, thisArg, args);
                  if (result?.usage?.prompt_tokens !== undefined) {
                    setAttr(span, 'gen_ai.usage.input_tokens', Number(result.usage.prompt_tokens));
                  }
                  if (result?.usage?.completion_tokens !== undefined) {
                    setAttr(span, 'gen_ai.usage.output_tokens', Number(result.usage.completion_tokens));
                  }
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(error as Error);
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : String(error),
                  });
                  throw error;
                } finally {
                  span.end();
                }
              },
            );
          },
        });
      }

      return value;
    },
  };

  return wrap(ai, handler);
}
