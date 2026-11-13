import type {
  LogRecordExporter,
  LogRecordProcessor,
  ReadWriteLogRecord,
} from '@opentelemetry/sdk-logs';
import type { Attributes, Context, AnyValue } from '@opentelemetry/api';
import { safeRequire } from './node-require';
import { createRedactionWalker, fingerprint } from './redaction-walker';
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
const FAILED = '[REDACTED: redaction failed]';

/** The log record fields a processor may set, besides body and attributes. */
const METADATA = [
  'severityNumber',
  'severityText',
  'eventName',
  'hrTime',
  'hrTimeObserved',
  'spanContext',
] as const;

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
    ReadWriteLogRecord,
    Map<AttributeRedactorFn, Map<string, AnyValue>>
  >();

  constructor(
    private wrapped: LogRecordProcessor,
    private redact: AttributeRedactorFn,
    /** Explicit key and path rules, for redacting a whole object under them. */
    private isSensitiveKey: (key: string) => boolean = () => false,
  ) {}

  onEmit(logRecord: ReadWriteLogRecord, context?: Context): void {
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
    const view = Object.create(logRecord) as ReadWriteLogRecord;
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
    logRecord: ReadWriteLogRecord,
    sticky: Map<string, AnyValue>,
  ): RedactedRecord {
    const original = logRecord.attributes as Record<string, AnyValue>;
    // SAFETY: rules that read sibling attributes (which database a query ran
    // against) read plain values; a log record's attribute map holds the same
    // values, plus nesting they never look into.
    const walk = createRedactionWalker(
      this.redact,
      this.isSensitiveKey,
      original as Attributes,
      sticky,
    );
    return {
      body: walk('', logRecord.body),
      attributes: Object.fromEntries(
        Object.entries(original).map(([key, value]) => [key, walk(key, value)]),
      ),
    };
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
