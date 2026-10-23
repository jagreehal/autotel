import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetOptionalRequireForTesting,
  _setOptionalRequireForTesting,
  getSdk,
  init,
} from './init';
import { safeRequire } from './node-require';
import { shutdown } from './shutdown';

const OPENFEATURE_API = Symbol.for('@openfeature/js-sdk/api');

/** OpenFeature's API singleton, as an app that imported the SDK leaves it. */
function installFakeOpenFeature() {
  const hooks: unknown[] = [];
  (globalThis as Record<symbol, unknown>)[OPENFEATURE_API] = {
    addHooks: (...added: unknown[]) => hooks.push(...added),
    getHooks: () => hooks,
  };
  return hooks;
}

/** Whether `init()` wired an OTLP log exporter, however it wrapped it. */
function exportsLogs(): boolean {
  const seen = new Set<unknown>();
  const search = (value: unknown, depth: number): boolean => {
    if (depth > 4 || typeof value !== 'object' || value === null) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (value.constructor?.name === 'OTLPLogExporter') return true;
    return Object.values(value).some((child) => search(child, depth + 1));
  };
  const options = (getSdk() as unknown as { options: unknown }).options;
  return search(
    (options as { logRecordProcessors?: unknown }).logRecordProcessors,
    0,
  );
}

afterEach(async () => {
  _resetOptionalRequireForTesting();
  delete (globalThis as Record<symbol, unknown>)[OPENFEATURE_API];
  await shutdown();
});

describe('init() and OpenFeature', () => {
  it('registers the evaluation hook when OpenFeature is present', () => {
    const hooks = installFakeOpenFeature();
    init({ service: 'flags-test' });
    expect(hooks).toHaveLength(1);
  });

  it('turns on log export, since each evaluation is a log event', () => {
    installFakeOpenFeature();
    init({ service: 'flags-test', endpoint: 'http://127.0.0.1:4318' });
    expect(exportsLogs()).toBe(true);
  });

  it("treats logs: 'auto' as unset", () => {
    installFakeOpenFeature();
    init({
      service: 'flags-test',
      endpoint: 'http://127.0.0.1:4318',
      logs: 'auto',
    });
    expect(exportsLogs()).toBe(true);
  });

  it('leaves log export off when logs: false says so', () => {
    installFakeOpenFeature();
    init({
      service: 'flags-test',
      endpoint: 'http://127.0.0.1:4318',
      logs: false,
    });
    expect(exportsLogs()).toBe(false);
  });

  it('leaves log export off without OpenFeature', () => {
    // This workspace has the SDK installed; an app without it cannot load it.
    _setOptionalRequireForTesting(((id: string) =>
      id === '@openfeature/server-sdk'
        ? undefined
        : safeRequire(id)) as typeof safeRequire);
    init({ service: 'flags-test', endpoint: 'http://127.0.0.1:4318' });
    expect(exportsLogs()).toBe(false);
  });

  it('registers nothing with openFeature: false', () => {
    const hooks = installFakeOpenFeature();
    init({ service: 'flags-test', openFeature: false });
    expect(hooks).toHaveLength(0);
  });
});
