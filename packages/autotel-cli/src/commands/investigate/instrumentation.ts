import {
  scoreSpan,
  suggestInstrumentationFixes,
  buildInstrumentationGuide,
} from 'autotel-mcp';
import { Command } from 'commander';
import { runStatic, type InvestigateFlags } from './runtime';
import { addStaticFlags, staticFlagsFromOpts } from './cli-helpers';
import { AutotelError } from '../../lib/errors';
import * as fs from 'node:fs';

interface SpanInput {
  operationName: string;
  serviceName: string;
  tags: Record<string, string | number | boolean>;
  hasError: boolean;
}

function readSpanFromStdinOrFile(spanFile?: string): SpanInput {
  let raw: string;
  if (spanFile) {
    raw = fs.readFileSync(spanFile, 'utf8');
  } else {
    raw = fs.readFileSync(0, 'utf8');
  }
  const parsed = JSON.parse(raw) as Partial<SpanInput>;
  if (
    typeof parsed.operationName !== 'string' ||
    typeof parsed.serviceName !== 'string' ||
    typeof parsed.tags !== 'object' ||
    typeof parsed.hasError !== 'boolean'
  ) {
    throw new AutotelError({
      type: 'validation',
      code: 'AUTOTEL_E_INVALID_INPUT',
      message:
        'score expects JSON with operationName, serviceName, tags, hasError',
      retryable: false,
      expected: {
        shape: {
          operationName: 'string',
          serviceName: 'string',
          tags: 'Record<string, string | number | boolean>',
          hasError: 'boolean',
        },
      },
    });
  }
  return parsed as SpanInput;
}

export async function runScoreSpan(
  flags: InvestigateFlags & { spanFile?: string },
): Promise<void> {
  await runStatic('score', flags, async () => {
    const span = readSpanFromStdinOrFile(flags.spanFile);
    const result = scoreSpan(span);
    const suggestions = suggestInstrumentationFixes(span);
    return { ...result, suggestions };
  });
}

export async function runScoreExplain(flags: InvestigateFlags): Promise<void> {
  await runStatic('score explain', flags, async () => ({
    guide: buildInstrumentationGuide(),
  }));
}

export function registerScoreCommands(program: Command): void {
  const scoreCmd = addStaticFlags(new Command('score'))
    .description('Score a span for instrumentation quality (JSON)')
    .option('--span-file <path>', 'Read span JSON from file (default: stdin)')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runScoreSpan({
        ...staticFlagsFromOpts(o),
        spanFile: o.spanFile as string | undefined,
      });
    });
  const explainCmd = addStaticFlags(new Command('explain'))
    .description('Explain the instrumentation scoring rubric')
    .action(async function (this: Command) {
      await runScoreExplain(staticFlagsFromOpts(this.optsWithGlobals()));
    });
  scoreCmd.addCommand(explainCmd);
  program.addCommand(scoreCmd);
}
