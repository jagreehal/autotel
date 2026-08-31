import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import * as Resource from '@effect/opentelemetry/Resource';
import * as Layer from 'effect/Layer';

export interface AutotelEffectLayerOptions {
  readonly serviceName: string;
  readonly serviceVersion?: string;
}

/**
 * Routes `Effect.withSpan` through autotel's global OpenTelemetry provider.
 *
 * Call `autotel.init()` before this layer is built — typically by loading an
 * instrumentation module with `node --import` or `tsx --import`.
 */
export function layer(options: AutotelEffectLayerOptions) {
  return OtelTracer.layerGlobal.pipe(
    Layer.provide(
      Resource.layer({
        serviceName: options.serviceName,
        ...(options.serviceVersion
          ? { serviceVersion: options.serviceVersion }
          : {}),
      }),
    ),
  );
}
