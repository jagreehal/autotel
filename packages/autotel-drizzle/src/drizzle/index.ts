/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { SpanKind, trace } from '@opentelemetry/api';
import {
  SEMATTRS_DB_NAME,
  SEMATTRS_DB_OPERATION,
  SEMATTRS_DB_STATEMENT,
  SEMATTRS_DB_STATEMENT_HASH,
  SEMATTRS_DB_SYSTEM,
  SEMATTRS_NET_PEER_NAME,
  SEMATTRS_NET_PEER_PORT,
} from '../common/constants';
import { finalizeSpan, runWithSpan } from 'autotel/trace-helpers';

const DEFAULT_TRACER_NAME = 'autotel-plugins/drizzle';
const DEFAULT_DB_SYSTEM = 'postgresql';
const INSTRUMENTED_FLAG = '__autotelDrizzleInstrumented' as const;
const PREPARED_QUERY_METHODS = [
  'all',
  'execute',
  'get',
  'run',
  'values',
] as const;

type QueryCallback = (error: unknown, result: unknown) => void;
type QueryFunction = (...args: any[]) => any;
type AttributeValue = string | number | boolean;
type AttributeMap = Record<string, AttributeValue>;

interface InstrumentableObject {
  [key: string]: any;
  [INSTRUMENTED_FLAG]?: true;
}

interface DrizzleClientLike extends InstrumentableObject {
  query?: QueryFunction;
  execute?: QueryFunction;
}

interface DrizzleSessionLike extends InstrumentableObject {
  query?: QueryFunction;
  execute?: QueryFunction;
  prepareQuery?: QueryFunction;
  transaction?: QueryFunction;
}

interface DrizzleDbLike extends InstrumentableObject {
  $client?: DrizzleClientLike;
  session?: DrizzleSessionLike;
  _?: {
    session?: DrizzleSessionLike;
    [key: string]: any;
  };
}

export interface InstrumentDrizzleConfig {
  tracerName?: string;
  dbSystem?: string;
  dbName?: string;
  captureQueryText?: boolean;
  maxQueryTextLength?: number;
  peerName?: string;
  peerPort?: number;
}

interface ResolvedConfig {
  tracerName: string;
  dbSystem: string;
  dbName?: string;
  captureQueryText: boolean;
  maxQueryTextLength: number;
  peerName?: string;
  peerPort?: number;
}

interface InstrumentationState {
  tracer: ReturnType<typeof trace.getTracer>;
  config: ResolvedConfig;
}

interface MethodInstrumentationOptions {
  flagSuffix: string;
  queryText: (args: any[]) => string | undefined;
  callbackStyle?: 'last-arg';
  extraAttributes?: AttributeMap;
}

function resolveConfig(config?: InstrumentDrizzleConfig): ResolvedConfig {
  return {
    tracerName: config?.tracerName ?? DEFAULT_TRACER_NAME,
    dbSystem: config?.dbSystem ?? DEFAULT_DB_SYSTEM,
    dbName: config?.dbName,
    captureQueryText: config?.captureQueryText ?? true,
    maxQueryTextLength: config?.maxQueryTextLength ?? 1000,
    peerName: config?.peerName,
    peerPort: config?.peerPort,
  };
}

function getState(config?: InstrumentDrizzleConfig): InstrumentationState {
  const resolved = resolveConfig(config);
  return {
    config: resolved,
    tracer: trace.getTracer(resolved.tracerName),
  };
}

function getFlagKey(suffix: string): string {
  return `${INSTRUMENTED_FLAG}:${suffix}`;
}

function isObject(value: unknown): value is InstrumentableObject {
  return value !== null && typeof value === 'object';
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<T>).then === 'function'
  );
}

function extractQueryText(queryArg: unknown): string | undefined {
  if (typeof queryArg === 'string') {
    return queryArg;
  }

  if (!isObject(queryArg)) {
    return undefined;
  }

  if (typeof queryArg.sql === 'string') {
    return queryArg.sql;
  }

  if (typeof queryArg.text === 'string') {
    return queryArg.text;
  }

  if (typeof queryArg.queryString === 'string') {
    return queryArg.queryString;
  }

  if (
    isObject(queryArg.queryChunks) &&
    typeof (queryArg as Record<string, unknown>).sql === 'string'
  ) {
    return queryArg.sql as string;
  }

  return undefined;
}

function sanitizeQueryText(queryText: string, maxLength: number): string {
  if (queryText.length <= maxLength) {
    return queryText;
  }

  return `${queryText.slice(0, Math.max(0, maxLength))}...`;
}

/**
 * Stable sha1 of a parameterised SQL statement, used as `db.statement.hash`.
 * Hashes the full original text (not the truncated form) so the hash is
 * identical for queries that only differ in trailing length. We keep this
 * cheap (sha1, hex, take 16 chars) — the goal is grouping, not crypto.
 */
function hashQueryText(queryText: string): string {
  return createHash('sha1').update(queryText).digest('hex').slice(0, 16);
}

