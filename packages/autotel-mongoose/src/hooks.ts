/** Spans for the schema hooks an application registers (`pre` / `post`). */

import { context, SpanKind } from 'autotel';
import type { Span, Tracer } from 'autotel';
import { runWithSpan, finalizeSpan } from 'autotel/trace-helpers';
import {
  ATTR_DB_SYSTEM_NAME,
  ATTR_DB_COLLECTION_NAME,
  ATTR_DB_NAMESPACE,
  DB_SYSTEM_NAME_VALUE_MONGODB,
} from './constants';
import type { MethodSelector, ResolvedConfig } from './types.js';
import {
  asFunction,
  asString,
  callFunction,
  isFunction,
  readProperty,
  toError,
} from './values.js';
import { hasMarker, setMarker, WRAPPED_HOOK_FLAG } from './markers';
import { selectorAllows } from './selector';

/**
 * Patches Mongoose Schema hooks (pre/post) to automatically trace them.
 * Only wraps user-defined hooks, skipping Mongoose's internal hooks.
 */
export function patchSchemaHooks(
  Schema: any,
  tracer: Tracer,
  config: ResolvedConfig,
): void {
  if (!Schema?.prototype) {
    return;
  }

  const HOOK_FLAG = '__autotelHookInstrumented' as const;
  if (hasMarker(Schema.prototype, HOOK_FLAG)) {
    return;
  }

  const originalPre = asFunction(Schema.prototype.pre);
  if (originalPre) {
    Schema.prototype.pre = function (
      hookName: string | RegExp | string[],
      ...args: any[]
    ): any {
      // `pre(['save', 'validate'], fn)` registers one handler for several
      // hooks. Left whole, the array reached the span name verbatim
      // (`pre.save,validate`) and the selector could not match any single
      // entry. Splitting it here registers each hook the way Mongoose would,
      // so both name and selector see one operation at a time.
      if (Array.isArray(hookName)) {
        let result: any;
        for (const singleName of hookName) {
          result = callFunction(
            Schema.prototype.pre as (...a: never[]) => unknown,
            this,
            [singleName, ...args],
          );
        }
        return result;
      }

      const handler = asFunction(args[0]) ?? asFunction(args[1]) ?? null;

      // A RegExp covers whichever operations match, so it cannot be selected
      // until one runs; `wrapHookHandler` applies the selector per call.
      const selectable = typeof hookName !== 'string';

      // Only wrap user-defined hooks the selector allows, skip Mongoose internals
      if (
        handler &&
        (selectable || selectorAllows(config.instrumentHooks, hookName)) &&
        !isMongooseInternalHook(handler)
      ) {
        const wrapped = wrapHookHandler(
          handler,
          hookName,
          'pre',
          tracer,
          config,
        );
        if (typeof args[0] === 'function') {
          args[0] = wrapped;
        } else if (typeof args[1] === 'function') {
          args[1] = wrapped;
        }
      }

      return callFunction(originalPre, this, [hookName, ...args]);
    };
  }

  const originalPost = asFunction(Schema.prototype.post);
  if (originalPost) {
    Schema.prototype.post = function (
      hookName: string | RegExp | string[],
      ...args: any[]
    ): any {
      // `post(['save', 'validate'], fn)` registers one handler for several
      // hooks. Left whole, the array reached the span name verbatim
      // (`post.save,validate`) and the selector could not match any single
      // entry. Splitting it here registers each hook the way Mongoose would,
      // so both name and selector see one operation at a time.
      if (Array.isArray(hookName)) {
        let result: any;
        for (const singleName of hookName) {
          result = callFunction(
            Schema.prototype.post as (...a: never[]) => unknown,
            this,
            [singleName, ...args],
          );
        }
        return result;
      }

      const handler = asFunction(args[0]) ?? asFunction(args[1]) ?? null;

      // A RegExp covers whichever operations match, so it cannot be selected
      // until one runs; `wrapHookHandler` applies the selector per call.
      const selectable = typeof hookName !== 'string';

      // Only wrap user-defined hooks the selector allows, skip Mongoose internals
      if (
        handler &&
        (selectable || selectorAllows(config.instrumentHooks, hookName)) &&
        !isMongooseInternalHook(handler)
      ) {
        const wrapped = wrapHookHandler(
          handler,
          hookName,
          'post',
          tracer,
          config,
        );
        if (typeof args[0] === 'function') {
          args[0] = wrapped;
        } else if (typeof args[1] === 'function') {
          args[1] = wrapped;
        }
      }

      return callFunction(originalPost, this, [hookName, ...args]);
    };
  }

  setMarker(Schema.prototype, HOOK_FLAG);
}

