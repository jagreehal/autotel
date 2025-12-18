/**
 * Terminal Dashboard for Autotel
 *
 * Beautiful react-ink powered dashboard for viewing traces in real-time.
 *
 * @example Basic usage (auto-wire)
 * ```typescript
 * import { init } from 'autotel'
 * import { renderTerminal } from 'autotel-terminal'
 *
 * init({ service: 'my-app' })
 * renderTerminal() // Automatically creates stream from current tracer provider
 * ```
 *
 * @example With options
 * ```typescript
 * renderTerminal({
 *   title: 'My App Traces',
 *   showStats: true,
 *   maxSpans: 200,
 * })
 * ```
 *
 * @example Manual stream (advanced)
 * ```typescript
 * import { StreamingSpanProcessor } from 'autotel-terminal'
 * import { createTerminalSpanStream } from 'autotel-terminal'
 * import { BatchSpanProcessor } from 'autotel/processors'
 *
 * const processor = new StreamingSpanProcessor(new BatchSpanProcessor(exporter))
 * const stream = createTerminalSpanStream(processor)
 * renderTerminal({}, stream)
 * ```
 *
 * @module autotel-terminal
 */

import React, { useEffect, useMemo, useState } from 'react';
import { render, Box, Text, useInput } from 'ink';
import type { TerminalSpanEvent, TerminalSpanStream } from './span-stream';
import { StreamingSpanProcessor } from './streaming-processor';
import { createTerminalSpanStream } from './span-stream';
import { getAutotelTracerProvider } from 'autotel/tracer-provider';
import type { TracerProvider } from '@opentelemetry/api';

/**
 * Terminal dashboard options
 */
export interface TerminalOptions {
  /**
   * Dashboard title
   * @default 'Autotel Trace Inspector'
   */
  title?: string;

  /**
   * Show statistics bar (span count, error rate, avg duration)
   * @default true
   */
  showStats?: boolean;

  /**
   * Maximum number of spans to display
   * @default 100
   */
  maxSpans?: number;

  /**
   * Enable colors (auto-detect by default)
   * @default true if TTY
   */
  colors?: boolean;
}

