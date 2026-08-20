/**
 * Export/Import utilities for traces
 * Allows exporting traces as JSON and importing them back for replay/demo
 */

import type {
  TraceData,
  SpanData,
  LogData,
  MetricData,
  ErrorGroup,
} from './types';
import type { JsonObject } from './utils/json-fields';
import {
  arrayField,
  asObject,
  hasArrayField,
  missingFields,
  numberField,
  objectField,
  stringField,
} from './utils/json-fields';

/**
 * Export format version for compatibility checking
 */
const EXPORT_VERSION = '1.0.0';

/**
 * Exported trace data format
 */
export interface ExportedTraceData {
  version: string;
  exportedAt: string;
  trace: TraceData;
}

/**
 * Exported traces bundle (for multiple traces)
 */
export interface ExportedTracesBundle {
  version: string;
  exportedAt: string;
  traces: TraceData[];
}

/**
 * Import result with validation status
 */
export interface ImportResult {
  success: boolean;
  traces: TraceData[];
  errors: string[];
  warnings: string[];
}

/**
 * Export a single trace as JSON
 */
export function exportTrace(trace: TraceData): ExportedTraceData {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    trace,
  };
}

/**
 * Export multiple traces as JSON bundle
 */
export function exportTraces(traces: TraceData[]): ExportedTracesBundle {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    traces,
  };
}

/**
 * Convert export data to JSON string
 */
export function exportToJsonString(
  data: ExportedTraceData | ExportedTracesBundle,
): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Download trace as JSON file
 */
export function downloadTraceAsJson(trace: TraceData, filename?: string): void {
  const exportData = exportTrace(trace);
  const json = exportToJsonString(exportData);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const defaultFilename = `trace-${trace.traceId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}.json`;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || defaultFilename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download multiple traces as JSON file
 */
export function downloadTracesAsJson(
  traces: TraceData[],
  filename?: string,
): void {
  const exportData = exportTraces(traces);
  const json = exportToJsonString(exportData);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const defaultFilename = `traces-${traces.length}-${new Date().toISOString().split('T')[0]}.json`;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || defaultFilename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Copy trace JSON to clipboard
 */
export async function copyTraceToClipboard(trace: TraceData): Promise<void> {
  const exportData = exportTrace(trace);
  const json = exportToJsonString(exportData);
  await navigator.clipboard.writeText(json);
}

/** What a validation pass has to say about one trace. */
interface ValidationMessages {
  errors: string[];
  warnings: string[];
}

/**
 * Validate span data structure
 */
function validateSpan(span: JsonObject | undefined, path: string): string[] {
  if (!span) return [`${path}: Invalid span data`];
  const s = span;

  return [
    ...missingFields(s, path, stringField, ['spanId', 'traceId', 'name']),
    ...missingFields(s, path, numberField, [
      'startTime',
      'endTime',
      'duration',
    ]),
    ...missingFields(s, path, objectField, ['status']),
  ];
}

/**
 * Validate trace data structure
 */
function validateTrace(
  trace: JsonObject | undefined,
  index: number,
): ValidationMessages {
  const path = `trace[${index}]`;
  if (!trace) return { errors: [`${path}: Invalid trace data`], warnings: [] };
  const t = trace;

  const warnings = stringField(t, 'correlationId')
    ? []
    : [`${path}: Missing correlationId, will use traceId`];

  const rootSpan = objectField(t, 'rootSpan');
  const spans = hasArrayField(t, 'spans')
    ? arrayField(t, 'spans').flatMap((span, i) =>
        validateSpan(asObject(span), `${path}.spans[${i}]`),
      )
    : [`${path}: Missing or invalid spans array`];

  return {
    errors: [
      ...missingFields(t, path, stringField, ['traceId']),
      ...(rootSpan
        ? validateSpan(rootSpan, `${path}.rootSpan`)
        : [`${path}: Missing or invalid rootSpan`]),
      ...spans,
      ...missingFields(t, path, numberField, [
        'startTime',
        'endTime',
        'duration',
      ]),
    ],
    warnings,
  };
}

/**
 * A trace that validateTrace() has just accepted, read as a TraceData.
 *
 * SAFETY: validateTrace checks every required field of the trace and of every
 * span it carries, which is what TraceData declares. TypeScript cannot carry
 * that verdict across the call, so it is restated once here rather than at
 * each of the three call sites.
 */
function validatedTrace(trace: JsonObject): TraceData {
  // SAFETY: see the note above. The `unknown` hop is TypeScript's, not a
  // widening: an interface has no implicit index signature, so it never
  // overlaps a bag of unread fields in one step.
  return trace as unknown as TraceData;
}

/**
 * Parse and validate imported JSON
 */
export function parseImportedJson(jsonString: string): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const traces: TraceData[] = [];

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    return {
      success: false,
      traces: [],
      errors: [
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
      warnings: [],
    };
  }

  const data = asObject(parsed);
  if (!data) {
    return {
      success: false,
      traces: [],
      errors: ['Parsed data is not an object'],
      warnings: [],
    };
  }

  // Check for version (optional but helpful)
  const version = stringField(data, 'version');
  if (version && version !== EXPORT_VERSION) {
    warnings.push(
      `Version mismatch: expected ${EXPORT_VERSION}, got ${version}`,
    );
  }

  // Determine format: single trace or bundle
  const single = objectField(data, 'trace');
  if (single) {
    // Single trace format
    const validation = validateTrace(single, 0);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);

    if (validation.errors.length === 0) {
      traces.push(normalizeTrace(validatedTrace(single)));
    }
  } else if (hasArrayField(data, 'traces')) {
    // Bundle format
    for (const [index, entry] of arrayField(data, 'traces').entries()) {
      const trace = asObject(entry);
      const validation = validateTrace(trace, index);
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);

      if (trace && validation.errors.length === 0) {
        traces.push(normalizeTrace(validatedTrace(trace)));
      }
    }
  } else if (data.traceId) {
    // Direct trace object (no wrapper)
    const validation = validateTrace(data, 0);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);

    if (validation.errors.length === 0) {
      traces.push(normalizeTrace(validatedTrace(data)));
    }
  } else {
    errors.push(
      'Unrecognized format: expected { trace: ... } or { traces: [...] } or direct trace object',
    );
  }

  return {
    success: errors.length === 0 && traces.length > 0,
    traces,
    errors,
    warnings,
  };
}

