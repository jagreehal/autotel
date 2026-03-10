import { describe, it, expect } from 'vitest';
import { parseStack } from './stack-parser';

describe('parseStack', () => {
  it('parses Chrome/V8 stack trace', () => {
    const stack = `TypeError: Cannot read properties of undefined (reading 'foo')
    at handleClick (https://example.com/static/js/app.js:42:10)
    at HTMLButtonElement.onclick (https://example.com/static/js/app.js:100:5)`;

    const frames = parseStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      function: 'handleClick',
      filename: 'app.js',
      abs_path: 'https://example.com/static/js/app.js',
      lineno: 42,
      colno: 10,
      in_app: true,
    });
  });

  it('parses Firefox stack trace', () => {
    const stack = `handleClick@https://example.com/static/js/app.js:42:10
onclick@https://example.com/static/js/app.js:100:5`;

    const frames = parseStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe('handleClick');
    expect(frames[0].lineno).toBe(42);
  });

  it('parses Safari stack trace', () => {
    const stack = `handleClick@https://example.com/static/js/app.js:42:10
https://example.com/static/js/app.js:100:5`;

    const frames = parseStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe('handleClick');
    expect(frames[1].function).toBeUndefined();
  });

  it('parses anonymous functions', () => {
    const stack = `Error: test
    at https://example.com/app.js:10:5
    at <anonymous>:1:1`;

    const frames = parseStack(stack);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0].function).toBeUndefined();
  });

  it('marks node_modules frames as not in_app', () => {
    const stack = `Error: test
    at myFunc (https://example.com/app.js:10:5)
    at libFunc (https://example.com/node_modules/lib/index.js:20:3)`;

    const frames = parseStack(stack);
    expect(frames[0].in_app).toBe(true);
    expect(frames[1].in_app).toBe(false);
  });

  it('returns empty array for empty/undefined input', () => {
    expect(parseStack('')).toEqual([]);
    expect(parseStack(undefined as any)).toEqual([]);
  });
});
