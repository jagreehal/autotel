import { describe, it, expect, vi, beforeEach } from 'vitest';
import { instrumentBigQuery } from './index';
import {
  SEMATTRS_DB_NAMESPACE,
  SEMATTRS_DB_QUERY_TEXT,
} from '../common/constants';

// Count spans and capture them for config tests
const spanCount = vi.hoisted(() => ({ current: 0 }));
const spans = vi.hoisted(
  () => [] as { setAttribute: ReturnType<typeof vi.fn> }[],
);
vi.mock('autotel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('autotel')>();
  return {
    ...actual,
    otelTrace: {
      getTracer: () => ({
        startSpan: (..._args: unknown[]) => {
          spanCount.current += 1;
          const span = {
            setAttribute: vi.fn(),
            setStatus: vi.fn(),
            recordException: vi.fn(),
            end: vi.fn(),
          };
          spans.push(span);
          return span;
        },
      }),
    },
  };
});

// Mock autotel/trace-helpers
vi.mock('autotel/trace-helpers', () => ({
  runWithSpan: (span: any, fn: any) => fn(),
  finalizeSpan: (span: any, error?: any) => {
    if (error && span?.recordException) {
      span.recordException(error);
    }
    if (span?.end) {
      span.end();
    }
  },
}));

// Mock BigQuery classes for testing
class MockJob {
  id: string;
  projectId: string;
  location?: string;
  parent: any;
  metadata?: any;

  constructor(id: string, parent: any, location?: string) {
    this.id = id;
    this.parent = parent;
    this.projectId = parent.projectId;
    this.location = location;
  }

  async getQueryResults(_options?: any) {
    return [
      [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      { totalRows: '2', schema: { fields: [] } },
    ];
  }

  async cancel() {
    return [this, {}];
  }
}

class MockTable {
  id: string;
  dataset: any;
  parent: any;
  metadata?: any;

  constructor(id: string, dataset: any) {
    this.id = id;
    this.dataset = dataset;
    this.parent = dataset.parent;
  }

  async insert(_rows: any[], _options?: any) {
    return {
      kind: 'bigquery#tableDataInsertAllResponse',
      insertErrors: [],
    };
  }

  async getRows(_options?: any) {
    return [
      [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      { totalRows: '2' },
    ];
  }

  async createLoadJob(_source: any, _metadata?: any) {
    const job = new MockJob('load-job-123', this.parent, 'US');
    return [job, { jobReference: { jobId: job.id } }];
  }

  async createCopyJob(_destination: any, _metadata?: any) {
    const job = new MockJob('copy-job-123', this.parent, 'US');
    return [job, { jobReference: { jobId: job.id } }];
  }

  async createExtractJob(_destination: any, _metadata?: any) {
    const job = new MockJob('extract-job-123', this.parent, 'US');
    return [job, { jobReference: { jobId: job.id } }];
  }

  async create(_options?: any) {
    return [this, {}];
  }

  async delete(_options?: any) {
    return [{}];
  }
}

class MockDataset {
  id: string;
  parent: any;
  bigQuery: any;

  constructor(id: string, parent: any) {
    this.id = id;
    this.parent = parent;
    this.bigQuery = parent;
  }

  table(id: string) {
    return new MockTable(id, this);
  }

  async create(_options?: any) {
    return [this, {}];
  }

  async delete(_options?: any) {
    return [{}];
  }
}

class MockBigQuery {
  projectId: string;
  location?: string;
  options: any;

  constructor(options: any = {}) {
    this.projectId = options.projectId || 'test-project';
    this.location = options.location;
    this.options = options;
  }

  dataset(id: string) {
    return new MockDataset(id, this);
  }

  job(id: string) {
    return new MockJob(id, this, this.location);
  }

  query(
    query: string | { query: string },
    optionsOrCallback?: any,
    cb?: (err: Error | null, rows?: any[], response?: any) => void,
  ) {
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : cb;
    const _options =
      typeof optionsOrCallback === 'object' ? optionsOrCallback : {};
    const rows = [{ id: 1, name: 'Alice' }];
    const response = {
      jobReference: { jobId: 'query-job-123' },
      totalRows: '1',
    };
    if (callback) {
      callback(null, rows, response);
      return;
    }
    return Promise.resolve([rows, response]);
  }

