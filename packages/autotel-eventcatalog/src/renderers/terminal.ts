// Plain-text rendering — for terminals, log files, Slack messages, anywhere
// markdown decorations would render as noise. Reuses the markdown renderer
// and strips heading marks, inline code backticks, and bold emphasis.

import type { DriftReport } from '../diff';
import type { DriftDelta } from '../diff-vs-base';
import { renderMarkdown, renderDeltaMarkdown } from './markdown';
import type { Renderer } from './types';

export function renderTerminal(report: DriftReport): string {
  return stripMarkdownDecorations(renderMarkdown(report));
}

export function renderDeltaTerminal(delta: DriftDelta): string {
  return stripMarkdownDecorations(renderDeltaMarkdown(delta));
}

function stripMarkdownDecorations(md: string): string {
  return md
    .replaceAll(/^#+\s+/gm, '')
    .replaceAll('`', '')
    .replaceAll(/\*\*([^*]+)\*\*/g, '$1');
}

export const terminalRenderer: Renderer = {
  name: 'terminal',
  description: 'Plain text. Same content as markdown, decorations stripped.',
  renderReport: renderTerminal,
  renderDelta: renderDeltaTerminal,
};
