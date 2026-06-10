import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import { runSecuritySummary, runSecurityEvents } from './security';
import { resetJsonOutput } from '../../lib/json-output';

const FIXTURE = path.resolve(__dirname, 'security-fixture.json');

describe('security commands (fixture backend)', () => {
  let stdoutChunks: string[] = [];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetJsonOutput();
    stdoutChunks = [];
    writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => {
        stdoutChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  const flags = { backend: 'fixture' as const, fixturePath: FIXTURE };

  function capturedEnvelope(): {
    ok: boolean;
    command: string;
    data: unknown;
  } {
    return JSON.parse(stdoutChunks.join('')) as never;
  }

  it('security summary: aggregates events, suspicious requests, denied responses', async () => {
    // Fixture timestamps are near the epoch — use an explicit window.
    await runSecuritySummary({
      ...flags,
      from: '1970-01-01T00:00:00.000Z',
      to: '1970-01-01T01:00:00.000Z',
    });

    const env = capturedEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe('security summary');

    const data = env.data as {
      securityEvents: {
        total: number;
        bySeverity: Record<string, number>;
        byCategory: Record<string, number>;
        topEvents: Array<{ value: string; count: number }>;
        sampleTraceIds: string[];
      };
      suspiciousRequests: {
        total: number;
        bySignal: Record<string, number>;
      };
      deniedResponses: {
        total: number;
        byStatus: Record<string, number>;
        topClients: Array<{ value: string; count: number }>;
      };
    };

    expect(data.securityEvents.total).toBe(2);
    expect(data.securityEvents.bySeverity).toEqual({
      warning: 1,
      critical: 1,
    });
    expect(data.securityEvents.byCategory).toEqual({
      authentication: 1,
      authorization: 1,
    });
    expect(data.securityEvents.topEvents).toEqual(
      expect.arrayContaining([
        { value: 'auth.login.failed', count: 1 },
        { value: 'access.denied', count: 1 },
      ]),
    );

    expect(data.suspiciousRequests.total).toBe(1);
    expect(data.suspiciousRequests.bySignal).toEqual({
      sensitive_file_probe: 1,
    });

    // 401 (new semconv) + 403 (legacy key); the 200 and 404 don't count
    expect(data.deniedResponses.total).toBe(2);
    expect(data.deniedResponses.byStatus).toEqual({ '401': 1, '403': 1 });
    expect(data.deniedResponses.topClients[0]).toEqual({
      value: '203.0.113.7',
      count: 2,
    });
  });

  it('security events: lists the security.* schema fields', async () => {
    await runSecurityEvents({
      ...flags,
      from: '1970-01-01T00:00:00.000Z',
      to: '1970-01-01T01:00:00.000Z',
    });

    const env = capturedEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe('security events');

    const data = env.data as { items: Array<Record<string, unknown>> };
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toMatchObject({
      event: expect.any(String),
      category: expect.any(String),
      severity: expect.any(String),
      traceId: expect.any(String),
    });
  });

  it('security events: filters by severity', async () => {
    await runSecurityEvents({
      ...flags,
      from: '1970-01-01T00:00:00.000Z',
      to: '1970-01-01T01:00:00.000Z',
      severity: 'critical',
    });

    const data = capturedEnvelope().data as {
      items: Array<{ event: string }>;
    };
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.event).toBe('access.denied');
  });

  it('security events: filters by category', async () => {
    await runSecurityEvents({
      ...flags,
      from: '1970-01-01T00:00:00.000Z',
      to: '1970-01-01T01:00:00.000Z',
      category: 'authentication',
    });

    const data = capturedEnvelope().data as {
      items: Array<{ event: string }>;
    };
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.event).toBe('auth.login.failed');
  });
});
