import { describe, expect, it } from 'vitest';
import {
  addAutoInstrumentation,
  addImport,
  createCodeFile,
  renderCodeFile,
} from './code-builder';

describe('code-builder autoInstrumentations', () => {
  it('emits the allowlist and never passes a logger to init()', () => {
    const file = createCodeFile();
    addImport(file, { source: 'autotel/register', sideEffect: true });
    addImport(file, { source: 'autotel', specifiers: ['init'] });
    addAutoInstrumentation(file, 'http');
    addAutoInstrumentation(file, 'pino');
    addAutoInstrumentation(file, 'winston');
    const out = renderCodeFile(file);

    expect(out).toContain("autoInstrumentations: ['http', 'pino', 'winston'],");
    expect(out).not.toContain('logger:');
    expect(out).not.toContain("from 'pino'");
  });

  it('does not duplicate identical entries', () => {
    const file = createCodeFile();
    addAutoInstrumentation(file, 'winston');
    addAutoInstrumentation(file, 'winston');
    expect(file.autoInstrumentations).toEqual(['winston']);
  });
});
