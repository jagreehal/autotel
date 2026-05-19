import { describe, expect, it } from 'vitest';
import {
  addAutoInstrumentationLogger,
  addImport,
  createCodeFile,
  renderCodeFile,
  setPinoLogger,
} from './code-builder';

describe('code-builder logger wiring', () => {
  it('emits pino import + setup + logger: field for Pino-first-class', () => {
    const file = createCodeFile();
    addImport(file, { source: 'autotel/register', sideEffect: true });
    addImport(file, { source: 'autotel', specifiers: ['init'] });
    setPinoLogger(file);
    const out = renderCodeFile(file);

    expect(out).toContain("import pino from 'pino';");
    expect(out).toContain('const logger = pino({');
    expect(out).toContain('  logger: logger,');
    expect(out).toContain('// --- AUTOTEL:LOGGER ---');
  });

  it('emits autoInstrumentations: [...] for winston/bunyan', () => {
    const file = createCodeFile();
    addImport(file, { source: 'autotel/register', sideEffect: true });
    addImport(file, { source: 'autotel', specifiers: ['init'] });
    addAutoInstrumentationLogger(file, 'winston');
    addAutoInstrumentationLogger(file, 'bunyan');
    const out = renderCodeFile(file);
    expect(out).toContain("autoInstrumentations: ['winston', 'bunyan'],");
  });

  it('does not duplicate identical autoInstrumentation entries', () => {
    const file = createCodeFile();
    addAutoInstrumentationLogger(file, 'winston');
    addAutoInstrumentationLogger(file, 'winston');
    expect(file.autoInstrumentations).toEqual(['winston']);
  });

  it('combines pino primary + winston auto-instr', () => {
    const file = createCodeFile();
    addImport(file, { source: 'autotel/register', sideEffect: true });
    addImport(file, { source: 'autotel', specifiers: ['init'] });
    setPinoLogger(file);
    addAutoInstrumentationLogger(file, 'winston');
    const out = renderCodeFile(file);
    expect(out).toContain('  logger: logger,');
    expect(out).toContain("autoInstrumentations: ['winston'],");
  });
});
