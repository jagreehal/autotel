import { describe, expect, it } from 'vitest';
import {
  diffAutoInstrumentations,
  diffImportSources,
  parseInstrumentation,
} from './instrumentation-parser';

const CLI_OWNED_SAMPLE = `/**
 * autotel instrumentation - managed by autotel-cli
 * Run \`autotel add <feature>\` to update this file
 */
import 'autotel/register';
import { init } from 'autotel';

// --- AUTOTEL:BACKEND ---
import { createDatadogConfig } from 'autotel-backends/datadog';

// --- AUTOTEL:LOGGER ---
import pino from 'pino';

const logger = pino({ name: 'app' });

init({
  logger: logger,
  autoInstrumentations: ['winston', 'bunyan'],
  // --- AUTOTEL:BACKEND_CONFIG ---
  ...createDatadogConfig({ apiKey: process.env.DATADOG_API_KEY }),
});
`;

const USER_OWNED_SAMPLE = `// Hand-written
import { init } from 'autotel';
init({});
`;

describe('parseInstrumentation', () => {
  it('detects CLI ownership header', () => {
    expect(parseInstrumentation(CLI_OWNED_SAMPLE).cliOwned).toBe(true);
    expect(parseInstrumentation(USER_OWNED_SAMPLE).cliOwned).toBe(false);
  });

  it('collects all imported sources (side-effect + named)', () => {
    const parsed = parseInstrumentation(CLI_OWNED_SAMPLE);
    expect(parsed.importedSources.has('autotel/register')).toBe(true);
    expect(parsed.importedSources.has('autotel')).toBe(true);
    expect(parsed.importedSources.has('autotel-backends/datadog')).toBe(true);
    expect(parsed.importedSources.has('pino')).toBe(true);
  });

  it('picks Pino as logger when imported', () => {
    expect(parseInstrumentation(CLI_OWNED_SAMPLE).detectedLogger).toBe('pino');
  });

  it('returns null logger when none imported', () => {
    expect(parseInstrumentation(USER_OWNED_SAMPLE).detectedLogger).toBeNull();
  });

  it('parses autoInstrumentations array', () => {
    expect(parseInstrumentation(CLI_OWNED_SAMPLE).autoInstrumentations).toEqual(
      ['winston', 'bunyan']
    );
  });

  it('returns empty autoInstrumentations when absent', () => {
    expect(parseInstrumentation(USER_OWNED_SAMPLE).autoInstrumentations).toEqual([]);
  });
});

describe('diffImportSources', () => {
  it('returns only sources not already in the existing file', () => {
    const parsed = parseInstrumentation(CLI_OWNED_SAMPLE);
    const next = diffImportSources(parsed, [
      'autotel-backends/datadog', // already there
      'autotel-sentry', // new
      '@sentry/node', // new
    ]);
    expect(next).toEqual(['autotel-sentry', '@sentry/node']);
  });
});

describe('diffAutoInstrumentations', () => {
  it('returns only entries not already present', () => {
    const parsed = parseInstrumentation(CLI_OWNED_SAMPLE);
    const next = diffAutoInstrumentations(parsed, [
      'winston', // already there
      'graphql', // new
    ]);
    expect(next).toEqual(['graphql']);
  });
});
