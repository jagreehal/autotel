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
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { OTLPExporterConfig } from '../types';

// Version is injected at build time via tsup define
// This avoids runtime filesystem access which isn't available in edge environments
const PACKAGE_VERSION = process.env.AUTOTEL_EDGE_VERSION || '0.1.1';

const defaultHeaders: Record<string, string> = {
  accept: 'application/json',
  'content-type': 'application/json',
  'user-agent': `autotel-edge v${PACKAGE_VERSION}`,
};

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

  private _export(items: any[]): Promise<unknown> {
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

    fetch(this.url, params)
      .then((response) => {
        if (response.ok) {
          onSuccess();
        } else {
          onError(
            new OTLPExporterError(
              `Exporter received a statusCode: ${response.status}`,
            ),
          );
        }
      })
      .catch((error) => {
        onError(
          new OTLPExporterError(
            `Exception during export: ${error.toString()}`,
            error.code,
            error.stack,
          ),
        );
      });
  }

  async shutdown(): Promise<void> {
    // No-op for edge environments
  }
}