/**
 * Detects if a hook handler is from Mongoose's internal code.
 * Skips private methods, known internal patterns, and functions with
 * Mongoose-internal source code signatures.
 *
 * Note: We intentionally allow anonymous functions because user-defined
 * hooks are often anonymous (e.g., `schema.pre('save', async function() {...})`).
 */
function isMongooseInternalHook(handler: unknown): boolean {
  if (!isFunction(handler)) return false;

  // Read `name` off the function directly. `readProperty` goes through
  // `asRecord`, which requires `typeof value === 'object'` and so answers
  // `undefined` for every function, leaving `funcName` empty and every rule
  // below unreachable. Mongoose's own plugin hooks then reached
  // `wrapHookHandler`, and a `post('init')` on a schema produced two spans per
  // hydrated document: the application's and Mongoose's.
  const funcName = asString((handler as { name?: unknown }).name) ?? '';

  // Mongoose's own hook handlers, taken from its `.pre(...)` / `.post(...)`
  // registrations in `lib/`, so this list is checkable against the dependency
  // rather than guessed at. Anything Mongoose registers anonymously is left to
  // the source-pattern check below.
  //
  // Matched as prefixes and deliberately specific. A substring match on a
  // generic word, or a rule treating any `_`-prefixed name as internal, also
  // swallows application hooks: losing an application span is a worse failure
  // than tracing one hook of Mongoose's. autotel's own wrapper is recognised
  // by its marker in `wrapHookHandler`, so it needs no name rule here.
  const mongooseInternalNamePrefixes = [
    'shardingPlugin', // lib/plugins/sharding.js
    'saveSubdocs', // lib/plugins/saveSubdocs.js
    'trackTransaction', // lib/plugins/trackTransaction.js
    'timestampsPre', // lib/helpers/timestamps, on save
    '_setTimestampsOnUpdate', // the same, on every update-shaped hook
    'virtualPreInit', // lib/schema.js, on init
    'handleTimestampOption',
    'mongooseInternalHook',
  ];

  if (
    mongooseInternalNamePrefixes.some((prefix) => funcName.startsWith(prefix))
  ) {
    return true;
  }

  // Check function source for Mongoose-internal patterns
  // These patterns appear in Mongoose's auto-generated validation/transform hooks
  try {
    const source = handler.toString();
    const mongooseInternalSourcePatterns = [
      'this.$__', // Mongoose internal document methods
      'this.$isValid', // Mongoose validation
      'this.$locals', // Mongoose local properties
      '_this.$__', // Mongoose internal with closure
      'schema.s.hooks', // Mongoose hooks system
      'kareem', // Mongoose's hooks library
    ];

    if (
      mongooseInternalSourcePatterns.some((pattern) => source.includes(pattern))
    ) {
      return true;
    }
  } catch {
    // If we can't get source, allow the hook through
  }

  return false;
}

/**
 * The hook name to put in a span.
 *
 * `Schema.prototype.pre`/`post` accept a string, an array of strings, or a
 * RegExp. Arrays are split at registration (see `patchSchemaHooks`), so only a
 * RegExp reaches here — and one registration then covers several operations:
 * `pre(/^find/)` runs for `find`, `findOne`, `findOneAndUpdate` and more. The
 * registration argument cannot name the operation that actually ran, but a
 * Query knows its own `op`, so ask it first and fall back to the pattern's
 * source. Naming every one of them `pre./^find/` told you a hook ran and
 * nothing else.
 */
function resolveHookName(hookName: string | RegExp, self: unknown): string {
  if (typeof hookName === 'string') {
    return hookName;
  }
  const op = asString(readProperty(self, 'op'));
  return op ?? hookName.source;
}

/**
 * Wraps a hook handler to trace its execution.
 * Handles both callback-style (with next) and promise-style hooks.
 *
 * Exported for unit testing against Kareem directly; not part of the public
 * package API (`index.ts` does not re-export it).
 */
