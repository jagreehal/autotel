import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect } from 'storybook/test';
import SpanDetailPanel from './SpanDetailPanel.svelte';
import type { SpanData, TraceData } from '../types';

// A span carrying the kind of resource + framework attributes a real OTLP
// export produces — long dotted keys (`deployment.environment`,
// `datadog.host.name`) next to long single-token values. This is the exact
// shape that used to render values vertically, one character per line, when the
// detail panel was narrow.
const span: SpanData = {
  traceId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  spanId: '1122334455667788',
  name: 'GET /',
  kind: 'SERVER',
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_000_118,
  duration: 118,
  status: { code: 'OK' },
  events: [],
  attributes: {
    'code.function': 'GET /',
    'datadog.host.name': 'Jagvinders-MacBook-Pro-2.local',
    'deployment.environment': 'development',
    'deployment.environment.name': 'development',
    'http.method': 'GET',
    'http.route': '/',
    'http.target': '/',
    'http.url': 'http://localhost:3000/?ref=devtools&session=abcdef0123456789',
    'net.host.name': 'localhost',
    'service.name': 'money-transfer',
    'service.version': '6.1.0',
    'telemetry.sdk.language': 'nodejs',
    'user_agent.original':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
};

const trace: TraceData = {
  traceId: span.traceId,
  correlationId: 'corr-1',
  rootSpan: span,
  spans: [span],
  startTime: span.startTime,
  endTime: span.endTime,
  duration: span.duration,
  status: 'OK',
  service: 'money-transfer',
};

const meta = {
  title: 'Components/SpanDetailPanel',
  component: SpanDetailPanel,
  parameters: { layout: 'fullscreen' },
  args: {
    span,
    trace,
    onClose: () => {},
  },
} satisfies Meta<typeof SpanDetailPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Resource + framework attributes. Every value must read horizontally and wrap
 * at word boundaries (key on its own line, value below) — never one glyph per
 * line, which is what the old single-row flex layout produced once a long key
 * starved the value column. Narrow the Storybook canvas to confirm it holds up.
 */
export const Attributes: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText('deployment.environment'),
    ).toBeInTheDocument();
    // The value renders as readable text in the same node, not split per char.
    await expect(canvas.getAllByText('development').length).toBeGreaterThan(0);
    await expect(canvas.getByText(/Attributes \(/)).toBeInTheDocument();
  },
};

export const Dark: Story = {
  globals: { theme: 'dark' },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText('datadog.host.name'),
    ).toBeInTheDocument();
  },
};
