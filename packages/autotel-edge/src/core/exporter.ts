/**
 * Lightweight OTLP exporter for edge environments
 * Ported and adapted from @microlabs/
 *
 * This exporter is much smaller than the standard @opentelemetry/exporter-trace-otlp-http
 * because it uses fetch() directly instead of Node.js http/https modules.
 */

import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPExporterError } from '@opentelemetry/otlp-exporter-base';
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer';
import type { SpanExporter } from '@opentelemetry/sdk-trace';
import type { OTLPExporterConfig } from '../types';
import { asRecord, readProperty } from '../values';

// Version is injected at build time via tsup define
// This avoids runtime filesystem access which isn't available in edge environments
const PACKAGE_VERSION = process.env.AUTOTEL_EDGE_VERSION || '0.1.1';

const defaultHeaders = {
  accept: 'application/json',
  'content-type': 'application/json',
  'user-agent': `autotel-edge v${PACKAGE_VERSION}`,
} satisfies Record<string, string>;

/** What can succeed later: a timeout, throttling, a gateway or collector that is down. */
const TRANSIENT_STATUS = new Set([408, 429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
/**
 * The longest wait a retry may take. An edge request lives seconds past its
 * response at most, so a longer `Retry-After` fails the batch rather than
 * holding the invocation open for a retry that will never run.
 */
const MAX_WAIT_MS = 5000;

/** The wait a `Retry-After` header asks for, in seconds or as an HTTP date. */
export function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** Spans an OTLP collector refused inside a 2xx (`partialSuccess.rejectedSpans`), or 0. */
export async function rejectedSpans(response: Response): Promise<number> {
  if (!response.headers.get('content-type')?.includes('json')) {
    await response.body?.cancel();
    return 0;
  }
  const partial = asRecord(
    readProperty(await response.json().catch(() => null), 'partialSuccess'),
  );
  // int64 arrives as a string in OTLP/JSON.
  const count = Number(partial?.rejectedSpans ?? 0);
  return Number.isFinite(count) ? count : 0;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Minimal OTLP exporter using fetch()
 */
export class OTLPExporter implements SpanExporter {
  private headers: Record<string, string>;
  private url: string;

  constructor(config: OTLPExporterConfig) {
    this.url = config.url;
    this.headers = Object.assign({}, defaultHeaders, config.headers);
  }

  export(items: any[], resultCallback: (result: ExportResult) => void): void {
    this._export(items)
      .then(() => {
        resultCallback({ code: ExportResultCode.SUCCESS });
      })
      .catch((error) => {
        resultCallback({ code: ExportResultCode.FAILED, error });
      });
  }

  private _export(items: any[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.send(items, resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  send(
    items: any[],
    onSuccess: () => void,
    onError: (error: OTLPExporterError) => void,
  ): void {
    const decoder = new TextDecoder();
    const exportMessage = JsonTraceSerializer.serializeRequest(items);

    const body = decoder.decode(exportMessage);
    const params: RequestInit = {
      method: 'POST',
      headers: this.headers,
      body,
    };

    this.deliver(params, items.length).then(onSuccess, onError);
  }

  /**
   * Send, retrying only what can succeed later: a network error, 408, 429,
   * 502, 503 or 504, waiting as long as `Retry-After` asks within
   * `MAX_WAIT_MS`. Any other status is the payload and is sent once.
   */
  private async deliver(params: RequestInit, count: number): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      let wait: number | undefined;
      let status = 0;
      try {
        const response = await fetch(this.url, params);
        status = response.status;
        if (response.ok) {
          const rejected = await rejectedSpans(response);
          if (rejected > 0) {
            throw new OTLPExporterError(
              `Collector rejected ${rejected} of ${count} span(s) (partialSuccess)`,
              response.status,
            );
          }
          return;
        }
        if (!TRANSIENT_STATUS.has(response.status) || attempt >= MAX_ATTEMPTS) {
          await response.body?.cancel();
          throw new OTLPExporterError(
            `Exporter received a statusCode: ${response.status}`,
            response.status,
          );
        }
        wait = retryAfterMs(response.headers.get('retry-after'));
        // Read nothing more: release the body so Workers can reuse the connection.
        await response.body?.cancel();
      } catch (error) {
        if (error instanceof OTLPExporterError) throw error;
        if (attempt >= MAX_ATTEMPTS) {
          throw new OTLPExporterError(
            `Exception during export: ${String(error)}`,
            undefined,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
      // Jittered backoff, 200-400ms then 800-1600ms, unless the collector named a wait.
      const delay = wait ?? 200 * 4 ** (attempt - 1) * (1 + Math.random());
      if (delay > MAX_WAIT_MS) {
        throw new OTLPExporterError(
          `Collector asked to retry after ${Math.round(delay / 1000)}s; dropping ${count} span(s)`,
          status || undefined,
        );
      }
      await sleep(delay);
    }
  }

  async shutdown(): Promise<void> {
    // No-op for edge environments
  }
}
