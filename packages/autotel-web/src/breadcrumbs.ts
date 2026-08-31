/**
 * What the user did just before it broke.
 *
 * An exception on its own is a stack and a shrug: it says where the code gave
 * up, never what the person was doing when it did. The trail leading in is the
 * half that turns a report into a reproduction, and no tracing convention
 * carries it — spans record what the code did, and the interesting steps here
 * are the ones that ran no code at all.
 *
 * Bounded in bytes rather than entries, because a breadcrumb holds whatever the
 * caller put in it and an entry count is no protection against one enormous
 * one. The newest step is never dropped: it is the one nearest the error.
 */

export interface Breadcrumb {
  /** What happened, in the words a person would use. */
  message: string;
  /** Coarse grouping, e.g. `ui`, `navigation`, `console`, `fetch`. */
  category?: string;
  /** Anything else worth having. Kept as-is, so keep it small. */
  data?: Record<string, unknown>;
  /** Epoch milliseconds. Filled in when the step is recorded. */
  timestamp: number;
}

export interface BreadcrumbsConfig {
  /** Total budget across all kept steps. Default 32KB, as PostHog uses. */
  maxBytes?: number;
  /** Applied to each message before it is stored, for PII. */
  redactor?: (text: string) => string;
}

const DEFAULT_MAX_BYTES = 32_768;

const encoder = new TextEncoder();
let enabled = true;
let maxBytes = DEFAULT_MAX_BYTES;
let redactor: ((text: string) => string) | undefined;
let entries: { crumb: Breadcrumb; bytes: number }[] = [];
let totalBytes = 0;

export function configureBreadcrumbs(config: BreadcrumbsConfig | false): void {
  if (config === false) {
    enabled = false;
    entries = [];
    totalBytes = 0;
    return;
  }
  enabled = true;
  maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
  redactor = config.redactor;
}

/** Record a step. Never throws: a breadcrumb must not break the thing it describes. */
export function addBreadcrumb(
  crumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number },
): void {
  if (!enabled) return;
  try {
    const stored: Breadcrumb = {
      ...crumb,
      message: redactor ? redactor(crumb.message) : crumb.message,
      timestamp: crumb.timestamp ?? Date.now(),
    };
    // The entry plus the comma that will separate it. The budget has to cover
    // the serialised array, not the sum of its parts, or a trail that fits by
    // this count is rejected by whatever the byte limit actually belongs to.
    const bytes = encoder.encode(JSON.stringify(stored)).byteLength + 1;
    entries.push({ crumb: stored, bytes });
    totalBytes += bytes;
    // Shed from the front — the oldest step is the one least likely to explain
    // the error. Stops at one entry, so the newest always survives.
    // `+ 1` is the enclosing brackets, less the one delimiter over-counted.
    while (entries.length > 1 && totalBytes + 1 > maxBytes) {
      totalBytes -= entries.shift()!.bytes;
    }
  } catch {
    // A `data` value that cannot be serialised is not worth a thrown error.
  }
}

/** The trail, oldest first. */
export function readBreadcrumbs(): Breadcrumb[] {
  return entries.map((entry) => entry.crumb);
}

/** @internal Reset for testing */
export function resetBreadcrumbsForTesting(): void {
  enabled = true;
  maxBytes = DEFAULT_MAX_BYTES;
  redactor = undefined;
  entries = [];
  totalBytes = 0;
}

/** Console levels worth keeping. `debug` is noise; `log` is where apps talk. */
const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error'] as const;
type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

export interface BreadcrumbCollectors {
  /**
   * Capture `console.log/info/warn/error` as steps.
   *
   * Deliberately not a second telemetry pipeline: console output is read when
   * something has already gone wrong, which is exactly when the trail is read,
   * so it belongs on the error rather than in a log stream of its own.
   */
  console?: boolean;
  /** Capture clicks as steps. */
  clicks?: boolean;
}

function describeArg(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Start recording steps automatically. Returns a teardown that restores
 * everything it patched.
 */
export function collectBreadcrumbs(
  collectors: BreadcrumbCollectors,
): () => void {
  const undo: (() => void)[] = [];

  if (collectors.console && typeof console === 'object') {
    for (const level of CONSOLE_LEVELS) {
      const original = console[level] as (...args: unknown[]) => void;
      const patched = (...args: unknown[]): void => {
        addBreadcrumb({
          category: 'console',
          message: args.map((arg) => describeArg(arg)).join(' '),
          data: { level },
        });
        original.apply(console, args);
      };
      (console as Record<ConsoleLevel, unknown>)[level] = patched;
      undo.push(() => {
        (console as Record<ConsoleLevel, unknown>)[level] = original;
      });
    }
  }

  if (collectors.clicks && globalThis.document !== undefined) {
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (!target?.tagName) return;
      const label =
        target.getAttribute?.('data-track') ??
        target.getAttribute?.('aria-label') ??
        target.tagName.toLowerCase();
      addBreadcrumb({ category: 'ui', message: `click ${label}` });
    };
    document.addEventListener('click', onClick, {
      capture: true,
      passive: true,
    });
    undo.push(() =>
      document.removeEventListener('click', onClick, { capture: true }),
    );
  }

  return () => {
    for (const fn of undo.reverse()) fn();
  };
}
