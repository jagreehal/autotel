/**
 * Workers AI binding instrumentation
 */

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { wrap, setAttr } from './common';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import { asFunction, member, numberAt, trapArgs } from '../values.js';

/**
 * Instrument Workers AI binding
 */
export function instrumentAI<T extends Ai>(ai: T, bindingName?: string): T {
  const name = bindingName || 'ai';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'run' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [model] = trapArgs<[string, unknown, unknown]>(args);
            const tracer = workerTracer('autotel-edge');

            return tracer.startActiveSpan(
              `AI ${name}: run ${model}`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  // Canonical GenAI provider attribute (replaces deprecated
                  // `gen_ai.system`).
                  'gen_ai.provider.name': 'cloudflare-workers-ai',
                  'gen_ai.operation.name': 'run',
                  'gen_ai.request.model': model,
                },
              },
              async (span) => {
                try {
                  const result = await fnTarget.apply(target, args);
                  const inputTokens = numberAt(
                    result,
                    'usage',
                    'prompt_tokens',
                  );
                  if (inputTokens !== undefined) {
                    setAttr(span, 'gen_ai.usage.input_tokens', inputTokens);
                  }
                  const outputTokens = numberAt(
                    result,
                    'usage',
                    'completion_tokens',
                  );
                  if (outputTokens !== undefined) {
                    setAttr(span, 'gen_ai.usage.output_tokens', outputTokens);
                  }
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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
