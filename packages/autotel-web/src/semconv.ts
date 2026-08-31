/**
 * Canonical OpenTelemetry names for browser telemetry.
 *
 * Everything this package observes — clicks, web vitals, jank, sessions — has a
 * name the specification already owns. Emitting the same signal under a
 * homegrown one costs nothing to write and everything to use: a Grafana or
 * Honeycomb dashboard built on the browser conventions finds an empty panel,
 * and the person reading it concludes the thing never happened.
 *
 * So this file is the single source of truth for those strings, in the same
 * spirit as `autotel-genai/semconv`. Constants rather than a dependency on
 * `@opentelemetry/semantic-conventions`, which would pull a package into every
 * browser bundle to carry string literals.
 *
 * Where the spec names an event but has not yet published its body fields, the
 * fields live in {@link AUTOTEL_WEB} and are prefixed with the canonical event
 * name — an extension that reads as an extension, and that lines up with the
 * spec if and when it lands.
 *
 * ## Events are log records
 *
 * The names in {@link WEB_EVENT} are event names, and an OpenTelemetry event is
 * a **log record** — not a span. They are emitted through `emitEvent`, which
 * writes an OTLP log record carrying the name in both the record's `eventName`
 * field and its `event.name` attribute. A zero-duration span would be invisible
 * to every log and event dashboard, and would show up in trace search as noise.
 */

/** Canonical `browser.*` attributes. */
export const BROWSER = {
  LANGUAGE: 'browser.language',
  MOBILE: 'browser.mobile',
  PLATFORM: 'browser.platform',
  BRANDS: 'browser.brands',
  DOCUMENT_URL_FULL: 'browser.document.url.full',
} as const;

/** Canonical `user_agent.*` attributes. */
export const USER_AGENT = {
  NAME: 'user_agent.name',
  VERSION: 'user_agent.version',
  OS_NAME: 'user_agent.os.name',
  OS_VERSION: 'user_agent.os.version',
  SYNTHETIC_TYPE: 'user_agent.synthetic.type',
} as const;

/**
 * Canonical `app.*` attributes. Written for mobile first, but a widget is a
 * widget and a dropped frame is a dropped frame — the browser equivalents map
 * onto them exactly, which is why they are used here rather than reinvented.
 */
export const APP = {
  SCREEN_ID: 'app.screen.id',
  SCREEN_NAME: 'app.screen.name',
  SCREEN_COORDINATE_X: 'app.screen.coordinate.x',
  SCREEN_COORDINATE_Y: 'app.screen.coordinate.y',
  WIDGET_ID: 'app.widget.id',
  WIDGET_NAME: 'app.widget.name',
  JANK_FRAME_COUNT: 'app.jank.frame_count',
  JANK_PERIOD: 'app.jank.period',
  JANK_THRESHOLD: 'app.jank.threshold',
} as const;

/** Canonical `session.*` attributes. */
export const SESSION = {
  ID: 'session.id',
  PREVIOUS_ID: 'session.previous_id',
} as const;

/** Canonical event names. Emitted as OTLP log records, never as spans. */
export const WEB_EVENT = {
  WIDGET_CLICK: 'app.widget.click',
  SCREEN_CLICK: 'app.screen.click',
  WEB_VITAL: 'browser.web_vital',
  JANK: 'app.jank',
  SESSION_START: 'session.start',
  SESSION_END: 'session.end',
} as const;

/**
 * autotel extensions — **not** in the published specification.
 *
 * The `browser.web_vital.*` keys mirror the body the specification's event
 * describes (name, value, delta, id) while the released semantic-conventions
 * package carries the event name alone.
 *
 * Each extends a canonical event name rather than inventing a namespace, so it
 * is obvious at a glance which half of an attribute set is spec and which is
 * ours, and so a future spec field can take over without a rename.
 */
export const AUTOTEL_WEB = {
  /** Web vital name, e.g. `LCP`. The spec names the event but not its body. */
  WEB_VITAL_NAME: 'browser.web_vital.name',
  /** Web vital value, in the metric's own unit (ms, or unitless for CLS). */
  WEB_VITAL_VALUE: 'browser.web_vital.value',
  /**
   * Change since this metric was last reported. Without it, a run with
   * `reportAllChanges` on is a series of absolute values nobody can difference.
   */
  WEB_VITAL_DELTA: 'browser.web_vital.delta',
  /**
   * Identifier for this metric instance. Repeated reports of one measurement
   * share an id, which is the only way to deduplicate them.
   */
  WEB_VITAL_ID: 'browser.web_vital.id',
  /** `good` / `needs-improvement` / `poor`, as `web-vitals` reports it. */
  WEB_VITAL_RATING: 'browser.web_vital.rating',
  /** Element tag name for a click, when a widget name is not enough. */
  WIDGET_TAG: 'app.widget.tag',
  /**
   * What the click achieved: `normal`, `dead` (nothing observable happened) or
   * `rage` (repeated in the same spot). The signal no tracing backend produces
   * on its own, because a click that does nothing runs no code to trace.
   */
  CLICK_OUTCOME: 'app.widget.click.outcome',
  /** The liveness or timeout signal that decided a `dead` verdict. */
  CLICK_VERDICT_SIGNAL: 'app.widget.click.verdict_signal',
  /** Clicks counted in a `rage` burst. */
  CLICK_RAGE_COUNT: 'app.widget.click.rage_count',
  /**
   * Event name for a click judged frustrating. Separate from
   * {@link WEB_EVENT.WIDGET_CLICK} so a frustration query and a click count
   * never double-count the same gesture.
   */
  CLICK_FRUSTRATION: 'app.widget.click.frustration',
  /** Seconds the session had been running when it ended. */
  SESSION_DURATION: 'session.duration',
  /** Why a session ended: `timeout` or `unload`. */
  SESSION_END_REASON: 'session.end.reason',
} as const;