function extractOperation(queryText: string): string | undefined {
  const trimmed = queryText.trimStart();
  const match = /^(?<operation>\w+)/u.exec(trimmed);
  return match?.groups?.operation?.toUpperCase();
}

function buildSpan(
  state: InstrumentationState,
  queryText: string | undefined,
  extraAttributes?: AttributeMap,
) {
  const operation = queryText ? extractOperation(queryText) : undefined;
  const spanName = operation
    ? `drizzle.${operation.toLowerCase()}`
    : 'drizzle.query';
  const span = state.tracer.startSpan(spanName, { kind: SpanKind.CLIENT });

  span.setAttribute(SEMATTRS_DB_SYSTEM, state.config.dbSystem);

  if (operation) {
    span.setAttribute(SEMATTRS_DB_OPERATION, operation);
  }

  if (state.config.dbName !== undefined) {
    span.setAttribute(SEMATTRS_DB_NAME, state.config.dbName);
  }

  if (queryText !== undefined) {
    // The hash always lives on the span — even when captureQueryText is off
    // (e.g. for privacy / size reasons) — so query grouping still works.
    span.setAttribute(SEMATTRS_DB_STATEMENT_HASH, hashQueryText(queryText));
  }

  if (state.config.captureQueryText && queryText !== undefined) {
    span.setAttribute(
      SEMATTRS_DB_STATEMENT,
      sanitizeQueryText(queryText, state.config.maxQueryTextLength),
    );
  }

  if (state.config.peerName !== undefined) {
    span.setAttribute(SEMATTRS_NET_PEER_NAME, state.config.peerName);
  }

  if (state.config.peerPort !== undefined) {
    span.setAttribute(SEMATTRS_NET_PEER_PORT, state.config.peerPort);
  }

  if (extraAttributes) {
    for (const [key, value] of Object.entries(extraAttributes)) {
      span.setAttribute(key, value);
    }
  }

  return span;
}

function executeWithSpan<T>(span: any, fn: () => T): T {
  return runWithSpan(span, () => {
    try {
      const result = fn();

      if (isPromiseLike(result)) {
        return result.then(
          (value) => {
            finalizeSpan(span);
            return value;
          },
          (error) => {
            finalizeSpan(span, error);
            throw error;
          },
        ) as T;
      }

      finalizeSpan(span);
      return result;
    } catch (error) {
      finalizeSpan(span, error);
      throw error;
    }
  });
}

function instrumentMethod(
  target: InstrumentableObject,
  methodName: string,
  state: InstrumentationState,
  options: MethodInstrumentationOptions,
): boolean {
  if (typeof target[methodName] !== 'function') {
    return false;
  }

  const flagKey = getFlagKey(options.flagSuffix);
  if (target[flagKey]) {
    return false;
  }

  const originalMethod = target[methodName] as QueryFunction;

  target[methodName] = function instrumentedMethod(
    this: any,
    ...incomingArgs: any[]
  ) {
    const args = [...incomingArgs];
    const callback =
      options.callbackStyle === 'last-arg' && typeof args.at(-1) === 'function'
        ? (args.pop() as QueryCallback)
        : undefined;
    const span = buildSpan(
      state,
      options.queryText(args),
      options.extraAttributes,
    );

    if (callback) {
      return runWithSpan(span, () => {
        const wrappedCallback: QueryCallback = (error, result) => {
          finalizeSpan(span, error);
          callback(error, result);
        };

        try {
          return Reflect.apply(originalMethod, this, [
            ...args,
            wrappedCallback,
          ]);
        } catch (error) {
          finalizeSpan(span, error);
          throw error;
        }
      });
    }

    return executeWithSpan(span, () =>
      Reflect.apply(originalMethod, this, args),
    );
  };

  target[flagKey] = true;
  return true;
}

function instrumentPreparedQuery(
  prepared: unknown,
  state: InstrumentationState,
  querySource: unknown,
  extraAttributes?: AttributeMap,
): boolean {
  if (!isObject(prepared)) {
    return false;
  }

  let instrumented = false;
  const queryText = extractQueryText(querySource);

  for (const methodName of PREPARED_QUERY_METHODS) {
    instrumented =
      instrumentMethod(prepared, methodName, state, {
        flagSuffix: `prepared:${methodName}`,
        queryText: () => queryText,
        extraAttributes,
      }) || instrumented;
  }

  return instrumented;
}

function instrumentPrepareQuery(
  target: DrizzleSessionLike,
  state: InstrumentationState,
  extraAttributes?: AttributeMap,
): boolean {
  if (typeof target.prepareQuery !== 'function') {
    return false;
  }

  const flagKey = getFlagKey('prepareQuery');
  if (target[flagKey]) {
    return false;
  }

  const originalPrepareQuery = target.prepareQuery;

  target.prepareQuery = function instrumentedPrepareQuery(
    this: any,
    ...prepareArgs: any[]
  ) {
    const prepared = Reflect.apply(originalPrepareQuery, this, prepareArgs);
    instrumentPreparedQuery(prepared, state, prepareArgs[0], extraAttributes);
    return prepared;
  };

  target[flagKey] = true;
  return true;
}

