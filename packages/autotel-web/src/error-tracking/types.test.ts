import { describe, it, expect } from 'vitest';
import type {
  ExceptionRecord,
  ExceptionList,
} from './types';

describe('error-tracking types', () => {
  it('ExceptionRecord satisfies the expected shape', () => {
    const record: ExceptionRecord = {
      type: 'TypeError',
      value: 'Cannot read properties of undefined',
      mechanism: { type: 'onerror', handled: false },
      stacktrace: {
        frames: [
          {
            filename: 'app.js',
            function: 'handleClick',
            lineno: 42,
            colno: 10,
            in_app: true,
          },
        ],
      },
    };
    expect(record.type).toBe('TypeError');
    expect(record.stacktrace?.frames).toHaveLength(1);
  });

  it('ExceptionList supports cause chains', () => {
    const list: ExceptionList = [
      { type: 'Error', value: 'root cause', mechanism: { type: 'generic', handled: false } },
      { type: 'TypeError', value: 'outer error', mechanism: { type: 'onerror', handled: false } },
    ];
    expect(list).toHaveLength(2);
    expect(list[0].value).toBe('root cause');
  });
});
