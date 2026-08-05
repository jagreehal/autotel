import { describe, expect, it } from 'vitest';
import { helpText, parseCliArgs, VALUE_FLAGS } from './cli-args';

describe('parseCliArgs', () => {
  it('parses the invocations the README documents', () => {
    expect(parseCliArgs(['--transport', 'http', '--port', '3000']).overrides).toEqual(
      { AUTOTEL_TRANSPORT: 'http', AUTOTEL_PORT: '3000' },
    );
    expect(parseCliArgs(['--persist', './autotel.db']).overrides).toEqual({
      AUTOTEL_PERSIST: './autotel.db',
    });
  });

  it('accepts short flags and --flag=value', () => {
    expect(parseCliArgs(['-t', 'http', '-p', '8080', '-H', '0.0.0.0']).overrides).toEqual(
      {
        AUTOTEL_TRANSPORT: 'http',
        AUTOTEL_PORT: '8080',
        AUTOTEL_HOST: '0.0.0.0',
      },
    );
    expect(parseCliArgs(['--backend=jaeger', '--port=1234']).overrides).toEqual({
      AUTOTEL_BACKEND: 'jaeger',
      AUTOTEL_PORT: '1234',
    });
  });

  it('keeps a value that starts with a dash when it is attached with =', () => {
    expect(parseCliArgs(['--persist=-weird-name.db']).overrides).toEqual({
      AUTOTEL_PERSIST: '-weird-name.db',
    });
  });

  it('reports a missing value rather than swallowing the next flag', () => {
    const { errors, overrides } = parseCliArgs(['--port', '--transport', 'http']);
    expect(errors).toEqual(['--port requires a value']);
    expect(overrides).toEqual({ AUTOTEL_TRANSPORT: 'http' });

    expect(parseCliArgs(['--persist']).errors).toEqual([
      '--persist requires a value',
    ]);
  });

  it('warns about unknown options without refusing to start', () => {
    // MCP client configs in the wild already carry flags this binary never
    // defined — argv was read by nobody until this module existed.
    const { errors, warnings, overrides } = parseCliArgs([
      '--nope',
      '--port',
      '3000',
    ]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual(['unknown option ignored: --nope']);
    expect(overrides).toEqual({ AUTOTEL_PORT: '3000' });
  });

  it('accepts the Datadog region as a flag; it is not a credential', () => {
    const { errors, overrides } = parseCliArgs([
      '--datadog-site',
      'datadoghq.eu',
    ]);
    expect(errors).toEqual([]);
    expect(overrides).toEqual({ DD_SITE: 'datadoghq.eu' });
  });

  it('refuses credentials on the command line and names the env var', () => {
    const { errors, overrides } = parseCliArgs([
      '--datadog-api-key',
      'secret',
      '--port',
      '3000',
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('DD_API_KEY');
    // The secret is not carried anywhere, and the flag after it still parses.
    expect(JSON.stringify(overrides)).not.toContain('secret');
    expect(overrides).toEqual({ AUTOTEL_PORT: '3000' });
  });

  it('recognises help and version', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['--version']).version).toBe(true);
    expect(parseCliArgs(['-v']).version).toBe(true);
    expect(parseCliArgs([]).help).toBe(false);
  });

  it('parses nothing from an empty argv', () => {
    expect(parseCliArgs([])).toEqual({
      overrides: {},
      help: false,
      version: false,
      errors: [],
      warnings: [],
    });
  });
});

describe('helpText', () => {
  // The README promised these before anything parsed them. Keep the help and
  // the parser honest about each other.
  it('documents every flag the parser accepts', () => {
    // Read from the parser's own table: a second hand-written list here would
    // drift the moment a flag is added, which is the drift this test is for.
    const text = helpText();
    for (const [flag, envName] of Object.entries(VALUE_FLAGS)) {
      expect(text, `help is missing ${flag}`).toContain(flag);
      expect(text, `help is missing ${envName}`).toContain(envName);
    }
  });

  it('every example in the help actually parses', () => {
    const examples = helpText()
      .split('\n')
      .filter((line) => line.trim().startsWith('npx autotel-mcp'))
      .map((line) => line.trim().split(/\s+/).slice(2));

    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(parseCliArgs(example).errors, example.join(' ')).toEqual([]);
    }
  });
});
