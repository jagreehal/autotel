import { describe, it, expect } from 'vitest';
import { extractDeclaredFieldPaths } from './catalog';

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
    expect(extractDeclaredFieldPaths()).toEqual([]);
  });
});

// Path classification and frontmatter parsing now live in @eventcatalog/sdk
// (since v2.21); the cross-platform path tests that used to live here are
// covered by the SDK's own test suite.
