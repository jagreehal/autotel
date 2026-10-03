import { describe, expect, it } from 'vitest';
import { explainCommand } from './explain';

describe('explainCommand', () => {
  it('rebuilds a find with its options, and limits findOne to one', () => {
    expect(
      explainCommand('find', 'orders', {
        condition: { status: 'open' },
        options: { sort: { at: -1 }, limit: 10 },
      }),
    ).toEqual({
      find: 'orders',
      filter: { status: 'open' },
      sort: { at: -1 },
      limit: 10,
    });
    expect(explainCommand('findOne', 'orders', {})).toEqual({
      find: 'orders',
      filter: {},
      limit: 1,
    });
  });

  it('keeps the options that change the plan, and drops absent ones', () => {
    expect(
      explainCommand('find', 'orders', {
        condition: { a: 1 },
        options: {
          hint: { $natural: 1 },
          collation: { locale: 'fr' },
          lean: true,
        },
      }),
    ).toEqual({
      find: 'orders',
      filter: { a: 1 },
      hint: { $natural: 1 },
      collation: { locale: 'fr' },
    });
    expect(
      explainCommand('updateOne', 'orders', {
        condition: { a: 1 },
        updates: { $set: { 'xs.$[x]': 1 } },
        options: { upsert: true, arrayFilters: [{ x: 1 }], hint: { a: 1 } },
      }),
    ).toEqual({
      update: 'orders',
      updates: [
        {
          q: { a: 1 },
          u: { $set: { 'xs.$[x]': 1 } },
          multi: false,
          upsert: true,
          arrayFilters: [{ x: 1 }],
          hint: { a: 1 },
        },
      ],
    });
    expect(
      explainCommand('aggregate', 'orders', {
        aggregatePipeline: [],
        options: { hint: 'a_1', allowDiskUse: true },
      }),
    ).toEqual({
      aggregate: 'orders',
      pipeline: [],
      cursor: {},
      hint: 'a_1',
      allowDiskUse: true,
    });
  });

  it('rebuilds writes as the commands that would run them', () => {
    expect(
      explainCommand('updateMany', 'orders', {
        condition: { a: 1 },
        updates: { $set: { b: 2 } },
      }),
    ).toEqual({
      update: 'orders',
      updates: [{ q: { a: 1 }, u: { $set: { b: 2 } }, multi: true }],
    });
    expect(
      explainCommand('deleteOne', 'orders', { condition: { a: 1 } }),
    ).toEqual({
      delete: 'orders',
      deletes: [{ q: { a: 1 }, limit: 1 }],
    });
    expect(explainCommand('findOneAndDelete', 'orders', {})).toEqual({
      findAndModify: 'orders',
      query: {},
      remove: true,
    });
  });

  it('keeps a pipeline whole, and has nothing for estimatedDocumentCount', () => {
    expect(
      explainCommand('aggregate', 'orders', {
        aggregatePipeline: [{ $match: {} }],
      }),
    ).toEqual({ aggregate: 'orders', pipeline: [{ $match: {} }], cursor: {} });
    expect(
      explainCommand('estimatedDocumentCount', 'orders', {}),
    ).toBeUndefined();
  });
});
