import { describe, expect, it } from 'vitest'
import {
  buildResourceSummaries,
  classifyResourceHealth,
  inferResourceName,
  inferResourceType,
} from '../utils/resources'

describe('resource utilities', () => {
  it('infers resource names and types from span attributes', () => {
    const span = {
      attributes: {
        'service.name': 'api',
        'db.system': 'postgresql',
      },
    }

    expect(inferResourceName(span, 'fallback')).toBe('api')
    expect(inferResourceType(span.attributes, 'api')).toBe('database')
  })

  it('classifies resource health from error rate', () => {
    expect(classifyResourceHealth(20, 0)).toBe('healthy')
    expect(classifyResourceHealth(20, 2)).toBe('degraded')
    expect(classifyResourceHealth(20, 5)).toBe('unhealthy')
  })

  it('builds resource summaries from traces, logs, and errors', () => {
    const resources = buildResourceSummaries({
      traces: [
        {
          traceId: 'trace-1',
          correlationId: 'trace-1',
          rootSpan: {
            traceId: 'trace-1',
            spanId: 'span-1',
            name: 'GET /users',
            kind: 'SERVER',
            startTime: 10,
            endTime: 20,
            duration: 10,
            attributes: { 'service.name': 'api' },
            status: { code: 'OK' },
          },
          spans: [
            {
              traceId: 'trace-1',
              spanId: 'span-1',
              name: 'GET /users',
              kind: 'SERVER',
              startTime: 10,
              endTime: 20,
              duration: 10,
              attributes: { 'service.name': 'api' },
              status: { code: 'OK' },
            },
            {
              traceId: 'trace-1',
              spanId: 'span-2',
              parentSpanId: 'span-1',
              name: 'postgres query',
              kind: 'CLIENT',
              startTime: 12,
              endTime: 14,
              duration: 2,
              attributes: { 'db.system': 'postgresql' },
              status: { code: 'ERROR' },
            },
          ],
          startTime: 10,
          endTime: 20,
          duration: 10,
          status: 'ERROR',
          service: 'api',
        },
      ],
      logs: [
        {
          id: 'log-1',
          resourceName: 'api',
          body: 'started',
          timestamp: 21,
        },
      ],
      errors: [
        {
          fingerprint: 'err-1',
          type: 'QueryError',
          message: 'failed',
          count: 1,
          firstSeen: 14,
          lastSeen: 14,
          affectedTraces: ['trace-1'],
          affectedSpans: ['postgres query'],
          service: 'api',
        },
      ],
    })

    expect(resources.map((resource) => resource.name)).toEqual(['api', 'postgresql'])
    expect(resources[0]).toMatchObject({
      name: 'api',
      type: 'service',
      traceCount: 1,
      logCount: 1,
    })
    expect(resources[1]).toMatchObject({
      name: 'postgresql',
      type: 'database',
      errorCount: 1,
    })
  })
})