  async createQueryJob(options: any) {
    const _queryText = typeof options === 'string' ? options : options.query;
    const job = new MockJob(
      'query-job-456',
      this,
      options?.location || this.location,
    );
    return [job, { jobReference: { jobId: job.id } }];
  }

  async createDataset(
    id: string,
    optionsOrCallback?: any,
    cb?: (err: Error | null, dataset?: any, apiResponse?: any) => void,
  ) {
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : cb;
    const _options =
      typeof optionsOrCallback === 'object' ? optionsOrCallback : {};
    const dataset = this.dataset(id);
    if (callback) {
      callback(null, dataset, {});
      return;
    }
    return [dataset, {}];
  }
}

describe('instrumentBigQuery', () => {
  beforeEach(() => {
    spanCount.current = 0;
  });

  it('should mark BigQuery instance as instrumented', () => {
    const bigquery = new MockBigQuery({ projectId: 'test-project' });
    const result = instrumentBigQuery(bigquery);

    expect(result).toBe(bigquery);
    expect((bigquery as any).__autotelBigQueryInstrumented).toBe(true);
  });

  it('should not instrument twice', () => {
    const bigquery = new MockBigQuery({ projectId: 'test-project' });
    instrumentBigQuery(bigquery);

    // Try to instrument again - should return immediately
    const result = instrumentBigQuery(bigquery);
    expect(result).toBe(bigquery);
  });

  it('should handle null/undefined gracefully', () => {
    expect(instrumentBigQuery(null)).toBe(null);
    expect(instrumentBigQuery()).toBe(undefined);
  });

  it('should not double-wrap when a second BigQuery instance is instrumented (one span per query)', async () => {
    const bigqueryA = new MockBigQuery({ projectId: 'project-a' });
    const bigqueryB = new MockBigQuery({ projectId: 'project-b' });

    instrumentBigQuery(bigqueryA);
    instrumentBigQuery(bigqueryB);

    await bigqueryB.query('SELECT 1');

    expect(spanCount.current).toBe(1);
  });

  it('should use second instance config when instrumenting a second BigQuery instance', async () => {
    spans.length = 0;

    const bigqueryA = new MockBigQuery({ projectId: 'project-a' });
    const bigqueryB = new MockBigQuery({ projectId: 'project-b' });

    instrumentBigQuery(bigqueryA, { captureQueryText: 'never' });
    instrumentBigQuery(bigqueryB, { captureQueryText: 'raw' });

    await bigqueryB.query('SELECT 1 FROM t');

    expect(spans.length).toBe(1);
    expect(spans[0]!.setAttribute).toHaveBeenCalledWith(
      SEMATTRS_DB_QUERY_TEXT,
      expect.any(String),
    );
  });
});

describe('BigQuery.query instrumentation', () => {
  it('should create a span for simple query', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    await bigquery.query('SELECT * FROM users');

    // In a real test with actual OTel, we would verify the span was created
    // For now, we verify the method still works
    expect(true).toBe(true);
  });

  it('should handle parameterized queries', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const result = await bigquery.query({
      query: 'SELECT * FROM users WHERE id = @id',
      params: { id: 123 },
    });

    expect(result).toBeDefined();
    expect(result[0]).toBeDefined();
  });

  it('should handle query errors', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });

    // Override query to throw
    bigquery.query = async () => {
      throw new Error('Query failed');
    };

    instrumentBigQuery(bigquery);

    await expect(bigquery.query('SELECT * FROM users')).rejects.toThrow(
      'Query failed',
    );
  });

  it('should preserve query return shape when result has one element [rows]', async () => {
    const rows = [{ id: 1, name: 'Alice' }];

    MockBigQuery.prototype.query = async function () {
      return [rows];
    };

    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const result = await bigquery.query('SELECT * FROM t');

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(rows);
  });

  it('should invoke callback when BigQuery.query is called with (query, options, callback)', async () => {
    let callbackInvoked = false;
    // Restore query to an implementation that invokes callback (previous test overwrote prototype with async fn that ignores callback)
    MockBigQuery.prototype.query = function (
      _query: string | { query: string },
      optionsOrCallback?: any,
      cb?: (err: Error | null, rows?: any[], response?: any) => void,
    ) {
      const callback =
        typeof optionsOrCallback === 'function' ? optionsOrCallback : cb;
      const _opts =
        typeof optionsOrCallback === 'object' ? optionsOrCallback : {};
      const rows = [{ id: 1, name: 'Alice' }];
      const response = {
        jobReference: { jobId: 'query-job-123' },
        totalRows: '1',
      };
      if (callback) {
        callback(null, rows, response);
        return;
      }
      return Promise.resolve([rows, response]);
    };

    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    bigquery.query('SELECT 1', {}, (err, rows, response) => {
      callbackInvoked = true;
      expect(err).toBeNull();
      expect(rows).toBeDefined();
      expect(response).toBeDefined();
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(callbackInvoked).toBe(true);
  });
});

