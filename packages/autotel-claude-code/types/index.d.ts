/**
 * The `$.autotel` noun as every caller sees it: the one contract for the noun,
 * its types exported here and the noun declared on `EngineInterface`.
 *
 * The autotel mod adds the noun in the `engine.create` fold. A plugin that
 * calls it reads these types by including this folder in its tsconfig, the way
 * Claude Code's own `telemetry` mod publishes `$.telemetry`.
 */

/** An attribute value as OTLP carries it. Nested data is JSON-encoded by the caller. */
export type AttributeValue = string | number | boolean;

/** Attributes on a span or an event, by OpenTelemetry attribute key. */
export type Attributes = Readonly<Record<string, AttributeValue>>;

/**
 * The span handed to `$.autotel.span`'s body: set attributes as facts arrive,
 * record point-in-time events. It ends when the body settles; a thrown error
 * marks it as failed with the error's message.
 */
export type Span = {
  setAttribute: (key: string, value: AttributeValue) => void;
  setAttributes: (attributes: Attributes) => void;
  addEvent: (name: string, attributes?: Attributes) => void;
};

/**
 * Instrumentation for plugins, exported over OTLP/HTTP to the endpoint
 * `OTEL_EXPORTER_OTLP_ENDPOINT` names (`autotel-devtools claude` sets it).
 *
 * A span started inside a turn joins that turn's trace, beside the hook
 * dispatches the mod records itself; outside a turn it is a trace of its own.
 */
export type Autotel = {
  /**
   * Runs `fn` inside a span named `name`, ended when `fn` settles.
   *
   * @example
   * const summary = await $.autotel.span('summarise', async span => {
   *   span.setAttribute('gen_ai.request.model', model)
   *   return $.model.complete(request)
   * }, { 'plugin.feature': 'summary' })
   */
  span: <T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    attributes?: Attributes,
  ) => Promise<T>;
};

declare module 'claude-code' {
  interface EngineInterface {
    /**
     * Plugin instrumentation as OpenTelemetry spans; present where the autotel
     * mod is seated, absent everywhere else.
     */
    autotel: Autotel;
  }
}
