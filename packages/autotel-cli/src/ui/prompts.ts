import { select, checkbox, confirm, input } from '@inquirer/prompts';
import type { Preset, PresetType } from '../types/index.js';

/**
 * Runtime selection
 */
export type RuntimeSelection = 'node' | 'lambda' | 'cloudflare' | 'edge';

/**
 * Startup style selection
 */
export type StartupStyle = 'node-esm' | 'tsx' | 'ts-node' | 'nextjs' | 'other';

/**
 * Prompt for runtime selection
 */
export async function promptRuntime(): Promise<RuntimeSelection> {
  return await select({
    message: 'What runtime are you using?',
    choices: [
      { value: 'node' as const, name: 'Node.js' },
      { value: 'lambda' as const, name: 'AWS Lambda' },
      { value: 'cloudflare' as const, name: 'Cloudflare Workers' },
      { value: 'edge' as const, name: 'Edge Runtime (Vercel Edge, etc.)' },
    ],
    default: 'node',
  });
}

/**
 * Prompt for backend selection
 */
export async function promptBackend(
  backends: Map<string, Preset>
): Promise<string> {
  const choices = [
    { value: 'local', name: 'Local/Console (development only)' },
    ...[...backends.entries()].map(([slug, preset]) => ({
      value: slug,
      name: `${preset.name} - ${preset.description}`,
    })),
  ];

  return await select({
    message: 'Where do you want to send telemetry?',
    choices,
    default: 'local',
  });
}

/**
 * Prompt for logging framework
 */
export async function promptLogging(): Promise<string | null> {
  return await select({
    message: 'Which logging framework do you use?',
    choices: [
      { value: null as unknown as string, name: 'None / Not sure' },
      { value: 'pino', name: 'Pino' },
      { value: 'winston', name: 'Winston' },
    ],
    default: null as unknown as string,
  });
}

/**
 * Prompt for database/ORM selection (multi-select)
 */
export async function promptDatabases(
  plugins: Map<string, Preset>
): Promise<string[]> {
  const choices = [...plugins.entries()]
    .filter(([, preset]) => preset.type === 'plugin')
    .map(([slug, preset]) => ({
      value: slug,
      name: `${preset.name} - ${preset.description}`,
    }));

  if (choices.length === 0) {
    return [];
  }

  return await checkbox({
    message: 'Which databases/ORMs do you use? (space to select, enter to continue)',
    choices,
  });
}

/**
 * Prompt for event subscribers (multi-select)
 */
export async function promptSubscribers(
  subscribers: Map<string, Preset>
): Promise<string[]> {
  const choices = [...subscribers.entries()].map(([slug, preset]) => ({
    value: slug,
    name: `${preset.name} - ${preset.description}`,
  }));

  if (choices.length === 0) {
    return [];
  }

  return await checkbox({
    message: 'Which event destinations? (space to select, enter to continue)',
    choices,
  });
}

/**
 * Prompt for auto-instrumentation
 */
export async function promptAutoInstrumentation(): Promise<'all' | 'none' | 'specific'> {
  return await select({
    message: 'Auto-instrument common libraries?',
    choices: [
      { value: 'all' as const, name: 'All (recommended) - http, express, pg, redis, etc.' },
      { value: 'specific' as const, name: 'Let me choose specific ones' },
      { value: 'none' as const, name: 'None - I\'ll handle it manually' },
    ],
    default: 'all',
  });
}

/**
 * Prompt for startup style
 */
export async function promptStartupStyle(
  hasTypeScript: boolean
): Promise<StartupStyle> {
  const choices = hasTypeScript
    ? [
        { value: 'node-esm' as const, name: 'Node ESM (node --import) - Recommended' },
        { value: 'tsx' as const, name: 'tsx (tsx --import) - For development' },
        { value: 'ts-node' as const, name: 'ts-node' },
        { value: 'nextjs' as const, name: 'Next.js' },
        { value: 'other' as const, name: 'Other / Manual' },
      ]
    : [
        { value: 'node-esm' as const, name: 'Node ESM (node --import) - Recommended' },
        { value: 'nextjs' as const, name: 'Next.js' },
        { value: 'other' as const, name: 'Other / Manual' },
      ];

  return await select({
    message: 'How do you start your app?',
    choices,
    default: 'node-esm',
  });
}

/**
 * Prompt for confirmation
 */
export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  return await confirm({
    message,
    default: defaultValue,
  });
}

/**
 * Prompt for existing config action
 */
export async function promptExistingConfigAction(): Promise<'update' | 'new' | 'abort'> {
  return await select({
    message: 'Existing instrumentation detected. What would you like to do?',
    choices: [
      { value: 'update' as const, name: 'Update existing file (recommended)' },
      { value: 'new' as const, name: 'Create new file (src/autotel-config.mts)' },
      { value: 'abort' as const, name: 'Abort' },
    ],
    default: 'update',
  });
}

/**
 * Prompt for text input
 */
export async function promptInput(
  message: string,
  defaultValue?: string
): Promise<string> {
  return await input({
    message,
    default: defaultValue,
  });
}

/**
 * Prompt for preset selection from a type
 */
export async function promptPresetFromType(
  type: PresetType,
  presets: Map<string, Preset>
): Promise<string | null> {
  const filtered = [...presets.entries()].filter(
    ([, preset]) => preset.type === type
  );

  if (filtered.length === 0) {
    return null;
  }

  const choices = [
    { value: null as unknown as string, name: 'None' },
    ...filtered.map(([slug, preset]) => ({
      value: slug,
      name: `${preset.name} - ${preset.description}`,
    })),
  ];

  return await select({
    message: `Select ${type}:`,
    choices,
    default: null as unknown as string,
  });
}
