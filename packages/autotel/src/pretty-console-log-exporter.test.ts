import { describe, expect, it, vi } from 'vitest';
import { SeverityNumber } from '@opentelemetry/api';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { PrettyConsoleLogExporter } from './pretty-console-log-exporter';

/** The fields `format` reads; the rest of the record is irrelevant to a line. */
function record(fields: Partial<ReadableLogRecord>): ReadableLogRecord {
  // SAFETY: format() reads only body, severity, attributes and spanContext,
  // all supplied or defaulted here; the remaining fields are never touched.
  return { attributes: {}, ...fields } as ReadableLogRecord;
}

const plain = new PrettyConsoleLogExporter({ colors: false });

describe('PrettyConsoleLogExporter', () => {
  it('prints severity, body, attributes and a short trace id on one line', () => {
    const line = plain.format(
      record({
        severityText: 'info',
        body: 'order placed',
        attributes: { 'order.id': 'o-1', amount: 42 },
        spanContext: {
          traceId: '6e21a3f21cdc940ce421452d3ecfeb8c',
          spanId: 'e3cbea3374c446f7',
          traceFlags: 1,
        },
      }),
    );

    expect(line).toBe(
      'log  INFO   order placed  order.id=o-1 amount=42  trace=6e21a3f2',
    );
  });

  it('names the severity from its number when there is no text', () => {
    expect(
      plain.format(
        record({ severityNumber: SeverityNumber.ERROR2, body: 'x' }),
      ),
    ).toContain('ERROR');
    expect(plain.format(record({ body: 'x' }))).toContain('LOG');
  });

  it('prints a structured body as JSON, not [object Object]', () => {
    expect(plain.format(record({ body: { key1: 'val1' } }))).toContain(
      '{"key1":"val1"}',
    );
  });

  it('cuts long attribute values instead of flooding the terminal', () => {
    const line = plain.format(
      record({ body: 'x', attributes: { blob: 'a'.repeat(500) } }),
    );
    expect(line.length).toBeLessThan(120);
    expect(line).toContain('…');
  });

  it('colours only when asked', () => {
    const coloured = new PrettyConsoleLogExporter({ colors: true });
    expect(coloured.format(record({ body: 'x' }))).toContain('\u001B[');
    expect(plain.format(record({ body: 'x' }))).not.toContain('\u001B[');
  });

  it('reports success to the processor after printing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const done = vi.fn();
    plain.export([record({ body: 'x' })], done);
    spy.mockRestore();
    expect(done).toHaveBeenCalledWith({ code: 0 });
  });
});
