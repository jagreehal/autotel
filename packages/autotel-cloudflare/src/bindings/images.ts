/**
 * Images binding instrumentation
 *
 * The Images binding uses a fluent chain: input() -> transform() -> draw() -> output()
 * We only create a span at the terminal output() call to avoid intermediate noise.
 * info() is a standalone operation and gets its own span.
 */

import {
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap, setAttr } from './common';

const pipelineMetaSymbol = Symbol('images-pipeline-meta');

interface PipelineMeta {
  operationCount: number;
}

interface ImagesLike {
  info(blob: ReadableStream | ArrayBuffer | Blob): Promise<{ width: number; height: number; format: string }>;
  input(blob: ReadableStream | ArrayBuffer | Blob): ImageTransformerLike;
}

interface ImageTransformerLike {
  transform(options: unknown): ImageTransformerLike;
  draw(image: unknown, options?: unknown): ImageTransformerLike;
  output(options?: unknown): Promise<ImageOutputLike>;
}

interface ImageOutputLike {
  response(): Response;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function proxyTransformer(transformer: ImageTransformerLike, meta: PipelineMeta, bindingName: string): ImageTransformerLike {
  const handler: ProxyHandler<ImageTransformerLike> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if ((prop === 'transform' || prop === 'draw') && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            meta.operationCount++;
            const result = Reflect.apply(fnTarget, target, args);
            // If the result is the transformer itself (fluent chain), return our proxy
            if (result === target || (result && typeof result === 'object' && 'output' in result)) {
              return proxyTransformer(result as ImageTransformerLike, meta, bindingName);
            }
            return result;
          },
        });
      }

      if (prop === 'output' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;
            const [formatOrOptions] = args;

            const attributes: Record<string, string | number> = {
              'images.system': 'cloudflare-images',
              'images.pipeline.operation_count': meta.operationCount,
            };

            // Capture output format
            if (typeof formatOrOptions === 'string') {
              attributes['images.output.format'] = formatOrOptions;
            } else if (formatOrOptions && typeof formatOrOptions === 'object') {
              const fmt = (formatOrOptions as any).format;
              if (fmt) attributes['images.output.format'] = fmt;
            }

            return tracer.startActiveSpan(
              `Images ${bindingName}: output`,
              {
                kind: SpanKind.CLIENT,
                attributes,
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
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

  const proxy = new Proxy(transformer, handler);
  Object.defineProperty(proxy, pipelineMetaSymbol, {
    value: meta,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  return proxy;
}

/**
 * Instrument Images binding
 */
export function instrumentImages<T extends ImagesLike>(images: T, bindingName?: string): T {
  const name = bindingName || 'images';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'info' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `Images ${name}: info`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'images.system': 'cloudflare-images',
                  'images.operation': 'info',
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
                  setAttr(span, 'images.width', result?.width);
                  setAttr(span, 'images.height', result?.height);
                  setAttr(span, 'images.format', result?.format);
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

      if (prop === 'input' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const transformer = Reflect.apply(fnTarget, target, args) as ImageTransformerLike;
            const meta: PipelineMeta = { operationCount: 0 };
            return proxyTransformer(transformer, meta, name);
          },
        });
      }

      return value;
    },
  };

  return wrap(images, handler);
}