// Helper for rendering duration
function ms(n: number): string {
  if (n < 1000) return `${n.toFixed(0)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

// Helper for truncating strings
function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  return s.slice(0, Math.max(0, width - 1)) + '…';
}

interface DashboardProps {
  title: string;
  showStats: boolean;
  maxSpans: number;
  colors: boolean;
  stream: TerminalSpanStream;
}

function Dashboard({
  title,
  showStats,
  maxSpans,
  colors,
  stream,
}: DashboardProps): React.ReactElement {
  const [paused, setPaused] = useState(false);
  const [spans, setSpans] = useState<TerminalSpanEvent[]>([]);
  const [selected, setSelected] = useState(0);
  const [filterErrorsOnly, setFilterErrorsOnly] = useState(false);

  useEffect(() => {
    const unsubscribe = stream.onSpanEnd((span) => {
      if (paused) return;
      setSpans((prev) => {
        const next = [span, ...prev];
        return next.slice(0, maxSpans);
      });
      setSelected(0);
    });
    return unsubscribe;
  }, [stream, paused, maxSpans]);

  const filtered = useMemo(() => {
    const list = filterErrorsOnly
      ? spans.filter((s) => s.status === 'ERROR')
      : spans;
    return list;
  }, [spans, filterErrorsOnly]);

  const stats = useMemo(() => {
    const total = spans.length;
    const errors = spans.filter((s) => s.status === 'ERROR').length;
    const avg = total
      ? spans.reduce((a, s) => a + s.durationMs, 0) / total
      : 0;
    const p95 = total
      ? (() => {
          const sorted = spans.map((s) => s.durationMs).toSorted((a, b) => a - b);
          return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        })()
      : 0;
    return { total, errors, avg, p95 };
  }, [spans]);

  const current = filtered[selected];

  useInput((input, key) => {
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow)
      setSelected((i) => Math.min(filtered.length - 1, i + 1));

    if (input === 'p') setPaused((p) => !p);
    if (input === 'e') setFilterErrorsOnly((v) => !v);

    if (input === 'c') {
      setSpans([]);
      setSelected(0);
    }
  });

  const headerRight = paused ? '[Paused]' : '[Live]';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      padding={1}
      borderColor={colors ? 'cyan' : undefined}
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>🔭 {title}</Text>
        <Text color={paused ? 'yellow' : 'green'}>{headerRight}</Text>
      </Box>

      {/* Help / controls */}
      <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
        <Text dimColor>
          ↑/↓ select • p pause • e errors-only • c clear • Ctrl+C exit
        </Text>
        <Text dimColor>
          showing {filtered.length}/{spans.length}
        </Text>
      </Box>

      {/* Main content: list + details */}
      <Box flexDirection="row" gap={2}>
        {/* List */}
        <Box
          flexDirection="column"
          width="55%"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          paddingY={0}
        >
          <Box marginTop={0} marginBottom={1}>
            <Text bold>Recent spans</Text>
            {filterErrorsOnly && <Text color="red"> (errors only)</Text>}
          </Box>

          {filtered.length === 0 ? (
            <Text dimColor>No spans yet. Generate some traffic…</Text>
          ) : (
            filtered.slice(0, 20).map((s, i) => {
              const isSel = i === selected;
              const statusColor =
                s.status === 'ERROR'
                  ? 'red'
                  : s.durationMs > 500
                    ? 'yellow'
                    : 'green';

              return (
                <Box key={s.spanId} flexDirection="row">
                  <Text color={isSel ? 'cyan' : undefined}>
                    {isSel ? '› ' : '  '}
                  </Text>
                  <Text color={colors ? statusColor : undefined}>
                    {truncate(s.name, 26)}
                  </Text>
                  <Text dimColor> {ms(s.durationMs)}</Text>
                  <Text dimColor> {truncate(s.traceId, 10)}</Text>
                </Box>
              );
            })
          )}
        </Box>

        {/* Details */}
        <Box
          flexDirection="column"
          width="45%"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          paddingY={0}
        >
          <Box marginBottom={1}>
            <Text bold>Details</Text>
          </Box>

          {current ? (
            <>
              <Text>
                <Text dimColor>Name: </Text>
                <Text>{current.name}</Text>
              </Text>
              <Text>
                <Text dimColor>Status: </Text>
                <Text color={current.status === 'ERROR' ? 'red' : 'green'}>
                  {current.status}
                </Text>
              </Text>
              <Text>
                <Text dimColor>Duration: </Text>
                <Text>{ms(current.durationMs)}</Text>
              </Text>
              <Text dimColor>Trace: {current.traceId}</Text>
              <Text dimColor>Span: {current.spanId}</Text>
              {current.parentSpanId && (
                <Text dimColor>Parent: {current.parentSpanId}</Text>
              )}
              {current.kind && <Text dimColor>Kind: {current.kind}</Text>}

              <Box marginTop={1} flexDirection="column">
                <Text bold>Attributes</Text>
                {current.attributes &&
                Object.keys(current.attributes).length > 0 ? (
                  Object.entries(current.attributes)
                    .slice(0, 12)
                    .map(([k, v]) => (
                      <Text key={k} dimColor>
                        {truncate(k, 22)}: {truncate(String(v), 34)}
                      </Text>
                    ))
                ) : (
                  <Text dimColor>(none)</Text>
                )}
              </Box>
            </>
          ) : (
            <Text dimColor>Select a span to view details.</Text>
          )}
        </Box>
      </Box>

      {/* Stats bar */}
      {showStats && (
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>
            Spans: {stats.total} | Errors: {stats.errors} | Avg: {ms(stats.avg)}{' '}
            | P95: {ms(stats.p95)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// Global streaming processor for auto-wiring
let globalStreamingProcessor: StreamingSpanProcessor | null = null;

/**
 * Check if a TracerProvider has an addSpanProcessor method
 * (Node.js SDK providers have this, but API-level providers don't)
 */
function canAddSpanProcessor(
  provider: TracerProvider,
): provider is TracerProvider & {
  addSpanProcessor: (processor: unknown) => void;
} {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'addSpanProcessor' in provider &&
    typeof (provider as { addSpanProcessor?: unknown }).addSpanProcessor ===
      'function'
  );
}

/**
 * Render the terminal dashboard
 *
 * Automatically wires up a streaming processor from the current tracer provider
 * if no stream is provided. Otherwise uses the provided stream.
 *
 * @param options - Dashboard configuration options
 * @param stream - Optional manual stream (for advanced use cases)
 *
 * @example Auto-wire (recommended)
 * ```typescript
 * import { init } from 'autotel'
 * import { renderTerminal } from 'autotel-terminal'
 *
 * init({ service: 'my-app' })
 * renderTerminal() // Automatically creates stream from current tracer provider
 * ```
 *
 * @example Manual stream
 * ```typescript
 * import { StreamingSpanProcessor } from 'autotel-terminal'
 * import { createTerminalSpanStream } from 'autotel-terminal'
 *
 * const processor = new StreamingSpanProcessor(baseProcessor)
 * const stream = createTerminalSpanStream(processor)
 * renderTerminal({}, stream)
 * ```
 */
export function renderTerminal(
  options: TerminalOptions = {},
  stream?: TerminalSpanStream,
): void {
  const title = options.title ?? 'Autotel Trace Inspector';
  const showStats = options.showStats !== false;
  const maxSpans = options.maxSpans ?? 100;
  const colors = options.colors ?? Boolean(process.stdout.isTTY);

  // If stream provided, use it directly
  if (stream) {
    try {
      render(
        <Dashboard
          title={title}
          showStats={showStats}
          maxSpans={maxSpans}
          colors={colors}
          stream={stream}
        />,
      );
    } catch (error) {
      console.error('[autotel-terminal] Failed to render dashboard:', error);
    }
    return;
  }

  // Otherwise, auto-wire from current tracer provider
  let provider: TracerProvider;
  try {
    provider = getAutotelTracerProvider();
  } catch (error) {
    console.error(
      '[autotel-terminal] Failed to get tracer provider. Call init() first or provide a stream.',
      error,
    );
    return;
  }

  if (!provider) {
    console.error(
      '[autotel-terminal] No tracer provider found. Call init() first or provide a stream.',
    );
    return;
  }

  // Check if provider supports addSpanProcessor (Node.js SDK providers do)
  if (!canAddSpanProcessor(provider)) {
    console.error(
      '[autotel-terminal] TracerProvider does not support addSpanProcessor. Provide a stream manually.',
    );
    return;
  }

  // Create streaming processor that doesn't wrap anything (just streams)
  // This way it doesn't interfere with existing processors
  globalStreamingProcessor = new StreamingSpanProcessor(null);
  const terminalStream = createTerminalSpanStream(globalStreamingProcessor);

  // Add streaming processor to provider
  provider.addSpanProcessor(globalStreamingProcessor);

  try {
    render(
      <Dashboard
        title={title}
        showStats={showStats}
        maxSpans={maxSpans}
        colors={colors}
        stream={terminalStream}
      />,
    );
  } catch (error) {
    console.error('[autotel-terminal] Failed to render dashboard:', error);
  }
}

// Re-export types and utilities
export type { TerminalSpanEvent, TerminalSpanStream } from './span-stream';
export { StreamingSpanProcessor } from './streaming-processor';
export { createTerminalSpanStream } from './span-stream';

// Re-export OpenTelemetry types for advanced users
export type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
export { SpanStatusCode, SpanKind } from 'autotel';

// Re-export PrettyConsoleExporter for convenience
export {
  PrettyConsoleExporter,
  type PrettyConsoleExporterOptions,
} from 'autotel/exporters';
