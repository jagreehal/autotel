import type {
  LogRecordExporter,
  LogRecordProcessor,
  SdkLogRecord,
} from '@opentelemetry/sdk-logs';
import type { Attributes, AttributeValue, Context } from '@opentelemetry/api';
import type { AnyValue } from '@opentelemetry/api-logs';
import { safeRequire } from './node-require';
import { asString } from './values';
import type { AttributeRedactorFn } from './attribute-redacting-processor';

/**
 * Redacts a log record's body and attributes with the span redactor's rules.
 *
 * Nested values are walked rather than passed over: a log attribute is often an
 * object (`{ customer: { email, card } }`), and anything left unread here is
 * flattened to text further down the pipeline, past any redaction. Nested keys
 * are dotted (`customer.password`), so key rules apply at any depth, the way
 * they apply to a dotted span attribute.
 */
const MAX_DEPTH = 32;
const TOO_DEEP = '[REDACTED: nested too deep]';
const CIRCULAR = '[Circular]';
const FAILED = '[REDACTED: redaction failed]';
const NOT_A_LOG_VALUE = '[REDACTED: not a log value]';
/** What a key rule sees in place of bytes, which have no text of their own. */
const BINARY = '[binary]';

/** The log record fields a processor may set, besides body and attributes. */
const METADATA = [
  'severityNumber',
  'severityText',
  'eventName',
  'hrTime',
  'hrTimeObserved',
  'spanContext',
] as const;

/**
 * A comparable form of a value, or undefined when there is none (a cycle, a
 * BigInt): undefined never matches, so such a value counts as changed.
 */
function fingerprint(value: AnyValue): string | undefined {
  if (value === null || typeof value !== 'object') {
    return `${typeof value}:${String(value)}`;
  }
  try {
    // Bytes print as a hash, at any depth: their JSON is a key per byte.
    return `json:${JSON.stringify(
      value,
      function (this: Record<string, unknown>, key, nested: unknown) {
        const raw = this[key];
        return raw instanceof Uint8Array ? bytesPrint(raw) : nested;
      },
    )}`;
  } catch {
    return undefined;
  }
}

/** Bytes as their length and FNV-1a hash. */
function bytesPrint(bytes: Uint8Array): string {
  let hash = 0x81_1c_9d_c5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01_00_01_93);
  return `bytes:${bytes.length}:${(hash >>> 0).toString(16)}`;
}

function isMap(value: unknown): value is Record<string, AnyValue> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

/**
 * Bring a view value up to date with a fresh redaction, keeping the
 * processor's own edits. Whatever still matches what the view was given
 * takes the fresh form, field by field, so editing `payload.tag` leaves its
 * untouched sibling `payload.secret` to be refreshed. Objects are updated in
 * place, so a reference the processor holds sees the refresh too. Returns the
 * value to show and what to record as given for it.
 */
function refreshUntouched(
  shown: AnyValue,
  given: AnyValue,
  fresh: AnyValue,
): { shown: AnyValue; given: AnyValue } {
  const before = fingerprint(given);
  if (before !== undefined && before === fingerprint(shown)) {
    return { shown: fresh, given: structuredClone(fresh) };
  }
  if (isMap(shown) && isMap(given) && isMap(fresh)) {
    const nextGiven = { ...given };
    for (const key of Object.keys(shown)) {
      if (!(key in given) || !(key in fresh)) continue;
      const next = refreshUntouched(shown[key]!, given[key]!, fresh[key]!);
      shown[key] = next.shown;
      nextGiven[key] = next.given;
    }
    return { shown, given: nextGiven };
  }
  if (
    Array.isArray(shown) &&
    Array.isArray(given) &&
    Array.isArray(fresh) &&
    shown.length === given.length &&
    given.length === fresh.length
  ) {
    const nextGiven = [...given];
    for (const [index, item] of shown.entries()) {
      const next = refreshUntouched(item, given[index]!, fresh[index]!);
      shown[index] = next.shown;
      nextGiven[index] = next.given;
    }
    return { shown, given: nextGiven };
  }
  return { shown, given };
}

interface RedactedRecord {
  body: AnyValue;
  attributes: Record<string, AnyValue>;
}

