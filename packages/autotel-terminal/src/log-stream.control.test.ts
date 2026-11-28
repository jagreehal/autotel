import { expect, it } from 'vitest';
import { getTerminalLogStream } from './log-stream';
import type { TerminalLogEvent } from './lib/log-model';
import { parseOtlpLogEvents } from './otlp-http-json';

it('escapes controls in request-logger events before delivering them to the dashboard', () => {
  const stream = getTerminalLogStream();
  const received: TerminalLogEvent[] = [];
  const unsubscribe = stream.onLog((event) => received.push(event));
  try {
    stream.emit({
      time: 1,
      level: 'info',
      message: 'request\r\u001B[2Kforged',
      attributes: { 'user\nagent': 'client\u001B[31m' },
    });
    expect(received[0]).toMatchObject({
      message: 'request\\r\\u001b[2Kforged',
      attributes: { 'user\\nagent': String.raw`client\u001b[31m` },
    });
  } finally {
    unsubscribe();
  }
});

it('uses the same escaped attribute keys for direct and OTLP log delivery', () => {
  const stream = getTerminalLogStream();
  const received: TerminalLogEvent[] = [];
  const unsubscribe = stream.onLog((event) => received.push(event));
  try {
    stream.emit({
      time: 1,
      level: 'info',
      message: 'request',
      attributes: { 'user\nagent': 'client' },
    });
    const [parsed] = parseOtlpLogEvents({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  severityNumber: 9,
                  body: { stringValue: 'request' },
                  attributes: [
                    { key: 'user\nagent', value: { stringValue: 'client' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    stream.emit(parsed!);
    expect(received[1]?.attributes).toEqual(received[0]?.attributes);
  } finally {
    unsubscribe();
  }
});
