/**
 * Hook selection and naming, without a database.
 *
 * Registering hooks, compiling a model and reading back which handlers autotel
 * wrapped needs a `Schema` and nothing else, and calling a wrapper directly
 * needs only a `this` that looks like the receiver Mongoose would pass. So the
 * rules that decide *what* gets traced are pinned here, in the suite that runs
 * on every CI job, while `hooks.integration.test.ts` proves the same rules
 * against a real server.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import type { Tracer } from 'autotel';
import { instrumentMongoose, wrapHookHandler } from './instrumentation';
import type { InstrumentMongooseConfig, ResolvedConfig } from './types';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const tracer: Tracer = provider.getTracer('autotel-mongoose-selection-test');

beforeEach(() => {
  exporter.reset();
});

/** True when autotel wrapped this registered handler. */
function isWrapped(entry: { fn?: unknown }): boolean {
  return Boolean(
    (entry.fn as { __autotelWrappedHook?: boolean } | undefined)
      ?.__autotelWrappedHook,
  );
}

/**
 * Register `pre` hooks on a fresh instrumented Mongoose, then report which
 * hook names ended up with a wrapped handler. No connection is opened: hooks
 * are registered when a schema is defined, and read back from Kareem.
 */
function wrappedPreHooks(
  instrumentHooks: InstrumentMongooseConfig['instrumentHooks'],
  register: (schema: mongoose.Schema) => void,
): string[] {
  const instance = new mongoose.Mongoose();
  instrumentMongoose(instance, { instrumentHooks });

  const schema = new instance.Schema({ value: Number });
  register(schema);

  // SAFETY: Kareem's registry is the only place a wrapped handler is visible
  // without running a query against a server.
  const pres = (
    schema as unknown as {
      s: { hooks: { _pres: Map<string, Array<{ fn?: unknown }>> } };
    }
  ).s.hooks._pres;

  const names: string[] = [];
  for (const [name, entries] of pres) {
    if (entries.some((entry) => isWrapped(entry))) {
      names.push(String(name));
    }
  }
  return names;
}

describe('which hooks the selector traces', () => {
  it('traces every hook the application registers when true', () => {
    const names = wrappedPreHooks(true, (schema) => {
      schema.pre('save', function () {});
      schema.pre('validate', function () {});
    });

    expect(new Set(names)).toEqual(new Set(['save', 'validate']));
  });

  it('traces none when false', () => {
    const names = wrappedPreHooks(false, (schema) => {
      schema.pre('save', function () {});
    });

    expect(names).toEqual([]);
  });

  it('traces only the names in an include list', () => {
    const names = wrappedPreHooks(['save'], (schema) => {
      schema.pre('save', function () {});
      schema.pre('validate', function () {});
    });

    expect(names).toEqual(['save']);
  });

  it('drops the names in an exclude list', () => {
    const names = wrappedPreHooks({ exclude: ['validate'] }, (schema) => {
      schema.pre('save', function () {});
      schema.pre('validate', function () {});
    });

    expect(names).toEqual(['save']);
  });

  it('treats an empty include list as no hooks', () => {
    const names = wrappedPreHooks({ include: [] }, (schema) => {
      schema.pre('save', function () {});
    });

    expect(names).toEqual([]);
  });

  it('splits an array registration so each hook is selected on its own', () => {
    const all = wrappedPreHooks(true, (schema) => {
      schema.pre(['save', 'validate'], function () {});
    });
    const narrowed = wrappedPreHooks(['validate'], (schema) => {
      schema.pre(['save', 'validate'], function () {});
    });

    expect(new Set(all)).toEqual(new Set(['save', 'validate']));
    expect(narrowed).toEqual(['validate']);
  });
});

describe('which hooks belong to Mongoose', () => {
  it('leaves Mongoose’s own handlers alone and keeps the application’s', () => {
    // Named the way Mongoose names them in `lib/`. An application hook that
    // merely looks private stays traced: losing its span is the worse failure.
    const names = wrappedPreHooks(true, (schema) => {
      schema.pre('save', function shardingPluginPreSave() {});
      schema.pre('updateOne', function _setTimestampsOnUpdate() {});
      schema.pre('validate', function _normalise() {});
    });

    expect(names).toEqual(['validate']);
  });
});

describe('what a hook span is called', () => {
  const config = {
    dbName: '',
    peerName: '',
    peerPort: 27_017,
    tracerName: 'autotel-mongoose-selection-test',
    captureCollectionName: true,
    instrumentHooks: true,
    dbStatementSerializer: false,
    statementRedactor: false,
    customMethods: { enabled: false },
    // SAFETY: ResolvedConfig carries more than these paths read.
  } as unknown as ResolvedConfig;

  /** A receiver shaped like the Query Mongoose hands a query hook. */
  function queryFor(op: string) {
    return {
      op,
      model: {
        modelName: 'Thing',
        collection: { collectionName: 'things' },
      },
    };
  }

  it('names a string registration after the hook', () => {
    const wrapped = wrapHookHandler(
      function () {},
      'save',
      'pre',
      tracer,
      config,
    );
    wrapped.call(queryFor('save'));

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
      'mongoose.things.pre.save',
    ]);
  });

  it('names a RegExp registration after the operation that ran', () => {
    // One `pre(/^find/)` covers find, findOne, findOneAndUpdate and more, so
    // the pattern cannot name the span. The Query knows its own `op`.
    const wrapped = wrapHookHandler(
      function () {},
      /^find/,
      'pre',
      tracer,
      config,
    );
    wrapped.call(queryFor('find'));
    wrapped.call(queryFor('findOne'));

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
      'mongoose.things.pre.find',
      'mongoose.things.pre.findOne',
    ]);
  });

  it('applies the selector to a RegExp registration one operation at a time', () => {
    const wrapped = wrapHookHandler(function () {}, /^find/, 'pre', tracer, {
      ...config,
      instrumentHooks: { exclude: ['findOne'] },
    } as ResolvedConfig);
    wrapped.call(queryFor('find'));
    wrapped.call(queryFor('findOne'));

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
      'mongoose.things.pre.find',
    ]);
  });

  it('still runs a handler whose span was skipped', () => {
    let calls = 0;
    const wrapped = wrapHookHandler(
      function () {
        calls += 1;
      },
      /^find/,
      'pre',
      tracer,
      { ...config, instrumentHooks: false } as ResolvedConfig,
    );
    wrapped.call(queryFor('find'));

    expect(calls).toBe(1);
    expect(exporter.getFinishedSpans()).toEqual([]);
  });
});
