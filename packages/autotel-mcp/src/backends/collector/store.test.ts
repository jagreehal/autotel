import { beforeEach, describe, expect, it } from 'vitest';
import { CollectorStore } from './store';
import type { LogRecord } from '../../types';

const RUNS: LogRecord[] = [
  {
    timestampUnixMs: 1000,
    severityText: 'INFO',
    body: '[support_agent.run] Request completed',
    serviceName: 'support-rag-agent',
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    attributes: {
      'agent.variant': 'broken',
      'rag.filter_mismatch': true,
      'eval.answer_quality': 0,
      'prompt."system"': 'v1',
    },
  },
  {
    timestampUnixMs: 2000,
    severityText: 'INFO',
    body: '[support_agent.run] Request completed',
    serviceName: 'support-rag-agent',
    traceId: 'c'.repeat(32),
    spanId: 'd'.repeat(16),
    attributes: {
      'agent.variant': 'fixed',
      'rag.filter_mismatch': false,
      'eval.answer_quality': 1,
    },
  },
];

describe('CollectorStore.searchLogs', () => {
  let store: CollectorStore;

  beforeEach(async () => {
    store = new CollectorStore({ maxTraces: 100, retentionMs: 60_000 });
    await store.init();
    await store.insertLogs(RUNS);
  });

  it('filters by a string attribute', async () => {
    const result = await store.searchLogs({
      attributes: { 'agent.variant': 'broken' },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.attributes?.['agent.variant']).toBe('broken');
  });

  it('filters by a boolean attribute stored as JSON true/false', async () => {
    const mismatched = await store.searchLogs({
      attributes: { 'rag.filter_mismatch': true },
    });
    expect(mismatched.items).toHaveLength(1);
    expect(mismatched.items[0]!.attributes?.['agent.variant']).toBe('broken');

    const clean = await store.searchLogs({
      attributes: { 'rag.filter_mismatch': false },
    });
    expect(clean.items).toHaveLength(1);
    expect(clean.items[0]!.attributes?.['agent.variant']).toBe('fixed');
  });

  it('filters by a key containing quotes and dots', async () => {
    // A JSON-path build (`$."key"`) matches nothing here: SQLite's path parser
    // does not honour the `\"` escape, so the miss is silent.
    const result = await store.searchLogs({
      attributes: { 'prompt."system"': 'v1' },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.attributes?.['agent.variant']).toBe('broken');
  });

  it('filters by a numeric attribute', async () => {
    const result = await store.searchLogs({
      attributes: { 'eval.answer_quality': 0 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.attributes?.['agent.variant']).toBe('broken');
  });

  it('applies the limit after the attribute filter, not before', async () => {
    // Both records match the service, only one matches the variant. A
    // post-filter implementation would take the newest record by limit, find it
    // is the fixed run, and return nothing.
    const result = await store.searchLogs({
      serviceName: 'support-rag-agent',
      attributes: { 'agent.variant': 'broken' },
      limit: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.attributes?.['agent.variant']).toBe('broken');
  });

  it('reports the pre-limit total, not the returned row count', async () => {
    const result = await store.searchLogs({
      serviceName: 'support-rag-agent',
      limit: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(2);
  });

  it('combines attribute filters with AND', async () => {
    const none = await store.searchLogs({
      attributes: { 'agent.variant': 'broken', 'rag.filter_mismatch': false },
    });
    expect(none.items).toHaveLength(0);
  });
});
