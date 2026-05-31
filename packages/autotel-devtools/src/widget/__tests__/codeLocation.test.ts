import { describe, it, expect } from 'vitest';
import { buildCodeLocation } from '../utils/codeLocation';

describe('buildCodeLocation', () => {
  it('builds a vscode deep link from code.filepath + code.lineno', () => {
    const loc = buildCodeLocation(
      { 'code.filepath': '/Users/me/app/src/users.ts', 'code.lineno': 42 },
      'vscode',
    );
    expect(loc).not.toBeNull();
    expect(loc!.href).toBe('vscode://file/Users/me/app/src/users.ts:42');
  });

  it('returns null when there is no file path attribute', () => {
    expect(buildCodeLocation({ 'http.method': 'GET' }, 'vscode')).toBeNull();
    expect(buildCodeLocation({}, 'vscode')).toBeNull();
  });

  it('accepts the newer OTel semconv keys (code.file.path / code.line.number)', () => {
    const loc = buildCodeLocation(
      { 'code.file.path': '/Users/me/app/src/users.ts', 'code.line.number': 42 },
      'vscode',
    );
    expect(loc!.href).toBe('vscode://file/Users/me/app/src/users.ts:42');
  });

  it('omits the line suffix when no line number is present', () => {
    const loc = buildCodeLocation(
      { 'code.filepath': '/Users/me/app/src/users.ts' },
      'vscode',
    );
    expect(loc!.href).toBe('vscode://file/Users/me/app/src/users.ts');
    expect(loc!.line).toBeUndefined();
  });

  it('appends the column when present', () => {
    const loc = buildCodeLocation(
      {
        'code.filepath': '/Users/me/app/src/users.ts',
        'code.lineno': 42,
        'code.column': 8,
      },
      'vscode',
    );
    expect(loc!.href).toBe('vscode://file/Users/me/app/src/users.ts:42:8');
  });

  it('exposes a short display label (basename:line) and the function name', () => {
    const loc = buildCodeLocation(
      {
        'code.filepath': '/Users/me/app/src/users.ts',
        'code.lineno': 42,
        'code.function': 'getUser',
        'code.namespace': 'UserService',
      },
      'vscode',
    );
    expect(loc!.display).toBe('users.ts:42');
    expect(loc!.filepath).toBe('/Users/me/app/src/users.ts');
    expect(loc!.line).toBe(42);
    expect(loc!.functionName).toBe('getUser');
    expect(loc!.namespace).toBe('UserService');
  });

  it('builds a cursor deep link', () => {
    const loc = buildCodeLocation(
      { 'code.filepath': '/Users/me/app/src/users.ts', 'code.lineno': 42 },
      'cursor',
    );
    expect(loc!.href).toBe('cursor://file/Users/me/app/src/users.ts:42');
  });

  it('builds a JetBrains/WebStorm deep link with encoded path + line query', () => {
    const loc = buildCodeLocation(
      { 'code.filepath': '/Users/me/app/src/users.ts', 'code.lineno': 42 },
      'webstorm',
    );
    expect(loc!.href).toBe(
      'jetbrains://web-storm/navigate/reference?path=%2FUsers%2Fme%2Fapp%2Fsrc%2Fusers.ts&line=42',
    );
  });

  it('handles relative paths and string line numbers', () => {
    const loc = buildCodeLocation(
      { 'code.filepath': 'src/users.ts', 'code.lineno': '42' },
      'vscode',
    );
    expect(loc!.href).toBe('vscode://file/src/users.ts:42');
    expect(loc!.line).toBe(42);
  });
});