/** A redaction, and a separate copy of it to compare the view against. */
interface Redacted {
  redacted: RedactedRecord;
  given: RedactedRecord;
}

/** The view when redaction cannot finish: nothing of the record is shown. */
function failedView(): Redacted {
  return {
    redacted: { body: FAILED, attributes: {} },
    given: { body: FAILED, attributes: {} },
  };
}

/**
 * Hands the wrapped processor a redacted view of the record, never redacting
 * the record itself.
 *
 * Every processor gets the same record object, so the record stays as
 * written and each wrapper redacts from the true originals with the full
 * sibling context: nothing is ever redacted twice. The wrapped processor sees
 * a view, the record underneath with redacted body and attributes over it.
 *
 * What a processor changes through the record's API reaches the processors
 * after it, as OpenTelemetry intends: `setAttribute` / `setAttributes`,
 * `setBody` and the `body` setter, and the severity, event name, timestamp and
 * span context setters. Those changes go to the record, where the SDK applies
 * its limits, and the view is redacted again from it. Mutating the view's
 * objects directly (`attributes.x = …`, editing a nested value) changes only
 * that processor's view: a redacted value cannot be mapped back to the
 * original it came from, and the SDK's API is the setters (`attributes` is
 * typed read-only).
 *
 * Nothing here throws into `logger.emit()`: the SDK runs processors without a
 * catch, so every redaction step fails closed instead.
 */
export class RedactingLogRecordProcessor implements LogRecordProcessor {
  /** Sticky redactions per record and redactor; see the walker. */
  private static readonly sticky = new WeakMap<
    SdkLogRecord,
    Map<AttributeRedactorFn, Map<string, AnyValue>>
  >();

  constructor(
    private wrapped: LogRecordProcessor,
    private redact: AttributeRedactorFn,
    /** Explicit key and path rules, for redacting a whole object under them. */
    private isSensitiveKey: (key: string) => boolean = () => false,
  ) {}

