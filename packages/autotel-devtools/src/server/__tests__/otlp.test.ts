import { describe, it, expect } from 'vitest'
import { parseOtlpTraces, parseOtlpLogs, countOtlpMetrics } from '../otlp'

describe('parseOtlpTraces', () => {
  it('parses a valid OTLP JSON trace payload into TraceData[]', () => {
    const payload = {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test-service' } }] },
        scopeSpans: [{
          scope: { name: 'test' },
          spans: [{
            traceId: 'abc123',
            spanId: 'span1',
            name: 'GET /api',
            kind: 2,
            startTimeUnixNano: '1000000000',
            endTimeUnixNano: '2000000000',
            attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
            status: { code: 1 },
            events: [],
          }],
        }],
      }],
    }

    const traces = parseOtlpTraces(payload)
    expect(traces).toHaveLength(1)
    expect(traces[0].traceId).toBe('abc123')
    expect(traces[0].service).toBe('test-service')
    expect(traces[0].spans).toHaveLength(1)
    expect(traces[0].spans[0].name).toBe('GET /api')
    expect(traces[0].spans[0].kind).toBe('SERVER')
    expect(traces[0].spans[0].attributes['http.method']).toBe('GET')
    expect(traces[0].duration).toBeGreaterThan(0)
  })

  it('returns empty array for invalid payload', () => {
    expect(parseOtlpTraces(null)).toEqual([])
    expect(parseOtlpTraces({})).toEqual([])
    expect(parseOtlpTraces({ resourceSpans: [] })).toEqual([])
  })

  it('merges spans from same traceId across multiple resourceSpans', () => {
    const payload = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc-a' } }] },
          scopeSpans: [{ scope: {}, spans: [
            { traceId: 'trace1', spanId: 'span1', name: 'root', kind: 2, startTimeUnixNano: '1000000000', endTimeUnixNano: '3000000000', status: { code: 1 } },
          ] }],
        },
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc-b' } }] },
          scopeSpans: [{ scope: {}, spans: [
            { traceId: 'trace1', spanId: 'span2', parentSpanId: 'span1', name: 'child', kind: 1, startTimeUnixNano: '1500000000', endTimeUnixNano: '2500000000', status: { code: 1 } },
          ] }],
        },
      ],
    }

    const traces = parseOtlpTraces(payload)
    expect(traces).toHaveLength(1)
    expect(traces[0].spans).toHaveLength(2)
  })

  it('handles spans with events', () => {
    const payload = {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
        scopeSpans: [{ scope: {}, spans: [{
          traceId: 'abc', spanId: 'def', name: 'test', kind: 2,
          startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000',
          status: { code: 1 },
          events: [{
            timeUnixNano: '1500000000',
            name: 'exception',
            attributes: [{ key: 'exception.type', value: { stringValue: 'Error' } }],
          }],
        }] }],
      }],
    }
    const traces = parseOtlpTraces(payload)
    expect(traces[0].spans[0].events).toHaveLength(1)
    expect(traces[0].spans[0].events![0].name).toBe('exception')
    expect(traces[0].spans[0].events![0].attributes?.['exception.type']).toBe('Error')
  })

  it('handles all span kinds', () => {
    const kinds = [
      { kind: 0, expected: 'INTERNAL' },
      { kind: 1, expected: 'INTERNAL' },
      { kind: 2, expected: 'SERVER' },
      { kind: 3, expected: 'CLIENT' },
      { kind: 4, expected: 'PRODUCER' },
      { kind: 5, expected: 'CONSUMER' },
    ]
    for (const { kind, expected } of kinds) {
      const payload = {
        resourceSpans: [{
          resource: { attributes: [] },
          scopeSpans: [{ scope: {}, spans: [{
            traceId: `t${kind}`, spanId: `s${kind}`, name: 'test', kind,
            startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000',
            status: { code: 1 },
          }] }],
        }],
      }
      const traces = parseOtlpTraces(payload)
      expect(traces[0].spans[0].kind).toBe(expected)
    }
  })

  it('marks traces with ERROR status when any span has error', () => {
    const payload = {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
        scopeSpans: [{ scope: {}, spans: [
          { traceId: 't1', spanId: 's1', name: 'root', kind: 2, startTimeUnixNano: '1000000000', endTimeUnixNano: '3000000000', status: { code: 1 } },
          { traceId: 't1', spanId: 's2', parentSpanId: 's1', name: 'child', kind: 1, startTimeUnixNano: '1500000000', endTimeUnixNano: '2500000000', status: { code: 2 } },
        ] }],
      }],
    }
    const traces = parseOtlpTraces(payload)
    expect(traces[0].status).toBe('ERROR')
  })

  it('resolves nested OTLP attribute types', () => {
    const payload = {
      resourceSpans: [{
        resource: { attributes: [] },
        scopeSpans: [{ scope: {}, spans: [{
          traceId: 'abc', spanId: 'def', name: 'test', kind: 2,
          startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000',
          status: { code: 1 },
          attributes: [
            { key: 'bool_attr', value: { boolValue: true } },
            { key: 'int_attr', value: { intValue: 42 } },
            { key: 'double_attr', value: { doubleValue: 3.14 } },
            { key: 'string_int', value: { intValue: '99' } },
          ],
        }] }],
      }],
    }
    const traces = parseOtlpTraces(payload)
    const attrs = traces[0].spans[0].attributes
    expect(attrs['bool_attr']).toBe(true)
    expect(attrs['int_attr']).toBe(42)
    expect(attrs['double_attr']).toBe(3.14)
    expect(attrs['string_int']).toBe(99)
  })
})

