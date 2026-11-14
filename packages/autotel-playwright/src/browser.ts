/**
 * What the browser did during a test, as spans under the test's span.
 *
 * The test span and the backend's spans meet through `traceparent`, but the
 * browser in between is otherwise invisible: the page load, each fetch, the
 * scripts and images it pulled. Each finished or failed request becomes a
 * CLIENT span timed from Playwright's own request timing, so it sits in the
 * waterfall where it happened. Console errors and warnings, and uncaught page
 * errors, become log records through the Logs API, correlated to the test's
 * span, so "the page threw" sits in the test's trace beside the step that made
 * it throw.
 */

import type { ConsoleMessage, Page, Request } from '@playwright/test';
import { logs, SpanKind, SpanStatusCode } from 'autotel';
import type { Context, Tracer } from 'autotel';

/** A browser log record as the fixture keeps it for the test's `otel-logs` annotation. */
export interface BrowserLogRecord {
  timeMs: number;
  severity: 'ERROR' | 'WARN';
  body: string;
  attributes: Record<string, string | number>;
}

export interface BrowserActivityTarget {
  tracer: Pick<Tracer, 'startSpan'>;
  /** The test span's context: request spans are its children, log records correlate to it. */
  ctx: Context;
  /** Called with each log record emitted, so the fixture can annotate the test with them. */
  onLog?: (record: BrowserLogRecord) => void;
}

/** OTel severity numbers for the two levels recorded. */
const SEVERITY = { ERROR: 17, WARN: 13 } as const;

/**
 * Start recording `page`'s requests, console errors and warnings, and uncaught
 * errors. Returns a stop function that detaches the listeners and waits for
 * request spans still reading their response, so none is lost when the test's
 * spans are collected.
 */
export function recordBrowserActivity(
  page: Pick<Page, 'on' | 'off'>,
  { tracer, ctx, onLog }: BrowserActivityTarget,
): () => Promise<void> {
  const pending = new Set<Promise<void>>();
  const logger = logs.getLogger('autotel-playwright');
  const emit = (
    eventName: string,
    severity: BrowserLogRecord['severity'],
    body: string,
    attributes: BrowserLogRecord['attributes'],
  ) => {
    const timeMs = Date.now();
    logger.emit({
      eventName,
      timestamp: timeMs,
      severityNumber: SEVERITY[severity],
      severityText: severity,
      body,
      attributes,
      context: ctx,
    });
    onLog?.({ timeMs, severity, body, attributes });
  };

  const record = (request: Request, failed: boolean) => {
    const url = request.url();
    // data: and blob: URLs never touch the network.
    if (!/^https?:/i.test(url)) return;
    const work = (async () => {
      const response = failed
        ? null
        : await request.response().catch(() => null);
      const timing = request.timing();
      const start = timing.startTime > 0 ? timing.startTime : Date.now();
      const end =
        timing.responseEnd >= 0 ? start + timing.responseEnd : Date.now();
      const status = response?.status();
      const span = tracer.startSpan(
        `${request.method()} ${new URL(url).pathname}`,
        {
          kind: SpanKind.CLIENT,
          startTime: start,
          attributes: {
            'http.request.method': request.method(),
            'url.full': url,
            'playwright.resource_type': request.resourceType(),
            ...(status === undefined
              ? {}
              : { 'http.response.status_code': status }),
          },
        },
        ctx,
      );
      if (failed) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: request.failure()?.errorText ?? 'request failed',
        });
      } else if (status !== undefined && status >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${status}` });
      }
      span.end(Math.max(start, end));
    })();
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };

  const onFinished = (request: Request) => record(request, false);
  const onFailed = (request: Request) => record(request, true);
  const onConsole = (message: ConsoleMessage) => {
    const type = message.type();
    // Info and debug output is the app talking to its developers; errors and
    // warnings are what a reader of a failing test wants next to the steps.
    if (type !== 'error' && type !== 'warning') return;
    const { url, lineNumber } = message.location();
    emit('browser.console', type === 'error' ? 'ERROR' : 'WARN', message.text(), {
      'browser.console.level': type,
      ...(url ? { 'code.filepath': url, 'code.lineno': lineNumber } : {}),
    });
  };
  const onPageError = (error: Error) =>
    emit('exception', 'ERROR', `${error.name}: ${error.message}`, {
      'exception.type': error.name,
      'exception.message': error.message,
      ...(error.stack ? { 'exception.stacktrace': error.stack } : {}),
    });

  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  return async () => {
    page.off('requestfinished', onFinished);
    page.off('requestfailed', onFailed);
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    await Promise.allSettled([...pending]);
  };
}
