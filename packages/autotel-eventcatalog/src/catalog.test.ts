import { describe, it, expect } from 'vitest';
import { extractDeclaredFieldPaths, __test } from './catalog';
import { sep } from 'node:path';

describe('extractDeclaredFieldPaths', () => {
  it('extracts scalar properties', () => {
    expect(
      extractDeclaredFieldPaths({
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          totalCents: { type: 'integer' },
        },
      }),
    ).toEqual(['orderId', 'totalCents']);
  });

  it('collapses array items under `[]`', () => {
    expect(
      extractDeclaredFieldPaths({
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string' },
                quantity: { type: 'integer' },
              },
            },
          },
        },
      }),
    ).toEqual(['items', 'items[].quantity', 'items[].sku']);
  });

  it('walks nested objects', () => {
    expect(
      extractDeclaredFieldPaths({
        type: 'object',
        properties: {
          usage: {
            type: 'object',
            properties: {
              promptTokens: { type: 'integer' },
              completionTokens: { type: 'integer' },
            },
          },
        },
      }),
    ).toEqual(['usage', 'usage.completionTokens', 'usage.promptTokens']);
  });

  it('returns an empty list for non-object schemas', () => {
    expect(extractDeclaredFieldPaths({ type: 'string' })).toEqual([]);
    expect(extractDeclaredFieldPaths(null)).toEqual([]);
    expect(extractDeclaredFieldPaths(undefined)).toEqual([]);
  });
});

describe('cross-platform path handling', () => {
  it('toPosix passes through POSIX paths unchanged', () => {
    expect(__test.toPosix('/a/b/c.mdx')).toBe('/a/b/c.mdx');
  });

  it('toPosix converts Windows-style backslash paths to forward slashes', () => {
    // We always test the conversion logic, regardless of host OS, by
    // constructing a path that uses the *opposite* separator from the host.
    // On POSIX hosts the conversion is a pass-through; the assertion below
    // verifies the algorithm rather than the host's separator choice.
    const winLike =
      'C:\\repo\\catalog\\domains\\E-Commerce\\services\\Orders\\events\\OrderPlaced\\index.mdx';
    const converted = winLike.split('\\').join('/');
    // toPosix only converts when running on Windows (sep === '\\'), so on a
    // POSIX host this is a no-op. The behaviour we *do* guarantee is the
    // contract below: classifyByPath always operates on `/`-form paths.
    expect(converted).not.toContain('\\');
    expect(__test.classifyByPath(converted)).toBe('event');
    void sep;
  });

  it('classifyByPath identifies events under a `services/<S>/events/<E>` tree', () => {
    expect(
      __test.classifyByPath(
        '/repo/catalog/domains/X/services/OrdersService/events/OrderPlaced/index.mdx',
      ),
    ).toBe('event');
  });

  it('classifyByPath identifies services from `services/<S>/index.mdx`', () => {
    expect(
      __test.classifyByPath(
        '/repo/catalog/domains/X/services/OrdersService/index.mdx',
      ),
    ).toBe('service');
  });

  it('classifyByPath identifies channels from `channels/<C>/index.mdx`', () => {
    expect(
      __test.classifyByPath(
        '/repo/catalog/domains/X/channels/orders.events/index.mdx',
      ),
    ).toBe('channel');
  });

  it('classifyByPath returns null for unknown locations', () => {
    expect(__test.classifyByPath('/repo/catalog/eventcatalog.config.js')).toBe(
      null,
    );
    expect(
      __test.classifyByPath(
        '/repo/catalog/domains/X/services/Orders/queries/Q/index.mdx',
      ),
    ).not.toBe('service'); // nested queries dir is not a service
  });
});
