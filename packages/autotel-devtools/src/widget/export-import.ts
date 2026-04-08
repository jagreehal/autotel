/**
 * Export/Import utilities for traces
 * Allows exporting traces as JSON and importing them back for replay/demo
 */

import type { TraceData, SpanData } from './types';

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

/**
 * Validate span data structure
 */
function validateSpan(span: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!span || typeof span !== 'object') {
    errors.push(`${path}: Invalid span data`);
    return errors;
  }

  const s = span as Record<string, unknown>;

  if (typeof s.spanId !== 'string') {
    errors.push(`${path}: Missing or invalid spanId`);
  }
  if (typeof s.traceId !== 'string') {
    errors.push(`${path}: Missing or invalid traceId`);
  }
  if (typeof s.name !== 'string') {
    errors.push(`${path}: Missing or invalid name`);
  }
  if (typeof s.startTime !== 'number') {
    errors.push(`${path}: Missing or invalid startTime`);
  }
  if (typeof s.endTime !== 'number') {
    errors.push(`${path}: Missing or invalid endTime`);
  }
  if (typeof s.duration !== 'number') {
    errors.push(`${path}: Missing or invalid duration`);
  }
  if (!s.status || typeof s.status !== 'object') {
    errors.push(`${path}: Missing or invalid status`);
  }

  return errors;
}

/**
 * Validate trace data structure
 */
function validateTrace(
  trace: unknown,
  index: number,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const path = `trace[${index}]`;

  if (!trace || typeof trace !== 'object') {
    errors.push(`${path}: Invalid trace data`);
    return { errors, warnings };
  }

  const t = trace as Record<string, unknown>;

  if (typeof t.traceId !== 'string') {
    errors.push(`${path}: Missing or invalid traceId`);
  }
  if (typeof t.correlationId !== 'string') {
    warnings.push(`${path}: Missing correlationId, will use traceId`);
  }
  if (!t.rootSpan || typeof t.rootSpan !== 'object') {
    errors.push(`${path}: Missing or invalid rootSpan`);
  } else {
    errors.push(...validateSpan(t.rootSpan, `${path}.rootSpan`));
  }
  if (Array.isArray(t.spans)) {
    for (const [i, span] of t.spans.entries()) {
      errors.push(...validateSpan(span, `${path}.spans[${i}]`));
    }
  } else {
    errors.push(`${path}: Missing or invalid spans array`);
  }
  if (typeof t.startTime !== 'number') {
    errors.push(`${path}: Missing or invalid startTime`);
  }
  if (typeof t.endTime !== 'number') {
    errors.push(`${path}: Missing or invalid endTime`);
  }
  if (typeof t.duration !== 'number') {
    errors.push(`${path}: Missing or invalid duration`);
  }

  return { errors, warnings };
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
      errors: [`Invalid JSON: ${(error as Error).message}`],
      warnings: [],
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      success: false,
      traces: [],
      errors: ['Parsed data is not an object'],
      warnings: [],
    };
  }

  const data = parsed as Record<string, unknown>;

  // Check for version (optional but helpful)
  if (data.version && typeof data.version === 'string' && data.version !== EXPORT_VERSION) {
      warnings.push(
        `Version mismatch: expected ${EXPORT_VERSION}, got ${data.version}`,
      );
    }

  // Determine format: single trace or bundle
  if (data.trace && typeof data.trace === 'object') {
    // Single trace format
    const validation = validateTrace(data.trace, 0);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);

    if (validation.errors.length === 0) {
      traces.push(normalizeTrace(data.trace as TraceData));
    }
  } else if (Array.isArray(data.traces)) {
    // Bundle format
    for (const [index, trace] of data.traces.entries()) {
      const validation = validateTrace(trace, index);
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);

      if (validation.errors.length === 0) {
        traces.push(normalizeTrace(trace as TraceData));
      }
    }
  } else if (data.traceId) {
    // Direct trace object (no wrapper)
    const validation = validateTrace(data, 0);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);

    if (validation.errors.length === 0) {
      traces.push(normalizeTrace(data as unknown as TraceData));
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
      errors: [`Failed to read file: ${(error as Error).message}`],
      warnings: [],
    };
  }
}
