import { describe, it, expect } from 'vitest';
import type { TraceSummary } from './trace-model';
import type { TerminalLogEvent } from './log-model';
import { exportTraceToJson } from './export-model';

describe('exportTraceToJson', () => {
  it('exports a stable JSON structure with spans and logs', () => {
    const trace: TraceSummary = {
      traceId: 'trace-1',
      rootName: 'root',
      durationMs: 10,
      hasError: false,
      spanCount: 1,
      lastEndTime: 123,
      spans: [
        {
          name: 'root',
          spanId: 'span-1',
          traceId: 'trace-1',
          startTime: 1,
          endTime: 11,
          durationMs: 10,
          status: 'OK',
          attributes: { 'service.name': 'api' },
        },
      ],
    };

    const logs: TerminalLogEvent[] = [
      {
        time: 5,
        level: 'info',
        message: 'hello',
        traceId: 'trace-1',
        spanId: 'span-1',
        attributes: { a: 1 },
      },
    ];

    const json = exportTraceToJson(trace, logs);
    const parsed = JSON.parse(json) as unknown as {
      traceId: string;
      spans: Array<{ spanId: string }>;
      logs: Array<{ message: string }>;
    };

    expect(parsed.traceId).toBe('trace-1');
    expect(parsed.spans[0]!.spanId).toBe('span-1');
    expect(parsed.logs[0]!.message).toBe('hello');
  });
});
