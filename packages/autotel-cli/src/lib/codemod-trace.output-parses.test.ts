import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
// ts-morph's own compiler API: the same parser the codemod runs on.
import { ts } from 'ts-morph';
import { transformFile } from './codemod-trace';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '../__fixtures__/codemod-trace');

/**
 * A codemod that rewrites source must emit source that still parses. The
 * function-declaration branches once dropped the closing paren of the
 * `trace(` call, so every declaration the codemod touched stopped compiling,
 * and the byte-comparison fixtures happily asserted the broken output.
 */
function parseErrors(code: string, fileName: string): string[] {
  // transpileModule reports syntactic diagnostics only, picking the script
  // kind from the file extension.
  const { diagnostics = [] } = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve },
  });
  return diagnostics.map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, ' '),
  );
}

function categories(): string[] {
  return fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe('codemod-trace emits parseable source', () => {
  for (const category of categories()) {
    const beforeDir = path.join(FIXTURES_DIR, category, 'before');
    if (!fs.existsSync(beforeDir)) continue;

    for (const fixture of fs.readdirSync(beforeDir)) {
      it(`${category}/${fixture}`, () => {
        const before = fs.readFileSync(path.join(beforeDir, fixture), 'utf8');
        const result = transformFile(before, `/fake/src/${fixture}`, {});

        expect(parseErrors(result.modified, fixture)).toEqual([]);
      });
    }
  }
});
