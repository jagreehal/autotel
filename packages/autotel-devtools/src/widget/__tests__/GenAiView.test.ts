/**
 * @vitest-environment jsdom
 *
 * GenAiView selects by trace and span: span ids are unique only within a
 * trace, so a shared link must reopen the span in the trace it names.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import GenAiView from '../components/GenAiView.svelte';
import {
  clearAllData,
  updateWidgetData,
  setSelectedTrace,
} from '../store.svelte';
import type { TraceData } from '../types';

function chatTrace(traceId: string, model: string, start: number): TraceData {
  const span = {
    traceId,
    spanId: 'same-span-id',
    name: `chat ${model}`,
    kind: 'CLIENT' as const,
    startTime: start,
    endTime: start + 10,
    duration: 10,
    attributes: {
      'service.name': 'svc',
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': model,
    },
    status: { code: 'OK' as const },
  };
  return {
    traceId,
    correlationId: traceId,
    rootSpan: span,
    spans: [span],
    startTime: start,
    endTime: start + 10,
    duration: 10,
    status: 'OK',
    service: 'svc',
  };
}

describe('GenAiView selection', () => {
  beforeEach(() => clearAllData());
  afterEach(() => {
    cleanup();
    clearAllData();
  });

  it('opens the span in the selected trace when another trace shares its id', async () => {
    const now = Date.now();
    render(GenAiView);
    // The older trace is the one selected; the newer one sorts first.
    updateWidgetData({
      traces: [
        chatTrace('trace-old', 'model-old', now - 1000),
        chatTrace('trace-new', 'model-new', now),
      ],
    });
    setSelectedTrace('trace-old', 'same-span-id');

    const selected = await screen.findByRole('option', { selected: true });
    expect(selected.textContent).toContain('model-old');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('opens the client row for a link to the MCP server span folded into it', async () => {
    const now = Date.now();
    const toolSpan = (
      spanId: string,
      kind: 'INTERNAL' | 'SERVER',
      parentSpanId?: string,
    ) => ({
      traceId: 'trace-mcp',
      spanId,
      parentSpanId,
      name: 'execute_tool aggregate',
      kind,
      startTime: now,
      endTime: now + 10,
      duration: 10,
      attributes: {
        'service.name': 'svc',
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'aggregate',
        ...(kind === 'SERVER' ? { 'mcp.method.name': 'tools/call' } : {}),
      },
      status: { code: 'OK' as const },
    });
    const client = toolSpan('client', 'INTERNAL');
    const spans = [client, toolSpan('server', 'SERVER', 'client')];
    render(GenAiView);
    updateWidgetData({
      traces: [
        {
          traceId: 'trace-mcp',
          correlationId: 'trace-mcp',
          rootSpan: client,
          spans,
          startTime: now,
          endTime: now + 10,
          duration: 10,
          status: 'OK',
          service: 'svc',
        },
        chatTrace('trace-chat', 'model-new', now + 1000),
      ],
    });
    setSelectedTrace('trace-mcp', 'server');

    const selected = await screen.findByRole('option', { selected: true });
    expect(selected.textContent).toContain('aggregate');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});
