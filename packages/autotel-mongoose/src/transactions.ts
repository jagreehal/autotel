/* oxlint-disable anti-slop/no-unknown-parameters -- boundary: a driver error is whatever was thrown */
/**
 * Transaction spans. `Connection.startSession()` is the one place every
 * application session comes from (`connection.transaction()` included), so
 * each session it returns is traced.
 */

import type { ClientSession, Connection, mongo } from 'mongoose';
import { SpanKind } from 'autotel';
import type { Tracer } from 'autotel';
import { runWithSpan } from 'autotel/trace-helpers';
import {
  ATTR_DB_TRANSACTION_ATTEMPTS,
  ATTR_DB_TRANSACTION_OUTCOME,
} from './constants';
import { hasMarker, setMarker, PATCHED_PROTOTYPE_FLAG } from './markers';
import { createSpan, createSpanFinalizer } from './span-lifecycle';
import type { ResolvedConfig } from './types.js';
import { asFunction, readProperty } from './values.js';

interface TransactionState {
  outcome: 'committed' | 'aborted' | 'unknown';
}

/** The part of a Mongoose Connection prototype this replaces. */
export type SessionSource = Pick<Connection, 'startSession'>;

export function patchStartSession(
  connectionPrototype: SessionSource | undefined,
  tracer: Tracer,
  config: ResolvedConfig,
): void {
  const original = connectionPrototype?.startSession;
  if (!connectionPrototype || !original) return;
  if (hasMarker(original, PATCHED_PROTOTYPE_FLAG)) return;

  connectionPrototype.startSession = async function tracedStartSession(
    this: Connection,
    ...args: Parameters<Connection['startSession']>
  ): Promise<ClientSession> {
    const session = await original.apply(this, args);
    traceSession(session, this, tracer, config);
    return session;
  };
  setMarker(connectionPrototype.startSession, PATCHED_PROTOTYPE_FLAG);
}

function traceSession(
  session: ClientSession,
  connection: Connection,
  tracer: Tracer,
  config: ResolvedConfig,
): void {
  // The transaction whose callback ran last, which is the one a commit or
  // abort ends. A session is reused, so each invocation has its own state.
  let current: TransactionState = { outcome: 'aborted' };

  const startSpan = (operation: string, kind?: SpanKind) =>
    createSpan(tracer, operation, { connection }, config, kind);

  const traceEnd = (
    method: 'commitTransaction' | 'abortTransaction',
    onSettled: (error?: unknown) => void,
  ): void => {
    const original = session[method].bind(session);
    // The driver's withTransaction() calls these through `this`.
    session[method] = async (...args) => {
      const span = startSpan(method);
      const finalize = createSpanFinalizer(span);
      try {
        await runWithSpan(span, () => original(...args));
        onSettled();
        finalize();
      } catch (error) {
        onSettled(error);
        finalize(error);
        throw error;
      }
    };
  };
  traceEnd('commitTransaction', (error) => {
    current.outcome =
      error === undefined
        ? 'committed'
        : hasUnknownCommitResult(error)
          ? 'unknown'
          : 'aborted';
  });
  traceEnd('abortTransaction', () => {
    current.outcome = 'aborted';
  });

  const withTransaction = session.withTransaction.bind(session);
  session.withTransaction = async <T>(
    fn: mongo.WithTransactionCallback<T>,
    options?: Parameters<ClientSession['withTransaction']>[1],
  ): Promise<T> => {
    // INTERNAL: the writes, commit and abort beneath it are the client calls.
    const span = startSpan('transaction', SpanKind.INTERNAL);
    const endSpan = createSpanFinalizer(span);
    const state: TransactionState = { outcome: 'aborted' };
    let attempts = 0;
    const finalize = (error?: unknown): void => {
      span.setAttributes({
        [ATTR_DB_TRANSACTION_ATTEMPTS]: attempts,
        [ATTR_DB_TRANSACTION_OUTCOME]: state.outcome,
      });
      endSpan(error);
    };
    const attempt: mongo.WithTransactionCallback<T> = (attemptSession) => {
      attempts += 1;
      state.outcome = 'aborted';
      current = state;
      return fn(attemptSession);
    };
    try {
      const result = await runWithSpan(span, () =>
        withTransaction(attempt, options),
      );
      finalize();
      return result;
    } catch (error) {
      finalize(error);
      throw error;
    }
  };
}

/** The driver labels a commit whose result it did not receive. */
function hasUnknownCommitResult(error: unknown): boolean {
  const hasErrorLabel = asFunction(readProperty(error, 'hasErrorLabel'));
  return hasErrorLabel?.call(error, 'UnknownTransactionCommitResult') === true;
}
