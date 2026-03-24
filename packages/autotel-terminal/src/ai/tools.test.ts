import { describe, expect, it } from 'vitest';
import { createTelemetryTools } from './tools';

const tools = createTelemetryTools({
  spans: [],
  logs: [],
  traces: [],
  stats: { total: 0, errors: 0, avg: 0, p95: 0 },
  serviceStats: [],
  errorSummaries: [],
});

describe('renderUI tool schema', () => {
  it('rejects specs that do not match the Ink renderer contract', () => {
    const invalidSpec = {
      spec: {
        root: 'root',
        elements: {
          root: {
            type: 'DefinitelyNotARealComponent',
            props: { text: 'hello' },
          },
        },
      },
    };

    const schema = (
      tools.renderUI as {
        parameters?: { safeParse: (data: unknown) => { success: boolean } };
      }
    ).parameters;
    const result = schema?.safeParse(invalidSpec);

    expect(result?.success).toBe(false);
  });
});