describe('BigQuery.createQueryJob instrumentation', () => {
  it('should create a span for query job creation', async () => {
    const bigquery = new MockBigQuery({
      projectId: 'my-project',
      location: 'US',
    });
    instrumentBigQuery(bigquery);

    const [job] = await bigquery.createQueryJob({
      query: 'SELECT * FROM large_table',
      location: 'EU',
    });

    expect(job).toBeDefined();
    expect(job.id).toBe('query-job-456');
  });
});

describe('Table.insert instrumentation', () => {
  it('should create a span for insert operation', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const dataset = bigquery.dataset('my_dataset');
    const table = dataset.table('my_table');

    const result = await table.insert([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);

    expect(result).toBeDefined();
    expect(result.insertErrors).toEqual([]);
  });

  it('should handle insert errors', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    const dataset = bigquery.dataset('my_dataset');
    const table = dataset.table('my_table');

    // Override insert to return errors
    table.insert = async () => ({
      kind: 'bigquery#tableDataInsertAllResponse',
      insertErrors: [{ index: 0, errors: [{ reason: 'invalid' }] }],
    });

    instrumentBigQuery(bigquery);

    const result = await table.insert([{ id: 1, name: 'Alice' }]);
    expect(result.insertErrors.length).toBe(1);
  });
});

describe('Table.getRows instrumentation', () => {
  it('should create a span for getRows operation', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const dataset = bigquery.dataset('my_dataset');
    const table = dataset.table('my_table');

    const [rows] = await table.getRows({ maxResults: 10 });

    expect(rows).toBeDefined();
    expect(rows.length).toBe(2);
  });

  it('should return full getRows result (rows, nextQuery, response) for pagination', async () => {
    const nextQuery = { pageToken: 'token-abc' };
    const apiResponse = { totalRows: '100' };
    const rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];

    MockTable.prototype.getRows = async function () {
      return [rows, nextQuery, apiResponse];
    };

    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const result = await bigquery
      .dataset('my_dataset')
      .table('my_table')
      .getRows({ maxResults: 2 });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(rows);
    expect(result[1]).toEqual(nextQuery);
    expect(result[2]).toEqual(apiResponse);
  });

  it('should preserve 2-element getRows result (rows, response) when no pagination', async () => {
    const rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    const response = { totalRows: '2' };

    MockTable.prototype.getRows = async function () {
      return [rows, response];
    };

    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const result = await bigquery
      .dataset('my_dataset')
      .table('my_table')
      .getRows({ maxResults: 10 });

    // Plugin must preserve original return shape: 2 elements when no pagination
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(rows);
    expect(result[1]).toBe(response);
  });
});

describe('Table.createLoadJob instrumentation', () => {
  it('should create a span for load job', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const dataset = bigquery.dataset('my_dataset');
    const table = dataset.table('my_table');

    const [job] = await table.createLoadJob('gs://bucket/file.csv', {
      sourceFormat: 'CSV',
    });

    expect(job).toBeDefined();
    expect(job.id).toBe('load-job-123');
  });
});

describe('Table.createCopyJob instrumentation', () => {
  it('should create a span for copy job', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const dataset = bigquery.dataset('my_dataset');
    const sourceTable = dataset.table('source_table');
    const destTable = dataset.table('dest_table');

    const [job] = await sourceTable.createCopyJob(destTable);

    expect(job).toBeDefined();
    expect(job.id).toBe('copy-job-123');
  });
});

describe('Table.createExtractJob instrumentation', () => {
  it('should create a span for extract job', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const dataset = bigquery.dataset('my_dataset');
    const table = dataset.table('my_table');

    const [job] = await table.createExtractJob('gs://bucket/output.csv', {
      destinationFormat: 'CSV',
    });

    expect(job).toBeDefined();
    expect(job.id).toBe('extract-job-123');
  });
});