function instrumentTransactionTarget(
  target: unknown,
  state: InstrumentationState,
): boolean {
  if (!isObject(target)) {
    return false;
  }

  const transactionAttributes = { 'db.transaction': true };
  let instrumented = false;

  instrumented =
    instrumentMethod(target, 'query', state, {
      flagSuffix: 'transaction:query',
      queryText: (args) => extractQueryText(args[0]),
      callbackStyle: 'last-arg',
      extraAttributes: transactionAttributes,
    }) || instrumented;

  instrumented =
    instrumentMethod(target, 'execute', state, {
      flagSuffix: 'transaction:execute',
      queryText: (args) => extractQueryText(args[0]),
      callbackStyle: 'last-arg',
      extraAttributes: transactionAttributes,
    }) || instrumented;

  instrumented =
    instrumentPrepareQuery(
      target as DrizzleSessionLike,
      state,
      transactionAttributes,
    ) || instrumented;

  if (isObject(target.session)) {
    instrumented =
      instrumentTransactionTarget(target.session, state) || instrumented;
  }

  if (isObject(target._?.session)) {
    instrumented =
      instrumentTransactionTarget(target._.session, state) || instrumented;
  }

  return instrumented;
}

function instrumentSession(
  session: DrizzleSessionLike,
  state: InstrumentationState,
): boolean {
  let instrumented = false;

  instrumented =
    instrumentMethod(session, 'query', state, {
      flagSuffix: 'session:query',
      queryText: (args) => extractQueryText(args[0]),
      callbackStyle: 'last-arg',
    }) || instrumented;

  instrumented =
    instrumentMethod(session, 'execute', state, {
      flagSuffix: 'session:execute',
      queryText: (args) => extractQueryText(args[0]),
      callbackStyle: 'last-arg',
    }) || instrumented;

  instrumented = instrumentPrepareQuery(session, state) || instrumented;

  if (typeof session.transaction === 'function') {
    const flagKey = getFlagKey('session:transaction');

    if (!session[flagKey]) {
      const originalTransaction = session.transaction;

      session.transaction = function instrumentedTransaction(
        this: any,
        callback: QueryFunction,
        ...restArgs: any[]
      ) {
        if (typeof callback !== 'function') {
          return Reflect.apply(originalTransaction, this, [
            callback,
            ...restArgs,
          ]);
        }

        const wrappedCallback = (tx: unknown, ...callbackArgs: any[]) => {
          instrumentTransactionTarget(tx, state);
          return Reflect.apply(callback, this, [tx, ...callbackArgs]);
        };

        return Reflect.apply(originalTransaction, this, [
          wrappedCallback,
          ...restArgs,
        ]);
      };

      session[flagKey] = true;
      instrumented = true;
    }
  }

  if (instrumented) {
    session[INSTRUMENTED_FLAG] = true;
  }

  return instrumented;
}

export function instrumentDrizzle<TClient extends DrizzleClientLike>(
  client: TClient,
  config?: InstrumentDrizzleConfig,
): TClient {
  if (!client || !isObject(client)) {
    return client;
  }

  const state = getState(config);
  let instrumented = false;

  instrumented =
    instrumentMethod(client, 'query', state, {
      flagSuffix: 'client:query',
      queryText: (args) => extractQueryText(args[0]),
      callbackStyle: 'last-arg',
    }) || instrumented;

  instrumented =
    instrumentMethod(client, 'execute', state, {
      flagSuffix: 'client:execute',
      queryText: (args) => extractQueryText(args[0]),
      callbackStyle: 'last-arg',
    }) || instrumented;

  if (instrumented) {
    client[INSTRUMENTED_FLAG] = true;
  }

  return client;
}

export function instrumentDrizzleClient<TDb extends DrizzleDbLike>(
  db: TDb,
  config?: InstrumentDrizzleConfig,
): TDb {
  if (!db || !isObject(db)) {
    return db;
  }

  if (db[INSTRUMENTED_FLAG]) {
    return db;
  }

  const state = getState(config);
  let instrumented = false;

  instrumented =
    instrumentSession(db as unknown as DrizzleSessionLike, state) ||
    instrumented;

  if (isObject(db.session)) {
    instrumented = instrumentSession(db.session, state) || instrumented;
  }

  if (isObject(db._?.session)) {
    instrumented = instrumentSession(db._.session, state) || instrumented;
  }

  // Intentionally do NOT instrument db.$client here. The raw client (e.g.
  // pg.Pool) is the same object that drizzle's session invokes internally from
  // its prepared query's execute(). Wrapping both layers produces nested
  // duplicate spans for every query. Users who need to trace a standalone
  // client without a drizzle wrapper should call `instrumentDrizzle` directly.

  if (instrumented) {
    db[INSTRUMENTED_FLAG] = true;
  }

  return db;
}
