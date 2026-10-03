import { describe, expect, it } from 'vitest';
import {
  hashStatement,
  sanitizePlanError,
  planAttributes,
  planUnavailableAttributes,
} from './index';

describe('hashStatement', () => {
  it('is stable, fixed width, and tells statements apart', () => {
    const a = hashStatement('SELECT * FROM users WHERE id = $1');
    expect(a).toBe(hashStatement('SELECT * FROM users WHERE id = $1'));
    expect(a).toMatch(/^[0-9a-f]{14}$/u);
    expect(a).not.toBe(hashStatement('SELECT * FROM users WHERE id = $2'));
    expect(hashStatement('')).toMatch(/^[0-9a-f]{14}$/u);
  });
});

describe('planAttributes', () => {
  it('maps every field, and hashes the node order', () => {
    const attributes = planAttributes({
      nodes: ['FETCH', 'IXSCAN'],
      fullScan: false,
      blockingSort: false,
      mode: 'analyze',
      keysExamined: 10,
      indexes: ['status_1', 'createdAt_-1'],
      rowsExamined: 10,
      rowsReturned: 10,
      executionMs: 2,
      indexSuggestion: 'db.users.createIndex({ status: 1 })',
    });
    expect(attributes).toEqual({
      'db.plan.status': 'captured',
      'db.plan.mode': 'analyze',
      'db.plan.blocking_sort': false,
      'db.plan.full_scan': false,
      'db.plan.node': 'FETCH',
      'db.plan.stages': ['FETCH', 'IXSCAN'],
      'db.plan.keys_examined': 10,
      'db.plan.hash': hashStatement('FETCH>IXSCAN'),
      'db.plan.indexes': 'status_1,createdAt_-1',
      'db.plan.rows_examined': 10,
      'db.plan.rows_returned': 10,
      'db.plan.execution_ms': 2,
      'db.plan.index_suggestion': 'db.users.createIndex({ status: 1 })',
    });
  });

  it('leaves out what the plan did not report', () => {
    expect(
      planAttributes({
        nodes: [],
        fullScan: true,
        indexes: [],
        cost: Number.NaN,
      }),
    ).toEqual({ 'db.plan.status': 'captured', 'db.plan.full_scan': true });
  });

  it('writes which fields serve equality, sort and range', () => {
    expect(
      planAttributes({
        nodes: ['COLLSCAN'],
        fullScan: true,
        indexes: [],
        indexSuggestion: 'db.o.createIndex({ s: 1, at: -1, n: 1 })',
        indexFields: { equality: ['s'], sort: ['at:-1'], range: ['n'] },
      }),
    ).toMatchObject({
      'db.plan.index_suggestion.equality': ['s'],
      'db.plan.index_suggestion.sort': ['at:-1'],
      'db.plan.index_suggestion.range': ['n'],
    });
  });
});

describe('planUnavailableAttributes', () => {
  it('records why there is no plan, first line of the error only', () => {
    expect(
      planUnavailableAttributes('failed', {
        mode: 'plan',
        error: 'not authorized on app to execute command\n{ explain: … }',
      }),
    ).toEqual({
      'db.plan.status': 'failed',
      'db.plan.mode': 'plan',
      'db.plan.error': 'not authorized on app to execute command',
    });
    expect(planUnavailableAttributes('unsupported')).toEqual({
      'db.plan.status': 'unsupported',
    });
  });
});

describe('sanitizePlanError', () => {
  it('keeps the reason and drops every value an error quotes', () => {
    expect(
      sanitizePlanError(
        'E11000 duplicate key error collection: app.users index: email_1 dup key: { email: "a@b.c" }',
      ),
    ).toBe(
      'E11000 duplicate key error collection: app.users index: email_1 dup key: {…}',
    );
    expect(
      sanitizePlanError(
        'command explain failed: { find: "users", filter: { email: "alice@example.com", tags: ["x"] } }',
      ),
    ).toBe('command explain failed: {…}');
    expect(
      sanitizePlanError(
        'invalid input syntax for type integer: "4111111111111111"',
      ),
    ).toBe('invalid input syntax for type integer: "?"');
    expect(
      sanitizePlanError(
        'duplicate key value violates unique constraint "u" Key (email)=(bob@x.io) exists',
      ),
    ).toBe(
      'duplicate key value violates unique constraint "?" Key (email)=(?) exists',
    );
    expect(sanitizePlanError("syntax error at or near 'bob@x.io'")).toBe(
      "syntax error at or near '?'",
    );
    expect(
      sanitizePlanError('user alice@example.com id 123456789 denied'),
    ).toBe('user ? id ? denied');
    expect(sanitizePlanError('first line\n{ secret: 1 }')).toBe('first line');
  });

  it('is applied to every recorded error', () => {
    expect(
      planUnavailableAttributes('failed', {
        error: 'not authorized: { filter: { email: "a@b.c" } }',
      })['db.plan.error'],
    ).toBe('not authorized: {…}');
  });
});