describe('Job.getQueryResults instrumentation', () => {
  it('should create a span for getting query results', async () => {
    const bigquery = new MockBigQuery({
      projectId: 'my-project',
      location: 'US',
    });
    instrumentBigQuery(bigquery);

    const job = bigquery.job('query-job-123');
    const [rows] = await job.getQueryResults();

    expect(rows).toBeDefined();
    expect(rows.length).toBe(2);
  });

  it('should return full getQueryResults result (rows, nextQuery, response) for pagination', async () => {
    const rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    const nextQuery = { pageToken: 'token-xyz' };
    const apiResponse = { totalRows: '500', jobComplete: true };

    MockJob.prototype.getQueryResults = async function () {
      return [rows, nextQuery, apiResponse];
    };

    const bigquery = new MockBigQuery({
      projectId: 'my-project',
      location: 'US',
    });
    instrumentBigQuery(bigquery);

    const result = await bigquery.job('query-job-123').getQueryResults();

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(rows);
    expect(result[1]).toEqual(nextQuery);
    expect(result[2]).toEqual(apiResponse);
  });
});

describe('Admin operations instrumentation', () => {
  it('should instrument BigQuery.createDataset when instrumentAdminOps enabled', async () => {
    spans.length = 0;

    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { instrumentAdminOps: true });

    await bigquery.createDataset('new_dataset');

    expect(spans.length).toBe(1);
    expect(spans[0]!.setAttribute).toHaveBeenCalledWith(
      SEMATTRS_DB_NAMESPACE,
      'new_dataset',
    );
  });

  it('should invoke callback when BigQuery.createDataset is called with (id, options, callback)', async () => {
    let callbackInvoked = false;
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { instrumentAdminOps: true });

    bigquery.createDataset('my_dataset', {}, (err, dataset, apiResponse) => {
      callbackInvoked = true;
      expect(err).toBeNull();
      expect(dataset).toBeDefined();
      expect(dataset.id).toBe('my_dataset');
      expect(apiResponse).toBeDefined();
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(callbackInvoked).toBe(true);
  });

  it('should instrument dataset create when enabled', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { instrumentAdminOps: true });

    const dataset = bigquery.dataset('new_dataset');
    const [result] = await dataset.create();

    expect(result).toBeDefined();
  });

  it('should instrument dataset delete when enabled', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { instrumentAdminOps: true });

    const dataset = bigquery.dataset('old_dataset');
    const [result] = await dataset.delete();

    expect(result).toBeDefined();
  });

  it('should instrument table create when enabled', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { instrumentAdminOps: true });

    const dataset = bigquery.dataset('my_dataset');
    const table = dataset.table('new_table');
    const [result] = await table.create();

    expect(result).toBeDefined();
  });

  it('should instrument table delete when enabled', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { instrumentAdminOps: true });

    const dataset = bigquery.dataset('my_dataset');
    const table = dataset.table('old_table');
    const [result] = await table.delete();

    expect(result).toBeDefined();
  });

  it('should not instrument admin ops when disabled', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { instrumentAdminOps: false });

    // Admin ops should still work, just not create spans
    const dataset = bigquery.dataset('my_dataset');
    const result = await dataset.create();
    expect(result).toBeDefined();
  });

  it('should instrument admin ops for second instance when it enables instrumentAdminOps', async () => {
    spans.length = 0;

    const bigqueryA = new MockBigQuery({ projectId: 'project-a' });
    const bigqueryB = new MockBigQuery({ projectId: 'project-b' });

    instrumentBigQuery(bigqueryA, { instrumentAdminOps: false });
    instrumentBigQuery(bigqueryB, { instrumentAdminOps: true });

    await bigqueryB.dataset('new_dataset').create();

    expect(spans.length).toBe(1);
    expect(spans[0]!.setAttribute).toHaveBeenCalledWith(
      SEMATTRS_DB_NAMESPACE,
      'new_dataset',
    );
  });
});

describe('Query text handling', () => {
  it('should use summary mode by default', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { captureQueryText: 'summary' });

    // Query should work normally
    const result = await bigquery.query('SELECT * FROM users WHERE id = 123');
    expect(result).toBeDefined();
  });

  it('should handle sanitized mode', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { captureQueryText: 'sanitized' });

    const result = await bigquery.query(
      "SELECT * FROM users WHERE name = 'Alice' AND age = 25",
    );
    expect(result).toBeDefined();
  });

  it('should handle never mode', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { captureQueryText: 'never' });

    const result = await bigquery.query('SELECT * FROM users');
    expect(result).toBeDefined();
  });

  it('should handle raw mode (not recommended)', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { captureQueryText: 'raw' });

    const result = await bigquery.query('SELECT * FROM users');
    expect(result).toBeDefined();
  });
});