export function wrapHookHandler(
  handler: any,
  hookName: string | RegExp,
  hookType: 'pre' | 'post',
  tracer: Tracer,
  config: ResolvedConfig,
): any {
  if (!isFunction(handler)) {
    return handler;
  }

  // Skip if already wrapped to prevent duplicate spans
  if (hasMarker(handler, WRAPPED_HOOK_FLAG)) {
    return handler;
  }

  const startHookSpan = (self: any, resolvedName: string) => {
    let modelName: string | undefined;
    let collectionName: string | undefined;

    try {
      if (self.constructor?.modelName) {
        modelName = self.constructor.modelName;
        collectionName =
          self.constructor.collection?.collectionName || modelName;
      } else if (self.model?.modelName) {
        modelName = self.model.modelName;
        collectionName = self.model.collection?.collectionName || modelName;
      }
    } catch {
      // Ignore errors in extracting context
    }

    const spanName = collectionName
      ? `mongoose.${collectionName}.${hookType}.${resolvedName}`
      : `mongoose.hook.${hookType}.${resolvedName}`;

    const span = tracer.startSpan(spanName, { kind: SpanKind.INTERNAL });
    span.setAttribute('hook.type', hookType);
    span.setAttribute('hook.operation', resolvedName);
    if (modelName) {
      span.setAttribute('hook.model', modelName);
    }
    if (collectionName && config.captureCollectionName) {
      span.setAttribute(ATTR_DB_COLLECTION_NAME, collectionName);
    }
    span.setAttribute(ATTR_DB_SYSTEM_NAME, DB_SYSTEM_NAME_VALUE_MONGODB);
    if (config.dbName) {
      span.setAttribute(ATTR_DB_NAMESPACE, config.dbName);
    }

    return span;
  };

  const invokeHook = (
    self: any,
    span: Span,
    args: any[],
    callbackStyle: boolean,
  ) =>
    runWithSpan(span, () => {
      try {
        const result = callFunction(handler, self, args);

        if (isFunction(readProperty(result, 'then'))) {
          // SAFETY: as above - the probe established the result is a thenable.
          return Promise.resolve(result as Promise<any>)
            .then((value) => {
              finalizeSpan(span);
              return value;
            })
            .catch((error: unknown) => {
              finalizeSpan(span, toError(error));
              throw error;
            });
        }

        // Only finalize synchronously for non-callback hooks.
        // Callback-style hooks finalize in the wrappedNext above.
        if (!callbackStyle) {
          finalizeSpan(span);
        }
        return result;
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });

  const wrappedHook = function wrappedHook(
    this: any,
    ...runtimeArgs: any[]
  ): any {
    // Captured before the span becomes active, so it points at the true
    // parent (the operation span / prior sibling's parent) — not at this
    // hook's own span. Used to fence off the span's context when we hand
    // control back to Kareem via `next()` below.
    const parentContext = context.active();

    // A string registration was selected at registration time. A RegExp one
    // could not be: it covers whichever operations match, so the selector is
    // applied here, where the operation is known. Skipping means calling the
    // handler untouched, with no span and no change in behaviour.
    const resolvedName = resolveHookName(hookName, this);
    if (
      typeof hookName !== 'string' &&
      !selectorAllows(config.instrumentHooks, resolvedName)
    ) {
      return callFunction(handler, this, runtimeArgs);
    }

    const span = startHookSpan(this, resolvedName);

    // Whether this invocation is callback-style is decided at *call* time, and
    // `next` — by Mongoose convention — is always the handler's *last* declared
    // parameter, i.e. `handler.length - 1`. But `pre` and `post` reach Kareem
    // through different calling conventions, so detection differs:
    //
    //   - `post` hooks: Kareem *always* appends a real `next`
    //     (`kareem/index.js` `newArgs.push(nextCallback)`). The hook is
    //     callback-style only if the handler's declared slot is the one Kareem
    //     filled with a function. Checking that exact slot (rather than
    //     scanning) matters both ways: scanning from the front would grab a
    //     leading Model/Document (Mongoose Models are functions); accepting a
    //     function *anywhere* would grab the appended `next` even for a data
    //     hook like `post('save', (doc) => {})` that never reads it — deferring
    //     finalization to a callback the handler never calls, leaking the span.
    //     Pinning to the declared slot also subsumes the old `init` carve-out:
    //     `post('init', (doc))` is handed `[doc]` with no callback, so it is
    //     simply promise/sync-style.
    //
    //   - `pre` hooks: under kareem v3 (Mongoose 8+), `execPre` calls the
    //     handler with the operation args and *never* passes a callback — a
    //     declared parameter means we must synthesize `next` ourselves, with
    //     nothing downstream to forward to. Under kareem v2 (Mongoose < 8),
    //     `execPre` *does* pass a real `next` at the declared slot, so
    //     `realCallback` is found and `wrappedNext` forwards to it. Both
    //     protocols land on the same `handler.length > 0` test.
    //
    // Restoring the original arity on this wrapper (see `defineProperty` below)
    // is what lets Kareem's own exact-arity checks line up in the `post` case.
    const expectedIndex = handler.length - 1;
    // SAFETY: the condition establishes the argument at that index is callable
    // before it is treated as mongoose's node-style hook callback.
    const realCallback =
      expectedIndex >= 0 && typeof runtimeArgs[expectedIndex] === 'function'
        ? (runtimeArgs[expectedIndex] as (...args: any[]) => void)
        : undefined;
    const isCallbackStyle =
      hookType === 'pre' ? handler.length > 0 : realCallback !== undefined;

    if (!isCallbackStyle) {
      // Promise- or sync-style: pass Kareem's args through untouched and let
      // `invokeHook` finalize on the returned promise, or synchronously.
      return invokeHook(this, span, runtimeArgs, false);
    }

    const wrappedNext = function wrappedNext(this: any, ...nextArgs: any[]) {
      const err = nextArgs[0];
      if (err) {
        finalizeSpan(span, err instanceof Error ? err : new Error(String(err)));
      } else {
        finalizeSpan(span);
      }
      // Forward to Kareem's real callback (`post` on v2/v3, `pre` on kareem
      // v2 only); a synthesized v3 `pre` callback has nothing downstream to
      // call.
      //
      // Restore the parent context first. Under Kareem's callback protocol
      // (Mongoose < 8 / kareem v2), `next()` is often invoked from inside a
      // hook's own async continuation (e.g. `Model.findById(...).then(next)`),
      // which still runs with this hook's span active. Kareem advances the
      // chain synchronously from within that callback, so the *next* sibling
      // hook — and the query spans it opens — would otherwise be parented to
      // this already-ended span. Fencing the handoff keeps siblings siblings.
      if (typeof realCallback === 'function') {
        const cb = realCallback;
        return context.with(parentContext, () => cb.apply(this, nextArgs));
      }
      return;
    };

    // Put `next` at the handler's declared position. For `post` this replaces
    // Kareem's real callback in place, keeping surrounding args (e.g. `doc` in
    // `post('findOneAndUpdate', (doc, next))`) in the order the handler
    // declared. For `pre` it fills the slot Mongoose left empty.
    const callArgs = [...runtimeArgs];
    callArgs[expectedIndex] = wrappedNext;
    return invokeHook(this, span, callArgs, true);
  };

  // Kareem inspects `fn.length` with *exact* comparisons — e.g.
  // `post.fn.length === numArgs + 2` to detect error-handling middleware, and
  // `post.length === numArgs + 1` to decide whether to await the callback.
  // Our `...runtimeArgs` wrapper reports length 0, which would collapse every
  // handler's arity and silently break both checks, so restore the original.
  // Same idiom as `packages/autotel-edge/src/core/context.ts`.
  Object.defineProperty(wrappedHook, 'length', {
    enumerable: false,
    configurable: true,
    writable: false,
    value: handler.length,
  });

  // Mark as wrapped to prevent double-wrapping
  setMarker(wrappedHook, WRAPPED_HOOK_FLAG);
  return wrappedHook;
}

/**
 * `true` traces every hook but `init`, which fires once per hydrated document:
 * a find returning 500 documents would emit 500 spans. `{ exclude: [] }` or a
 * list naming `init` traces it.
 */
export function resolveHookSelector(
  selector: MethodSelector | undefined,
): MethodSelector {
  return selector === true ? { exclude: ['init'] } : (selector ?? false);
}
