/**
 * Canonical OpenTelemetry names for browser telemetry.
 *
 * Everything this package observes — clicks, web vitals, jank, sessions — has a
 * name the specification already owns. Emitting the same signal under a
 * homegrown one costs nothing to write and everything to use: a dashboard
 * built on the browser conventions finds an empty panel,
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
  // Attribution: the value says a vital is slow, these say why. Durations are
  // in milliseconds, the unit `browser.web_vital.value` already uses.
  /** `navigate`, `reload`, `back-forward-cache`, `soft-navigation`, … */
  WEB_VITAL_NAVIGATION_TYPE: 'browser.web_vital.navigation_type',
  /** Selector of the element responsible: LCP element, largest shift, INP target. */
  WEB_VITAL_TARGET: 'browser.web_vital.target',
  /** Document state when it happened: `loading`, `dom-interactive`, `complete`, … */
  WEB_VITAL_LOAD_STATE: 'browser.web_vital.load_state',
  /** LCP image or resource, query and fragment stripped. */
  WEB_VITAL_RESOURCE_URL: 'browser.web_vital.resource_url',
  /** INP interaction kind: `pointer` or `keyboard`. */
  WEB_VITAL_INTERACTION_TYPE: 'browser.web_vital.interaction_type',
  WEB_VITAL_TIME_TO_FIRST_BYTE: 'browser.web_vital.time_to_first_byte',
  WEB_VITAL_RESOURCE_LOAD_DELAY: 'browser.web_vital.resource_load_delay',
  WEB_VITAL_RESOURCE_LOAD_DURATION: 'browser.web_vital.resource_load_duration',
  WEB_VITAL_ELEMENT_RENDER_DELAY: 'browser.web_vital.element_render_delay',
  WEB_VITAL_INPUT_DELAY: 'browser.web_vital.input_delay',
  WEB_VITAL_PROCESSING_DURATION: 'browser.web_vital.processing_duration',
  WEB_VITAL_PRESENTATION_DELAY: 'browser.web_vital.presentation_delay',
  WEB_VITAL_FIRST_BYTE_TO_FCP: 'browser.web_vital.first_byte_to_fcp',
  WEB_VITAL_WAITING_DURATION: 'browser.web_vital.waiting_duration',
  WEB_VITAL_CACHE_DURATION: 'browser.web_vital.cache_duration',
  WEB_VITAL_DNS_DURATION: 'browser.web_vital.dns_duration',
  WEB_VITAL_CONNECTION_DURATION: 'browser.web_vital.connection_duration',
  WEB_VITAL_REQUEST_DURATION: 'browser.web_vital.request_duration',
  /**
   * Navigation within the document: `0` for the page load, then one per soft
   * navigation (route change) where the browser reports them. With
   * `session.id` and `navigation_url` it groups one view's LCP, CLS and INP.
   */
  WEB_VITAL_NAVIGATION_ID: 'browser.web_vital.navigation_id',
  /** That navigation's URL, query and fragment stripped. */
  WEB_VITAL_NAVIGATION_URL: 'browser.web_vital.navigation_url',
  /** Soft navigations: the interaction that triggered this one. */
  WEB_VITAL_NAVIGATION_INTERACTION_ID:
    'browser.web_vital.navigation_interaction_id',
  WEB_VITAL_TOTAL_SCRIPT_DURATION: 'browser.web_vital.total_script_duration',
  WEB_VITAL_TOTAL_STYLE_AND_LAYOUT_DURATION:
    'browser.web_vital.total_style_and_layout_duration',
  WEB_VITAL_TOTAL_PAINT_DURATION: 'browser.web_vital.total_paint_duration',
  WEB_VITAL_TOTAL_UNATTRIBUTED_DURATION:
    'browser.web_vital.total_unattributed_duration',
  /** INP: the script that ran longest inside the interaction, from long-animation-frame. */
  WEB_VITAL_LONGEST_SCRIPT_URL: 'browser.web_vital.longest_script.url',
  WEB_VITAL_LONGEST_SCRIPT_FUNCTION:
    'browser.web_vital.longest_script.function',
  /** What invoked it, e.g. `BUTTON#buy.onclick` or `Response.json.then`. */
  WEB_VITAL_LONGEST_SCRIPT_INVOKER: 'browser.web_vital.longest_script.invoker',
  /** `event-listener`, `user-callback`, `resolve-promise`, `classic-script`, … */
  WEB_VITAL_LONGEST_SCRIPT_INVOKER_TYPE:
    'browser.web_vital.longest_script.invoker_type',
  /** Which INP phase it ran in: `input-delay`, `processing-duration`, `presentation-delay`. */
  WEB_VITAL_LONGEST_SCRIPT_SUBPART: 'browser.web_vital.longest_script.subpart',
  /** Its time inside the interaction, in ms. */
  WEB_VITAL_LONGEST_SCRIPT_DURATION:
    'browser.web_vital.longest_script.duration',
  /** Forced style and layout inside it (layout thrashing), in ms. */
  WEB_VITAL_LONGEST_SCRIPT_FORCED_STYLE_AND_LAYOUT_DURATION:
    'browser.web_vital.longest_script.forced_style_and_layout_duration',
  /** CLS: the single largest shift's score, unitless. */
  WEB_VITAL_LARGEST_SHIFT_VALUE: 'browser.web_vital.largest_shift_value',
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