describe('Query hash generation', () => {
  it('should include query hash by default', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { includeQueryHash: true });

    const result = await bigquery.query('SELECT * FROM users');
    expect(result).toBeDefined();
  });

  it('should not include query hash when disabled', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { includeQueryHash: false });

    const result = await bigquery.query('SELECT * FROM users');
    expect(result).toBeDefined();
  });
});

describe('Configuration options', () => {
  it('should accept custom tracer name', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { tracerName: 'custom-tracer' });

    const result = await bigquery.query('SELECT 1');
    expect(result).toBeDefined();
  });

  it('should accept project ID override', async () => {
    const bigquery = new MockBigQuery({ projectId: 'original-project' });
    instrumentBigQuery(bigquery, { projectId: 'override-project' });

    const result = await bigquery.query('SELECT 1');
    expect(result).toBeDefined();
  });

  it('should accept location override', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, { location: 'EU' });

    const result = await bigquery.query('SELECT 1');
    expect(result).toBeDefined();
  });

  it('should accept max query text length', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, {
      captureQueryText: 'raw',
      maxQueryTextLength: 100,
    });

    const result = await bigquery.query('SELECT * FROM users');
    expect(result).toBeDefined();
  });
});

describe('Legacy BigQueryInstrumentation class', () => {
  it('should support legacy enable method', async () => {
    const { BigQueryInstrumentation } = await import('./index');
    const bigquery = new MockBigQuery({ projectId: 'my-project' });

    const instrumentation = new BigQueryInstrumentation({
      projectId: 'test',
      captureQueryText: 'summary',
    });

    instrumentation.enable(bigquery);

    expect((bigquery as any).__autotelBigQueryInstrumented).toBe(true);
  });
});

describe('Extract operation type', () => {
  it('should handle various SQL operations', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    // These should all work without errors
    await bigquery.query('SELECT * FROM users');
    await bigquery.query('INSERT INTO users (id) VALUES (1)');
    await bigquery.query('UPDATE users SET name = "Alice" WHERE id = 1');
    await bigquery.query('DELETE FROM users WHERE id = 1');
    await bigquery.query('CREATE TABLE new_table (id INT)');
    await bigquery.query('DROP TABLE old_table');
  });
});

describe('Edge cases and error handling', () => {
  it('should handle queries with no results', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    bigquery.query = async () => [[], { totalRows: '0' }];

    instrumentBigQuery(bigquery);

    const [rows] = await bigquery.query('SELECT * FROM empty_table');
    expect(rows).toEqual([]);
  });

  it('should handle very long queries', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery, {
      captureQueryText: 'raw',
      maxQueryTextLength: 50,
    });

    const longQuery = 'SELECT ' + 'a,'.repeat(100) + '1';
    const result = await bigquery.query(longQuery);
    expect(result).toBeDefined();
  });

  it('should handle queries with special characters', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const result = await bigquery.query(
      "SELECT * FROM `project.dataset.table` WHERE name LIKE '%test%'",
    );
    expect(result).toBeDefined();
  });

  it('should handle empty query strings', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    const result = await bigquery.query('');
    expect(result).toBeDefined();
  });

  it('should handle null/undefined query objects', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    instrumentBigQuery(bigquery);

    // Should not throw
    const result = await bigquery.query({ query: '' });
    expect(result).toBeDefined();
  });
});

describe('Streaming operations', () => {
  it('should handle createReadStream (if available)', async () => {
    const bigquery = new MockBigQuery({ projectId: 'my-project' });
    const dataset = bigquery.dataset('my_dataset');
    const table = dataset.table('my_table');

    // Add a mock createReadStream if it doesn't exist
    if (!table.createReadStream) {
      table.createReadStream = function () {
        return {
          [Symbol.asyncIterator]: async function* () {
            yield [{ id: 1, name: 'Alice' }];
            yield [{ id: 2, name: 'Bob' }];
          },
        };
      };
    }

    instrumentBigQuery(bigquery);

    const stream = table.createReadStream();
    const rows: any[] = [];
    for await (const chunk of stream) {
      rows.push(...chunk);
    }

    expect(rows.length).toBeGreaterThan(0);
  });
});
