/**
 * Browser Rendering binding instrumentation
 */

import {
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap, setAttr } from './common';

interface BrowserRenderingLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Instrument Browser Rendering binding (manual only — not auto-detected)
 */
export function instrumentBrowserRendering<T extends BrowserRenderingLike>(browser: T, bindingName?: string): T {
  const name = bindingName || 'browser';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'fetch' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [input] = args as [RequestInfo | URL, RequestInit | undefined];
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

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
                  const result = await Reflect.apply(fnTarget, target, args);
                  setAttr(span, 'http.response.status_code', result?.status);
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

  return wrap(browser, handler);
}