  onEmit(logRecord: SdkLogRecord, context?: Context): void {
    const byRedactor =
      RedactingLogRecordProcessor.sticky.get(logRecord) ??
      new Map<AttributeRedactorFn, Map<string, AnyValue>>();
    RedactingLogRecordProcessor.sticky.set(logRecord, byRedactor);
    const sticky = byRedactor.get(this.redact) ?? new Map<string, AnyValue>();
    byRedactor.set(this.redact, sticky);

    const redactNow = (): Redacted | undefined => {
      try {
        const redacted = this.redactRecord(logRecord, sticky);
        // Proves the result can be copied, as `given` and exporters will.
        return { redacted, given: structuredClone(redacted) };
      } catch {
        return undefined;
      }
    };
    const first = redactNow() ?? failedView();
    // What the view was handed, to tell the processor's own edits apart.
    const given = first.given;
    let body = first.redacted.body;

    // SAFETY: a view inherits every field and method of the record; only the
    // body and attributes are its own, so writes through the setters land on
    // the view (metadata) or are routed to the record (body, attributes).
    const view = Object.create(logRecord) as SdkLogRecord;
    const viewAttributes = () => view.attributes as Record<string, AnyValue>;
    Object.defineProperty(view, 'attributes', {
      value: first.redacted.attributes,
      writable: true,
      enumerable: true,
      configurable: true,
    });

    // After an accepted change the record is redacted again, since one value
    // can change what others redact to. What the processor set is shown fresh;
    // the rest of the view takes the new result where the processor has not
    // edited it itself, field by field. On failure the view fails closed.
    const refresh = (setKeys: ReadonlySet<string>, bodySet: boolean) => {
      const next = redactNow();
      if (!next) {
        for (const key of new Set([
          ...Object.keys(viewAttributes()),
          ...setKeys,
        ])) {
          viewAttributes()[key] = FAILED;
          given.attributes[key] = FAILED;
        }
        body = FAILED;
        given.body = FAILED;
        return;
      }
      const fresh = next.redacted;
      for (const key of new Set([
        ...Object.keys(given.attributes),
        ...setKeys,
      ])) {
        if (!(key in fresh.attributes)) continue;
        if (setKeys.has(key)) {
          viewAttributes()[key] = fresh.attributes[key]!;
          given.attributes[key] = next.given.attributes[key]!;
        } else if (key in viewAttributes()) {
          const updated = refreshUntouched(
            viewAttributes()[key]!,
            given.attributes[key]!,
            fresh.attributes[key]!,
          );
          viewAttributes()[key] = updated.shown;
          given.attributes[key] = updated.given;
        }
      }
      if (bodySet) {
        body = fresh.body;
        given.body = next.given.body;
      } else {
        const updated = refreshUntouched(body, given.body, fresh.body);
        body = updated.shown;
        given.body = updated.given;
      }
    };

    Object.defineProperty(view, 'body', {
      get: () => body,
      set: (value: AnyValue) => {
        logRecord.body = value;
        refresh(new Set(), true);
      },
      enumerable: true,
      configurable: true,
    });

    if (typeof logRecord.setAttribute === 'function') {
      // Applied to the record, so the SDK's count and length limits and its
      // dropped count hold there. A rejected call changes nothing, so it
      // refreshes nothing and cannot surface the original the record kept.
      const apply = (key: string, value: AnyValue): boolean => {
        const attributes = logRecord.attributes as Record<string, AnyValue>;
        const had = Object.hasOwn(attributes, key);
        const before = attributes[key];
        logRecord.setAttribute(key, value);
        return (
          Object.hasOwn(attributes, key) && (!had || attributes[key] !== before)
        );
      };
      Object.defineProperty(view, 'setAttribute', {
        value: (key: string, value: AnyValue) => {
          if (apply(key, value)) refresh(new Set([key]), false);
          return view;
        },
        configurable: true,
      });
      Object.defineProperty(view, 'setAttributes', {
        value: (attributes: Record<string, AnyValue>) => {
          const changed = new Set(
            Object.entries(attributes)
              .filter(([key, value]) => apply(key, value))
              .map(([key]) => key),
          );
          if (changed.size > 0) refresh(changed, false);
          return view;
        },
        configurable: true,
      });
    }

    this.wrapped.onEmit(view, context);

    // Metadata is never redacted, so the view started with the record's own;
    // whatever the processor set there goes back through the record's setter.
    try {
      const record = logRecord as unknown as Record<string, AnyValue>;
      const changed = view as unknown as Record<string, AnyValue>;
      for (const field of METADATA) {
        if (fingerprint(changed[field]) !== fingerprint(record[field])) {
          record[field] = changed[field];
        }
      }
    } catch {
      // A metadata value that cannot be compared or set stays as it was.
    }
  }

  private redactRecord(
    logRecord: SdkLogRecord,
    sticky: Map<string, AnyValue>,
  ): RedactedRecord {
    const original = logRecord.attributes as Record<string, AnyValue>;
    // SAFETY: rules that read sibling attributes (which database a query ran
    // against) read plain values; a log record's attribute map holds the same
    // values, plus nesting they never look into.
    const walk = this.walker(original as Attributes, sticky);
    return {
      body: walk('', logRecord.body),
      attributes: Object.fromEntries(
        Object.entries(original).map(([key, value]) => [key, walk(key, value)]),
      ),
    };
  }

