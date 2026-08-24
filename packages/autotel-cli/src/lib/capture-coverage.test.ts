import { describe, expect, it } from 'vitest';
import {
  assessCaptureCoverage,
  captureCoverageChecks,
} from './capture-coverage';

describe('assessCaptureCoverage', () => {
  it('reports LLM and tool calls as observed once autotel-genai is installed', () => {
    const coverage = assessCaptureCoverage({
      autotel: '1',
      'autotel-genai': '1',
    });

    expect(coverage.observed).toContain('llm_calls');
    expect(coverage.observed).toContain('tool_calls');
  });

  it('reports LLM calls as unobserved without a GenAI package', () => {
    // Core autotel traces functions; it has no idea a model was called.
    const coverage = assessCaptureCoverage({ autotel: '1' });

    expect(coverage.unobserved).toContain('llm_calls');
    expect(coverage.observed).not.toContain('llm_calls');
  });

  it('counts MCP instrumentation as a tool-call source on its own', () => {
    const coverage = assessCaptureCoverage({
      autotel: '1',
      'autotel-mcp-instrumentation': '1',
    });

    expect(coverage.observed).toContain('tool_calls');
    expect(coverage.unobserved).toContain('llm_calls');
  });

  it('observes network only when an HTTP instrumentation is installed', () => {
    // autotel ships no auto-instrumentation of its own; the user wires it.
    expect(assessCaptureCoverage({ autotel: '1' }).unobserved).toContain(
      'network',
    );
    expect(
      assessCaptureCoverage({
        autotel: '1',
        '@opentelemetry/instrumentation-undici': '1',
      }).observed,
    ).toContain('network');
  });

  it('observes file IO when an fs instrumentation is installed', () => {
    // `@opentelemetry/auto-instrumentations-node` bundles instrumentation-fs.
    // Reporting file IO as unobservable for a project that has it is the exact
    // failure this check exists to prevent, pointed the other way.
    expect(
      assessCaptureCoverage({
        autotel: '1',
        '@opentelemetry/auto-instrumentations-node': '1',
      }).observed,
    ).toContain('file_io');

    expect(
      assessCaptureCoverage({
        autotel: '1',
        '@opentelemetry/instrumentation-fs': '1',
      }).observed,
    ).toContain('file_io');
  });

  it('reports IDE context and subprocesses as unobserved', () => {
    // Nothing in the toolchain can see these. Saying so is the point: a trace
    // with no file writes is not evidence that no file was written.
    const coverage = assessCaptureCoverage({
      autotel: '1',
      'autotel-genai': '1',
      'autotel-mcp-instrumentation': '1',
      '@opentelemetry/instrumentation-http': '1',
    });

    expect(coverage.unobserved).toEqual(
      expect.arrayContaining(['ide_context', 'subprocess']),
    );
  });

  it('places every known surface in exactly one list', () => {
    const coverage = assessCaptureCoverage({
      autotel: '1',
      'autotel-genai': '1',
    });
    const all = [...coverage.observed, ...coverage.unobserved];

    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(7);
  });
});

describe('captureCoverageChecks', () => {
  it('warns per unobserved surface and passes the observed ones', () => {
    const checks = captureCoverageChecks({
      autotel: '1',
      'autotel-genai': '1',
    });
    const llm = checks.find((c) => c.id === 'capture-llm_calls');
    const ide = checks.find((c) => c.id === 'capture-ide_context');

    expect(llm?.status).toBe('ok');
    expect(ide?.status).toBe('warn');
    expect(ide?.message).toMatch(/cannot/i);
  });

  it('tells the reader how to declare the gap in the trace itself', () => {
    const checks = captureCoverageChecks({ autotel: '1' });
    const llm = checks.find((c) => c.id === 'capture-llm_calls');

    expect(llm?.details?.join(' ')).toContain('captureCoverageAttributes');
  });
});
