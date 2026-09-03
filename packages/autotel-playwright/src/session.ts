/**
 * autotel-playwright/session
 *
 * One span per browser session, carrying the resource, network and console
 * telemetry that hosted browser vendors sell a dashboard for. Everything here
 * comes out of Playwright and CDP, so it works against a local Chromium and
 * exports wherever `autotel.init()` already points.
 *
 * @example
 * import { chromium } from 'playwright';
 * import { withBrowserSession } from 'autotel-playwright/session';
 *
 * const context = await (await chromium.launch()).newContext();
 * await withBrowserSession(context, async () => {
 *   // Anything in here - including a Stagehand act/extract whose RPC carries
 *   // trace context - lands under the session span.
 *   await stagehand.act('click sign in');
 * });
 */

import type {
  BrowserContext,
  CDPSession,
  ConsoleMessage,
  Page,
  Request,
} from '@playwright/test';
import {
  context as otelContext,
  getTracer,
  otelTrace,
  SpanStatusCode,
} from 'autotel';

const TRACER_NAME = 'autotel-playwright';
const TRACER_VERSION = '0.1.0';

/** Console levels recorded as span events when the caller names none. */
const DEFAULT_CONSOLE_LEVELS = ['error', 'warning'] as const;

/**
 * Session totals. `session.id` is canonical; the rest extend `browser.*`,
 * which OpenTelemetry defines for the browser but not for the driver.
 */
export const BROWSER_SESSION_ATTRIBUTES = {
  SESSION_ID: 'session.id',
  /** Seconds of browser CPU, summed over the session's pages. */
  CPU_TIME: 'browser.session.cpu.time',
  /** Peak JS heap in bytes across the session's pages. */
  MEMORY_USAGE: 'browser.session.memory.usage',
  /** Bytes on the wire, request and response, headers and bodies. */
  NETWORK_IO: 'browser.session.network.io',
  PAGES: 'browser.session.pages',
  CONSOLE_ERRORS: 'browser.session.console.errors',
  CONSOLE_LEVEL: 'browser.console.level',
  CONSOLE_MESSAGE: 'browser.console.message',
} as const;

export interface BrowserSessionOptions {
  /** Your own session identifier. Defaults to the session span's id. */
  sessionId?: string;
  /** Playwright console levels kept as span events. Default: error, warning. */
  consoleLevels?: readonly string[];
  /** Extra session attributes, e.g. a workflow or customer id. */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Runs `run` inside a `browser.session` span and records what the session cost.
 * The span is active for the callback, so any instrumented work started inside
 * it - including an agent whose RPC propagates trace context - joins the trace.
 */
export async function withBrowserSession<T>(
  browserContext: BrowserContext,
  run: (session: { sessionId: string }) => Promise<T>,
  options: BrowserSessionOptions = {},
): Promise<T> {
  const levels = new Set(options.consoleLevels ?? DEFAULT_CONSOLE_LEVELS);
  const span = getTracer(TRACER_NAME, TRACER_VERSION).startSpan(
    'browser.session',
    { attributes: { ...options.attributes } },
  );
  const sessionId = options.sessionId ?? span.spanContext().spanId;
  span.setAttribute(BROWSER_SESSION_ATTRIBUTES.SESSION_ID, sessionId);

  const totals = {
    consoleErrors: 0,
    cpuTime: 0,
    memoryUsage: 0,
    networkIo: 0,
    pages: 0,
  };
  const pending = new Set<Promise<unknown>>();
  const cdpSessions = new Map<Page, Promise<CDPSession | undefined>>();

  const track = (work: Promise<unknown>): void => {
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };

  /**
   * CPU is cumulative per target, so one read at the end is the whole story;
   * the heap read is a point in time, which is why closing pages are sampled
   * too rather than only the ones still open when the session ends.
   */
  const sample = async (page: Page): Promise<void> => {
    const session = cdpSessions.get(page);
    cdpSessions.delete(page);
    try {
      const cdp = await session;
      if (!cdp) return;
      const { metrics } = await cdp.send('Performance.getMetrics');
      const read = (name: string): number =>
        metrics.find((metric) => metric.name === name)?.value ?? 0;
      totals.cpuTime += read('TaskDuration');
      totals.memoryUsage = Math.max(totals.memoryUsage, read('JSHeapUsedSize'));
    } catch {
      // The page went away before it could answer. Its share of the totals is
      // lost, which beats failing the caller's session over telemetry.
    }
  };

  const addBytes = async (request: Request): Promise<void> => {
    try {
      const sizes = await request.sizes();
      totals.networkIo +=
        sizes.requestBodySize +
        sizes.requestHeadersSize +
        sizes.responseBodySize +
        sizes.responseHeadersSize;
    } catch {
      // Sizes are unavailable once the owning page is gone.
    }
  };

  const attach = (page: Page): void => {
    totals.pages += 1;

    // CPU and heap come from CDP, so they are Chromium-only. Firefox and WebKit
    // still report network, console and timing.
    cdpSessions.set(
      page,
      browserContext
        .newCDPSession(page)
        .then(async (cdp) => {
          await cdp.send('Performance.enable');
          return cdp;
        })
        .catch(() => undefined),
    );

    page.on('console', (message: ConsoleMessage) => {
      const level = message.type();
      if (level === 'error') totals.consoleErrors += 1;
      if (!levels.has(level)) return;
      span.addEvent('browser.console', {
        [BROWSER_SESSION_ATTRIBUTES.CONSOLE_LEVEL]: level,
        [BROWSER_SESSION_ATTRIBUTES.CONSOLE_MESSAGE]: message.text(),
      });
    });
    page.on('pageerror', (error: Error) => {
      totals.consoleErrors += 1;
      span.recordException(error);
    });
    page.on('requestfinished', (request: Request) => track(addBytes(request)));
    page.on('close', () => track(sample(page)));
  };

  browserContext.on('page', attach);
  for (const page of browserContext.pages()) attach(page);

  try {
    return await otelContext.with(
      otelTrace.setSpan(otelContext.active(), span),
      () => run({ sessionId }),
    );
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    browserContext.off('page', attach);
    for (const page of cdpSessions.keys()) track(sample(page));
    await Promise.allSettled([...pending]);
    span.setAttributes({
      [BROWSER_SESSION_ATTRIBUTES.CONSOLE_ERRORS]: totals.consoleErrors,
      [BROWSER_SESSION_ATTRIBUTES.CPU_TIME]: totals.cpuTime,
      [BROWSER_SESSION_ATTRIBUTES.MEMORY_USAGE]: totals.memoryUsage,
      [BROWSER_SESSION_ATTRIBUTES.NETWORK_IO]: totals.networkIo,
      [BROWSER_SESSION_ATTRIBUTES.PAGES]: totals.pages,
    });
    span.end();
  }
}