  /**
   * Redact a value at any depth. A sensitive key is checked before its value
   * is entered, so `{ password: { value: 'x' } }` is redacted through the
   * parent's rule rather than only by what `password.value` happens to match;
   * `ruleKey` carries that parent down to every leaf beneath it.
   */
  private walker(siblings: Attributes, sticky: Map<string, AnyValue>) {
    // The objects on the current path, so only a real cycle is cut: an object
    // referenced twice side by side is redacted both times.
    const ancestors = new WeakSet<object>();
    const isSensitive = this.isSensitiveKey;
    // Once a value under a key has been redacted for this record, it stays
    // redacted, whatever the context says later: a processor may replace a
    // sibling with something derived from its masked view (dropping the
    // entry that made the record private), and a redaction must never be
    // undone by that. Keyed by position and value, so a moved or re-derived
    // copy of the same value is caught too.
    const stick = (key: string, value: AnyValue, out: AnyValue): AnyValue => {
      const print = fingerprint(value);
      if (print === undefined) return out;
      const id = `${key}\u0000${print}`;
      if (fingerprint(out) !== print) {
        sticky.set(id, out);
        return out;
      }
      return sticky.has(id) ? sticky.get(id)! : out;
    };

    const walk = (
      key: string,
      value: AnyValue,
      ruleKey = key,
      depth = 0,
    ): AnyValue => {
      if (value === null || value === undefined) return value;
      if (value instanceof Uint8Array) {
        // No text for a value rule to read, but a key rule (this key's or a
        // sensitive ancestor's) covers bytes as it covers anything: they go as
        // the mask that rule gives, never as the original bytes.
        const masked = this.redact(ruleKey, BINARY, siblings);
        return stick(
          key,
          value,
          isSensitive(ruleKey) || masked !== BINARY ? masked : value,
        );
      }
      if (typeof value === 'function' || typeof value === 'symbol') {
        // Not a log value (the SDK only validates attributes, not the body),
        // and one that would break every copy made of the record downstream.
        return NOT_A_LOG_VALUE;
      }
      if (typeof value !== 'object') {
        return stick(key, value, this.redact(ruleKey, value, siblings));
      }
      if (depth >= MAX_DEPTH) return TOO_DEEP;
      if (ancestors.has(value)) return CIRCULAR;
      ancestors.add(value);
      try {
        return enter(key, value, ruleKey, depth);
      } finally {
        ancestors.delete(value);
      }
    };

    const enter = (
      key: string,
      value: object,
      ruleKey: string,
      depth: number,
    ): AnyValue => {
      // The sensitive key every leaf below must be redacted under, if any:
      // one inherited from an ancestor, or this key itself.
      const sensitive =
        ruleKey === key ? (isSensitive(key) ? key : undefined) : ruleKey;
      const child = (name: string) => (key ? `${key}.${name}` : name);

      if (Array.isArray(value)) {
        // A string array is one attribute value to the redactor, as on a
        // span, so a sensitive key replaces every element.
        return value.every((item) => asString(item) !== undefined)
          ? stick(
              key,
              value,
              this.redact(sensitive ?? key, value as AttributeValue, siblings),
            )
          : value.map((item) => walk(key, item, sensitive ?? key, depth + 1));
      }
      return Object.fromEntries(
        Object.entries(value).map(([name, nested]) => [
          name,
          walk(
            child(name),
            nested as AnyValue,
            sensitive ?? child(name),
            depth + 1,
          ),
        ]),
      );
    };
    return walk;
  }

  shutdown(): Promise<void> {
    return this.wrapped.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.wrapped.forceFlush();
  }
}

export interface PostHogConfig {
  /** OTLP logs endpoint URL (e.g., https://us.i.posthog.com/i/v1/logs?token=phc_xxx) */
  url: string;
}

/**
 * Build log record processors for PostHog OTLP logs integration.
 *
 * Resolution order:
 * 1. config.url if provided
 * 2. POSTHOG_LOGS_URL env var
 * 3. Empty array (disabled)
 */
export function buildPostHogLogProcessors(
  config: PostHogConfig | undefined,
  redactor?: AttributeRedactorFn | null,
  isSensitiveKey?: (key: string) => boolean,
): LogRecordProcessor[] {
  const url = config?.url || process.env.POSTHOG_LOGS_URL;
  if (!url) return [];

  const sdkLogs = safeRequire<{
    BatchLogRecordProcessor: new (options: {
      exporter: unknown;
    }) => LogRecordProcessor;
  }>('@opentelemetry/sdk-logs');

  const exporterModule = safeRequire<{
    OTLPLogExporter: new (config: { url: string }) => LogRecordExporter;
  }>('@opentelemetry/exporter-logs-otlp-http');

  if (!sdkLogs || !exporterModule) return [];

  const exporter = new exporterModule.OTLPLogExporter({ url });
  let processor: LogRecordProcessor = new sdkLogs.BatchLogRecordProcessor({
    exporter,
  });
  if (redactor) {
    processor = new RedactingLogRecordProcessor(
      processor,
      redactor,
      isSensitiveKey,
    );
  }

  return [processor];
}
