import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveWithinRoot,
  readSourceWindow,
  resolveSourceRoot,
} from '../source-file';

let root: string;
let outside: string;

beforeAll(() => {
  const base = mkdtempSync(path.join(tmpdir(), 'devtools-source-'));
  root = path.join(base, 'project');
  outside = path.join(base, 'secrets');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(outside, 'creds.env'), 'TOKEN=hunter2\n');
  // Ten numbered lines, so an off-by-one in the window is visible rather than
  // plausible.
  writeFileSync(
    path.join(root, 'src', 'ten.ts'),
    Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n') + '\n',
  );
});

afterAll(() => {
  rmSync(path.dirname(root), { recursive: true, force: true });
});

describe('resolveWithinRoot', () => {
  it('refuses a relative path that climbs out of the root', () => {
    expect(resolveWithinRoot(root, '../secrets/creds.env')).toBeNull();
  });

  it('resolves a file that really is inside the root', () => {
    expect(resolveWithinRoot(root, 'src/app.ts')).toBe(
      path.join(root, 'src', 'app.ts'),
    );
  });

  it('refuses an absolute path outside the root', () => {
    expect(resolveWithinRoot(root, path.join(outside, 'creds.env'))).toBeNull();
  });

  it('refuses a symlink inside the root that points outside it', () => {
    const link = path.join(root, 'src', 'escape.ts');
    symlinkSync(path.join(outside, 'creds.env'), link);

    // Lexical containment passes here — only resolving the link catches it.
    expect(resolveWithinRoot(root, 'src/escape.ts')).toBeNull();
  });
});

describe('readSourceWindow', () => {
  it('returns the requested line with context either side', () => {
    const window = readSourceWindow(root, 'src/ten.ts', 5, 2);

    expect(window).toEqual({
      file: 'src/ten.ts',
      line: 5,
      startLine: 3,
      lines: ['line3', 'line4', 'line5', 'line6', 'line7'],
    });
  });

  it('clamps at the start of the file instead of padding', () => {
    const window = readSourceWindow(root, 'src/ten.ts', 2, 5);

    expect(window?.startLine).toBe(1);
    expect(window?.lines[0]).toBe('line1');
  });

  it('returns null for a path outside the root', () => {
    expect(readSourceWindow(root, '../secrets/creds.env', 1, 2)).toBeNull();
  });
});

describe('resolveSourceRoot', () => {
  it('defaults to the working directory, since that is the project you are debugging', () => {
    expect(resolveSourceRoot(undefined, '/proj')).toBe('/proj');
  });

  it('honours an explicit root', () => {
    expect(resolveSourceRoot('/elsewhere', '/proj')).toBe('/elsewhere');
  });

  it.each(['false', '0', 'off', ''])(
    'treats %o as "disable source reading entirely"',
    (value) => {
      expect(resolveSourceRoot(value, '/proj')).toBeUndefined();
    },
  );

  it('does not default on for a network bind, where any curl passes the guard', () => {
    expect(resolveSourceRoot(undefined, '/proj', false)).toBeUndefined();
  });

  it('still honours an explicit root on a network bind, since that is deliberate', () => {
    expect(resolveSourceRoot('/elsewhere', '/proj', false)).toBe('/elsewhere');
  });
});
