import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  configureJsonOutput,
  printJson,
  redact,
  resetJsonOutput,
} from './json-output';

describe('redact', () => {
  beforeEach(() => resetJsonOutput());

  it('redacts string values under secret-shaped keys', () => {
    const out = redact({
      DATADOG_API_KEY: 'abc123',
      POSTHOG_TOKEN: 'tok',
      SENTRY_DSN: 'https://x@y/1',
      nested: { MY_SECRET: 's', visible: 'hi' },
    }) as Record<string, unknown>;
    expect(out['DATADOG_API_KEY']).toBe('[REDACTED]');
    expect(out['POSTHOG_TOKEN']).toBe('[REDACTED]');
    expect(out['SENTRY_DSN']).toBe('[REDACTED]');
    const nested = out['nested'] as Record<string, unknown>;
    expect(nested['MY_SECRET']).toBe('[REDACTED]');
    expect(nested['visible']).toBe('hi');
  });

  it('redacts long alphanumeric values', () => {
    const longSecret = 'A'.repeat(48);
    const out = redact({ random: longSecret }) as Record<string, unknown>;
    // Key doesn't match secret pattern, but value is long+alphanum -> redacted
    expect(out['random']).toBe('[REDACTED]');
  });

  it('leaves short non-secret values alone', () => {
    const out = redact({ name: 'jag', port: 3000 }) as Record<string, unknown>;
    expect(out['name']).toBe('jag');
    expect(out['port']).toBe(3000);
  });

  it('handles arrays', () => {
    const out = redact([{ TOKEN: 'x' }, 'hi']);
    expect(out).toEqual([{ TOKEN: '[REDACTED]' }, 'hi']);
  });
});

describe('printJson with --output-file', () => {
  let tmpDir: string;
  let stdoutWrites: string[];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-cli-test-'));
    stdoutWrites = [];
    writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stdoutWrites.push(String(chunk));
        return true;
      });
    resetJsonOutput();
  });

  afterEach(() => {
    writeSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetJsonOutput();
  });

  it('writes the first payload to disk and emits both to stdout', () => {
    const outFile = path.join(tmpDir, 'plan.json');
    configureJsonOutput({ outputFile: outFile, outputRoot: tmpDir });

    printJson({ tick: 1 });
    printJson({ tick: 2 });

    expect(stdoutWrites).toHaveLength(2);
    expect(stdoutWrites[0]).toContain('"tick": 1');
    expect(stdoutWrites[1]).toContain('"tick": 2');

    // Only the first payload persisted
    const onDisk = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    expect(onDisk).toEqual({ tick: 1 });
  });

  it('applies redaction when noSecrets is true', () => {
    configureJsonOutput({ noSecrets: true });
    printJson({ DATADOG_API_KEY: 'abc' });
    expect(stdoutWrites[0]).toContain('"DATADOG_API_KEY": "[REDACTED]"');
  });
});