/**
 * Normalize trace data (fill in defaults, fix types)
 */
function normalizeTrace(trace: TraceData): TraceData {
  return {
    ...trace,
    correlationId: trace.correlationId || trace.traceId.slice(0, 8),
    service: trace.service || 'imported',
    status:
      trace.status ||
      (trace.spans.some((s) => s.status.code === 'ERROR') ? 'ERROR' : 'OK'),
    spans: trace.spans.map(normalizeSpan),
    rootSpan: normalizeSpan(trace.rootSpan),
  };
}

/**
 * Normalize span data
 */
function normalizeSpan(span: SpanData): SpanData {
  return {
    ...span,
    kind: span.kind || 'INTERNAL',
    attributes: span.attributes || {},
    status: {
      code: span.status?.code || 'UNSET',
      message: span.status?.message,
    },
    events: span.events || [],
  };
}

/**
 * Read file as text
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // SAFETY: readAsText below is what fills `result`, and it always fills it
    // with text. The union is there for readAsArrayBuffer, which is not used.
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Import traces from a File object
 */
export async function importTracesFromFile(file: File): Promise<ImportResult> {
  try {
    const text = await readFileAsText(file);
    return parseImportedJson(text);
  } catch (error) {
    return {
      success: false,
      traces: [],
      errors: [
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      ],
      warnings: [],
    };
  }
}

// ============================================================================
// Full devtools snapshot — captures traces + logs + errors + metrics
// for sharing a complete local repro.
// ============================================================================

export interface SnapshotPayload {
  traces: TraceData[];
  logs: LogData[];
  errors: ErrorGroup[];
  metrics: MetricData[];
}

export interface ExportedSnapshot {
  version: string;
  kind: 'autotel-devtools-snapshot';
  capturedAt: string;
  data: SnapshotPayload;
}

export interface SnapshotImportResult {
  success: boolean;
  snapshot?: SnapshotPayload;
  errors: string[];
  warnings: string[];
}

export function exportSnapshot(payload: SnapshotPayload): ExportedSnapshot {
  return {
    version: EXPORT_VERSION,
    kind: 'autotel-devtools-snapshot',
    capturedAt: new Date().toISOString(),
    data: payload,
  };
}

export function downloadSnapshotAsJson(
  payload: SnapshotPayload,
  filename?: string,
): void {
  const json = JSON.stringify(exportSnapshot(payload), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const defaultFilename = `autotel-snapshot-${new Date().toISOString().replaceAll(':', '-').split('.')[0]}.json`;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || defaultFilename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * One array out of a snapshot, read as the records that section holds.
 *
 * SAFETY: a snapshot is a file this devtools wrote, so its sections hold the
 * records they are named for. Unlike an imported trace, a snapshot section is
 * not validated field by field - a hand-edited one renders as whatever it
 * contains, which is the point of being able to share a repro.
 */
function snapshotSection<TRecord>(data: JsonObject, key: string): TRecord[] {
  // SAFETY: see the note above.
  return arrayField(data, key) as TRecord[];
}

export function parseImportedSnapshot(
  jsonString: string,
): SnapshotImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    return {
      success: false,
      errors: [
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
      warnings: [],
    };
  }

  const root = asObject(parsed);
  if (!root) {
    return {
      success: false,
      errors: ['Snapshot is not an object'],
      warnings: [],
    };
  }

  const warnings: string[] = [];

  if (root.kind && root.kind !== 'autotel-devtools-snapshot') {
    warnings.push(`Unexpected snapshot kind: ${String(root.kind)}`);
  }
  const version = stringField(root, 'version');
  if (version && version !== EXPORT_VERSION) {
    warnings.push(
      `Version mismatch: expected ${EXPORT_VERSION}, got ${version}`,
    );
  }

  const data = objectField(root, 'data') ?? root;

  const traces = snapshotSection<TraceData>(data, 'traces').map(normalizeTrace);
  const logs = snapshotSection<LogData>(data, 'logs');
  const errors = snapshotSection<ErrorGroup>(data, 'errors');
  const metrics = snapshotSection<MetricData>(data, 'metrics');

  if (
    traces.length === 0 &&
    logs.length === 0 &&
    errors.length === 0 &&
    metrics.length === 0
  ) {
    return {
      success: false,
      errors: ['Snapshot contains no traces, logs, errors, or metrics'],
      warnings,
    };
  }

  return {
    success: true,
    snapshot: { traces, logs, errors, metrics },
    errors: [],
    warnings,
  };
}

export async function importSnapshotFromFile(
  file: File,
): Promise<SnapshotImportResult> {
  try {
    const text = await readFileAsText(file);
    return parseImportedSnapshot(text);
  } catch (error) {
    return {
      success: false,
      errors: [
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      ],
      warnings: [],
    };
  }
}
