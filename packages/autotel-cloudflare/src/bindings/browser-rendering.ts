/**
 * Browser Rendering binding instrumentation
 */

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { wrap, setAttr } from './common';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import { asFunction, member, numberAt, trapArgs } from '../values.js';

interface BrowserRenderingLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Instrument Browser Rendering binding (manual only — not auto-detected)
 */
export function instrumentBrowserRendering<T extends BrowserRenderingLike>(
  browser: T,
  bindingName?: string,
): T {
  const name = bindingName || 'browser';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'fetch' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [input] =
              trapArgs<[RequestInfo | URL, RequestInit | undefined]>(args);
            const url =
              typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input.url;
            const tracer = workerTracer('autotel-edge');

            return tracer.startActiveSpan(
              `BrowserRendering ${name}: fetch`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'browser.system': 'cloudflare-browser-rendering',
                  'url.full': url,
                },
              },
              async (span) => {
                try {
                  const result = await fnTarget.apply(target, args);
                  setAttr(
                    span,
                    'http.response.status_code',
                    numberAt(result, 'status'),
                  );
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

  return wrap(browser, handler);
}
