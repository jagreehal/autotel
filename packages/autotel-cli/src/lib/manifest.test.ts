import { describe, expect, it } from 'vitest';
import { createProgram } from '../cli';
import { COMMANDS, ERROR_CATALOGUE, getCommand } from './manifest';
import { AutotelErrorCodes } from './errors';

/**
 * Drift test: every command described in the manifest must exist in the
 * commander dispatcher, and every dispatched command must be described.
 * Catches the same drift bugs that bit wrangler-deploy.
 */
describe('manifest drift', () => {
  const program = createProgram();

  const dispatchedNames = new Set<string>();
  // Collect top-level command names and one level of subcommands (e.g. codemod trace, schema errors).
  for (const cmd of program.commands) {
    dispatchedNames.add(cmd.name());
    for (const sub of cmd.commands) {
      dispatchedNames.add(`${cmd.name()} ${sub.name()}`);
    }
  }

  const manifestNames = new Set(COMMANDS.map((c) => c.name));

  it('every manifest command exists in the dispatcher', () => {
    const missing = [...manifestNames].filter((n) => !dispatchedNames.has(n));
    expect(missing, `Manifest describes commands not in dispatcher: ${missing.join(', ')}`).toEqual([]);
  });

  it('every dispatched command is described in the manifest (or is intentionally hidden)', () => {
    // Allow commander internals + parent groups that have no own action,
    // only subcommands (those subcommands carry their own manifest entries
    // like "codemod trace" and "schema errors").
    const allowMissing = new Set(['help', 'codemod', 'telemetry']);
    const undocumented = [...dispatchedNames].filter(
      (n) => !manifestNames.has(n) && !allowMissing.has(n)
    );
    expect(
      undocumented,
      `Dispatcher exposes commands not in manifest: ${undocumented.join(', ')}`
    ).toEqual([]);
  });

  it('all manifest entries have non-empty descriptions and flags arrays', () => {
    for (const c of COMMANDS) {
      expect(c.description.length).toBeGreaterThan(0);
      expect(Array.isArray(c.flags)).toBe(true);
    }
  });
});

describe('error catalogue', () => {
  it('covers every AUTOTEL_E_* code declared in errors.ts', () => {
    const declared = new Set(Object.values(AutotelErrorCodes));
    const catalogued = new Set(ERROR_CATALOGUE.map((e) => e.code));
    const missing = [...declared].filter((c) => !catalogued.has(c));
    expect(missing, `Codes missing from catalogue: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('getCommand', () => {
  it('finds a known command', () => {
    expect(getCommand('init')).toBeDefined();
    expect(getCommand('init')?.mutating).toBe(true);
  });
  it('returns undefined for unknown', () => {
    expect(getCommand('nope')).toBeUndefined();
  });
});
