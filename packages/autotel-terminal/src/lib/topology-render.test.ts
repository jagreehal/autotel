import { describe, it, expect } from 'vitest';
import { renderTopologyAscii } from './topology-render';
import type { ServiceGraph } from './topology-model';

describe('renderTopologyAscii', () => {
  it('renders a single service with no edges', () => {
    const graph: ServiceGraph = {
      services: [
        {
          serviceName: 'api',
          spanCount: 10,
          errorCount: 0,
          avgDurationMs: 50,
          p95DurationMs: 100,
        },
      ],
      edges: [],
    };
    const lines = renderTopologyAscii(graph);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('api'))).toBe(true);
    expect(lines.some((l) => l.includes('10 spans'))).toBe(true);
  });

  it('renders edges between services', () => {
    const graph: ServiceGraph = {
      services: [
        {
          serviceName: 'api',
          spanCount: 20,
          errorCount: 0,
          avgDurationMs: 50,
          p95DurationMs: 100,
        },
        {
          serviceName: 'postgres',
          spanCount: 5,
          errorCount: 1,
          avgDurationMs: 10,
          p95DurationMs: 30,
        },
      ],
      edges: [
        {
          fromService: 'api',
          toService: 'postgres',
          spanCount: 5,
          errorCount: 1,
        },
      ],
    };
    const lines = renderTopologyAscii(graph);
    expect(lines.some((l) => l.includes('api'))).toBe(true);
    expect(lines.some((l) => l.includes('postgres'))).toBe(true);
    expect(lines.some((l) => l.includes('5'))).toBe(true);
  });

  it('shows error count on edges', () => {
    const graph: ServiceGraph = {
      services: [
        {
          serviceName: 'api',
          spanCount: 10,
          errorCount: 0,
          avgDurationMs: 50,
          p95DurationMs: 100,
        },
        {
          serviceName: 'db',
          spanCount: 3,
          errorCount: 2,
          avgDurationMs: 5,
          p95DurationMs: 10,
        },
      ],
      edges: [
        { fromService: 'api', toService: 'db', spanCount: 3, errorCount: 2 },
      ],
    };
    const lines = renderTopologyAscii(graph);
    expect(lines.some((l) => l.includes('2 err'))).toBe(true);
  });

  it('formats edge labels with counts only, not duplicated service names', () => {
    const graph: ServiceGraph = {
      services: [
        {
          serviceName: 'api',
          spanCount: 10,
          errorCount: 0,
          avgDurationMs: 50,
          p95DurationMs: 100,
        },
        {
          serviceName: 'db',
          spanCount: 3,
          errorCount: 2,
          avgDurationMs: 5,
          p95DurationMs: 10,
        },
      ],
      edges: [
        { fromService: 'api', toService: 'db', spanCount: 3, errorCount: 2 },
      ],
    };

    const lines = renderTopologyAscii(graph);
    const edgeLine = lines.find((line) => line.includes('db'));

    expect(edgeLine).toContain('(3, 2 err)');
    expect(edgeLine).not.toContain('(api');
  });

  it('returns empty message for empty graph', () => {
    const graph: ServiceGraph = { services: [], edges: [] };
    const lines = renderTopologyAscii(graph);
    expect(lines.some((l) => l.includes('No services'))).toBe(true);
  });

  it('renders multiple downstream services', () => {
    const graph: ServiceGraph = {
      services: [
        {
          serviceName: 'api',
          spanCount: 30,
          errorCount: 0,
          avgDurationMs: 50,
          p95DurationMs: 100,
        },
        {
          serviceName: 'postgres',
          spanCount: 10,
          errorCount: 0,
          avgDurationMs: 10,
          p95DurationMs: 30,
        },
        {
          serviceName: 'redis',
          spanCount: 5,
          errorCount: 0,
          avgDurationMs: 2,
          p95DurationMs: 5,
        },
      ],
      edges: [
        {
          fromService: 'api',
          toService: 'postgres',
          spanCount: 10,
          errorCount: 0,
        },
        { fromService: 'api', toService: 'redis', spanCount: 5, errorCount: 0 },
      ],
    };
    const lines = renderTopologyAscii(graph);
    expect(lines.some((l) => l.includes('api'))).toBe(true);
    expect(lines.some((l) => l.includes('postgres'))).toBe(true);
    expect(lines.some((l) => l.includes('redis'))).toBe(true);
  });

  it('renders nested downstream dependencies beyond one hop', () => {
    const graph: ServiceGraph = {
      services: [
        {
          serviceName: 'api',
          spanCount: 30,
          errorCount: 0,
          avgDurationMs: 50,
          p95DurationMs: 100,
        },
        {
          serviceName: 'worker',
          spanCount: 10,
          errorCount: 0,
          avgDurationMs: 20,
          p95DurationMs: 40,
        },
        {
          serviceName: 'postgres',
          spanCount: 5,
          errorCount: 0,
          avgDurationMs: 10,
          p95DurationMs: 20,
        },
      ],
      edges: [
        {
          fromService: 'api',
          toService: 'worker',
          spanCount: 10,
          errorCount: 0,
        },
        {
          fromService: 'worker',
          toService: 'postgres',
          spanCount: 5,
          errorCount: 0,
        },
      ],
    };

    const lines = renderTopologyAscii(graph);

    expect(lines.some((l) => l.includes('api'))).toBe(true);
    expect(lines.some((l) => l.includes('worker'))).toBe(true);
    expect(lines.some((l) => l.includes('postgres'))).toBe(true);
    // postgres must appear after worker (nested under it in the tree)
    const workerIdx = lines.findIndex((l) => l.includes('[worker]'));
    const postgresIdx = lines.findIndex((l) => l.includes('[postgres]'));
    expect(workerIdx).toBeGreaterThanOrEqual(0);
    expect(postgresIdx).toBeGreaterThan(workerIdx);
  });

  it('does not duplicate services when the graph has no roots', () => {
    const graph: ServiceGraph = {
      services: [
        {
          serviceName: 'api',
          spanCount: 10,
          errorCount: 0,
          avgDurationMs: 20,
          p95DurationMs: 30,
        },
        {
          serviceName: 'worker',
          spanCount: 8,
          errorCount: 0,
          avgDurationMs: 15,
          p95DurationMs: 25,
        },
      ],
      edges: [
        {
          fromService: 'api',
          toService: 'worker',
          spanCount: 4,
          errorCount: 0,
        },
        {
          fromService: 'worker',
          toService: 'api',
          spanCount: 2,
          errorCount: 0,
        },
      ],
    };

    const lines = renderTopologyAscii(graph);
    const serviceLines = lines.filter((line) => line.startsWith('['));

    expect(serviceLines).toHaveLength(2);
    expect(serviceLines.filter((line) => line.includes('[api]'))).toHaveLength(
      1,
    );
    expect(
      serviceLines.filter((line) => line.includes('[worker]')),
    ).toHaveLength(1);
  });

  it('renders a shared downstream subtree under each root path', () => {
    const graph: ServiceGraph = {
      services: [
        {
          serviceName: 'api',
          spanCount: 10,
          errorCount: 0,
          avgDurationMs: 20,
          p95DurationMs: 30,
        },
        {
          serviceName: 'cron',
          spanCount: 6,
          errorCount: 0,
          avgDurationMs: 15,
          p95DurationMs: 25,
        },
        {
          serviceName: 'worker',
          spanCount: 8,
          errorCount: 0,
          avgDurationMs: 15,
          p95DurationMs: 25,
        },
        {
          serviceName: 'postgres',
          spanCount: 5,
          errorCount: 0,
          avgDurationMs: 5,
          p95DurationMs: 10,
        },
      ],
      edges: [
        {
          fromService: 'api',
          toService: 'worker',
          spanCount: 4,
          errorCount: 0,
        },
        {
          fromService: 'cron',
          toService: 'worker',
          spanCount: 2,
          errorCount: 0,
        },
        {
          fromService: 'worker',
          toService: 'postgres',
          spanCount: 5,
          errorCount: 0,
        },
      ],
    };

    const lines = renderTopologyAscii(graph);
    const postgresLines = lines.filter((line) => line.includes('postgres'));

    expect(postgresLines).toHaveLength(2);
  });
});
