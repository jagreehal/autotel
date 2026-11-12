import {
  type Baggage,
  context as otelContext,
  propagation,
} from '@opentelemetry/api';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as Tracer from 'effect/Tracer';

// W3C baggage from the request, active in OpenTelemetry's context while the request's effects run. Effect's HTTP
// server reads `traceparent` and b3, and @effect/opentelemetry builds each span's context from the active one, so
// this module supplies the baggage. With it active, autotel's `init({ baggage: { keys } })` stamps the allowed keys
// on every span, and `events.enrichFromBaggage` copies them onto events.

/** The current request's baggage. Set per request by `webHandler` or the `baggage` middleware. */
export const CurrentBaggage = Context.Reference<Baggage | undefined>(
  'autotel-effect/CurrentBaggage',
  { defaultValue: () => undefined },
);

// The W3C limits: 8192 bytes and 180 members. Baggage is whatever the client sent, so it is capped, and only the
// keys autotel's config allows ever reach a span or event.
const MAX_BYTES = 8192;
const MAX_MEMBERS = 180;

/** A W3C `baggage` header (`key=value;props,key2=value2`) as OpenTelemetry Baggage; undefined when empty. */
export function parseBaggage(header: string | null | undefined) {
  if (!header || header.length > MAX_BYTES) return undefined;
  const entries = header
    .split(',')
    .slice(0, MAX_MEMBERS)
    .flatMap((member) => {
      const [pair = ''] = member.split(';');
      const at = pair.indexOf('=');
      if (at <= 0) return [];
      try {
        const key = decodeURIComponent(pair.slice(0, at).trim());
        const value = decodeURIComponent(pair.slice(at + 1).trim());
        return key ? [[key, { value }] as const] : [];
      } catch {
        return []; // a malformed escape drops that member, not the request
      }
    });
  return entries.length > 0
    ? propagation.createBaggage(Object.fromEntries(entries))
    : undefined;
}

/** Wraps a tracer so the fiber's `CurrentBaggage` is active in OpenTelemetry's context around every evaluation. */
export const withBaggage = (inner: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    span: (options) => inner.span(options),
    context: (primitive, fiber) => {
      const run = () =>
        inner.context
          ? inner.context(primitive, fiber)
          : primitive['~effect/Effect/evaluate'](fiber);
      const baggage = fiber.getRef(CurrentBaggage);
      return baggage
        ? otelContext.with(
            propagation.setBaggage(otelContext.active(), baggage),
            run,
          )
        : run();
    },
  });

/**
 * Global router middleware for a long-running server (`HttpRouter.serve`): the request's baggage, active for its
 * handlers. Effect starts the server span before any middleware runs, so `spanKeys` are copied onto that span here;
 * spans below it get them from autotel's `baggage` option. `webHandler` needs none of this: it sets the baggage
 * before the server span starts.
 */
export const baggageMiddleware = (
  options: { readonly spanKeys?: ReadonlyArray<string> } = {},
) =>
  HttpRouter.middleware(
    (app) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const baggage = parseBaggage(request.headers.baggage);
        if (!baggage) return yield* app;
        for (const key of options.spanKeys ?? []) {
          const value = baggage.getEntry(key)?.value;
          if (value) yield* Effect.annotateCurrentSpan(key, value);
        }
        return yield* app.pipe(Effect.provideService(CurrentBaggage, baggage));
      }),
    { global: true },
  );
