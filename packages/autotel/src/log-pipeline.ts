/**
 * The log records `init()` exports, and where they go: the endpoint's OTLP
 * exporter, the caller's processors, the `debug` printer and PostHog, each
 * redacted and policy-checked like every other export path.
 */
import {
  BatchLogRecordProcessor,
  type LogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import type { AttributeRedactorFn } from './attribute-redacting-processor';
import type { AutotelConfig } from './autotel-config';
import {
  destinationSupportsSignal,
  type ResolvedOtlpDestination,
} from './config-resolution';
import { debugLogProcessor } from './debug-log-processor';
import { EventsOnlyLogRecordProcessor } from './events-only-log-processor';
import type { Logger } from './logger';
import type { LogExportMode } from './log-export-mode';
import { createLogExporter, formatEndpointUrl } from './otlp-exporters';
import { PolicyLogRecordProcessor } from './policy';
import {
  buildPostHogLogProcessors,
  RedactingLogRecordProcessor,
} from './posthog-logs';

/**
 * Unset, events still export: `ctx.event`, `transition()` history and flag
 * evaluations work once there is an endpoint, as on autotel-web. Plain logs
 * (pino, winston, console) wait for `logs: true`; `logs: false` or
 * AUTOTEL_LOGS=off sends nothing.
 */
export function resolveLogExportMode(
  logsEnabled: boolean,
  logs: AutotelConfig['logs'],
): LogExportMode {
  if (logsEnabled) return 'all';
  if (
    logs === false ||
    process.env.AUTOTEL_LOGS === 'off' ||
    process.env.AUTOTEL_LOGS === 'false'
  ) {
    return 'off';
  }
  // The spec's own switch, set: `none` is off, anything else is the SDK's
  // exporter sending every record, which autotel leaves alone.
  const fromEnv = process.env.OTEL_LOGS_EXPORTER?.trim().toLowerCase();
  if (fromEnv === 'none') return 'off';
  return fromEnv ? 'env' : 'events';
}

export interface LogPipelineOptions {
  mode: LogExportMode;
  configured: LogRecordProcessor[] | undefined;
  destinations: ResolvedOtlpDestination[];
  redactor: AttributeRedactorFn | null;
  isSensitiveKey: ((key: string) => boolean) | undefined;
  debugMode: boolean | 'pretty';
  posthog: AutotelConfig['posthog'];
  policies: AutotelConfig['policies'];
  logger: Logger;
}

export function buildLogRecordProcessors({
  mode,
  configured,
  destinations,
  redactor,
  isSensitiveKey,
  debugMode,
  posthog,
  policies,
  logger,
}: LogPipelineOptions): LogRecordProcessor[] | undefined {
  const onlyEventsWhenUnset = (
    processor: LogRecordProcessor,
  ): LogRecordProcessor =>
    mode === 'events' ? new EventsOnlyLogRecordProcessor(processor) : processor;

  let processors: LogRecordProcessor[] | undefined;
  if (configured && configured.length > 0) {
    // Redacted like every other log path: a processor the caller brings is
    // where logs most often leave the process.
    processors = configured.map((processor) =>
      redactor
        ? new RedactingLogRecordProcessor(processor, redactor, isSensitiveKey)
        : processor,
    );
  }

  // autotel's own exporter and debug printer, for `all` and `events`. Under
  // `env` they stay out: any processor passed in replaces the SDK's
  // OTEL_LOGS_EXPORTER exporter, which would then send nothing.
  const ownExport = mode === 'all' || mode === 'events';
  if (ownExport) {
    for (const destination of destinations) {
      if (!destinationSupportsSignal(destination, 'logs')) continue;

      const logExporter = createLogExporter(destination.protocol, {
        url: formatEndpointUrl(
          destination.endpoint,
          'logs',
          destination.protocol,
        ),
        headers: destination.headers,
      });

      let processor: LogRecordProcessor = new BatchLogRecordProcessor({
        exporter: logExporter,
      });
      if (redactor) {
        processor = new RedactingLogRecordProcessor(
          processor,
          redactor,
          isSensitiveKey,
        );
      }
      if (!processors) {
        processors = [];
      }
      processors.push(onlyEventsWhenUnset(processor));
    }

    if (
      destinations.some((destination) =>
        destinationSupportsSignal(destination, 'logs'),
      )
    ) {
      logger.info(
        {},
        mode === 'events'
          ? '[autotel] OTLP log exporter configured for events; logs: true exports all logs'
          : '[autotel] OTLP log exporter configured',
      );
    }
  }

  // `debug` shows what is exported, so it prints the records that export.
  if (ownExport && debugMode) {
    processors = [
      ...(processors ?? []),
      onlyEventsWhenUnset(
        debugLogProcessor(debugMode, redactor, isSensitiveKey),
      ),
    ];
  }

  // PostHog OTLP logs integration
  const posthogProcessors = buildPostHogLogProcessors(
    posthog,
    redactor,
    isSensitiveKey,
  );
  if (posthogProcessors.length > 0) {
    if (!processors) {
      processors = [];
    }
    processors.push(...posthogProcessors);
    logger.info({}, '[autotel] PostHog OTLP logs configured');
  }

  // Wrap every log processor with the policy applier so `log` policies apply on
  // all export paths. Gated on `policies` being configured, not on the policy
  // set being non-empty — the set is reloaded at runtime.
  if (policies && processors) {
    processors = processors.map(
      (processor) => new PolicyLogRecordProcessor(processor),
    );
  }
  return processors;
}