describe('parseOtlpLogs', () => {
  it('parses OTLP log records', () => {
    const payload = {
      resourceLogs: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
        scopeLogs: [{
          scope: {},
          logRecords: [{
            timeUnixNano: '1000000000',
            severityText: 'ERROR',
            severityNumber: 17,
            body: { stringValue: 'something broke' },
            traceId: 'trace1',
            spanId: 'span1',
            attributes: [{ key: 'code.function', value: { stringValue: 'handleRequest' } }],
          }],
        }],
      }],
    }

    const logs = parseOtlpLogs(payload)
    expect(logs).toHaveLength(1)
    expect(logs[0].severityText).toBe('ERROR')
    expect(logs[0].body).toBe('something broke')
    expect(logs[0].traceId).toBe('trace1')
    expect(logs[0].resourceName).toBe('test')
  })

  it('returns empty array for invalid log payloads', () => {
    expect(parseOtlpLogs(null)).toEqual([])
    expect(parseOtlpLogs({})).toEqual([])
    expect(parseOtlpLogs({ resourceLogs: [] })).toEqual([])
  })

  it('handles logs without traceId', () => {
    const payload = {
      resourceLogs: [{
        resource: { attributes: [] },
        scopeLogs: [{ scope: {}, logRecords: [{
          timeUnixNano: '1000000000',
          severityText: 'INFO',
          severityNumber: 9,
          body: { stringValue: 'startup complete' },
        }] }],
      }],
    }
    const logs = parseOtlpLogs(payload)
    expect(logs).toHaveLength(1)
    expect(logs[0].traceId).toBeUndefined()
    expect(logs[0].body).toBe('startup complete')
    expect(logs[0].severityText).toBe('INFO')
  })
})

describe('countOtlpMetrics', () => {
  it('counts metrics in payload', () => {
    const payload = {
      resourceMetrics: [{
        scopeMetrics: [{
          metrics: [{ name: 'http.requests' }, { name: 'http.duration' }],
        }],
      }],
    }
    expect(countOtlpMetrics(payload)).toBe(2)
  })

  it('returns 0 for empty or invalid payloads', () => {
    expect(countOtlpMetrics(null)).toBe(0)
    expect(countOtlpMetrics({})).toBe(0)
    expect(countOtlpMetrics({ resourceMetrics: [] })).toBe(0)
  })
})
