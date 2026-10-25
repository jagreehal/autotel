import * as path from 'node:path';
import { fileExists } from '../../fs';
import type { Framework } from '../types';
import { cloudflareAdapter } from './cloudflare';
import { nextAdapter } from './next';
import { nitroAdapter } from './nitro';
import { routerAdapter } from './router';
import type { FrameworkAdapter } from './shared';
import { svelteKitAdapter } from './sveltekit';
import { tanstackAdapter } from './tanstack';

export type { AdapterContext, FrameworkAdapter } from './shared';
export { resolveImport } from './router';

export function getAdapter(framework: Framework): FrameworkAdapter {
  switch (framework) {
    case 'next':
      return nextAdapter;
    case 'nitro':
      return nitroAdapter;
    case 'sveltekit':
      return svelteKitAdapter;
    case 'tanstack-start':
      return tanstackAdapter;
    case 'cloudflare':
      return cloudflareAdapter;
    case 'hono':
    case 'express':
    case 'fastify':
    case 'elysia':
      return routerAdapter(framework);
  }
}

export const SUPPORTED_FRAMEWORKS: readonly Framework[] = [
  'next',
  'nitro',
  'tanstack-start',
  'sveltekit',
  'hono',
  'express',
  'fastify',
  'elysia',
  'cloudflare',
];

export function isFramework(value: string): value is Framework {
  return SUPPORTED_FRAMEWORKS.some((framework) => framework === value);
}

/** What detectFramework() answers with. */
interface DetectFrameworkResult {
  framework: Framework | null;
  warnings: string[];
}

/**
 * Pick the framework to scan for.
 *
 * Meta-frameworks are checked first: a Nuxt app has `h3` installed and an
 * Express app does not become a Next app because it renders one page.
 */
export function detectFramework(
  projectRoot: string,
  deps: ReadonlySet<string>,
): DetectFrameworkResult {
  const warnings: string[] = [];

  const candidates: [Framework, boolean][] = [
    ['next', deps.has('next')],
    ['nitro', deps.has('nuxt') || deps.has('nitropack') || deps.has('h3')],
    [
      'tanstack-start',
      deps.has('@tanstack/react-start') || deps.has('@tanstack/start'),
    ],
    ['sveltekit', deps.has('@sveltejs/kit')],
    [
      'cloudflare',
      fileExists(path.join(projectRoot, 'wrangler.toml')) ||
        fileExists(path.join(projectRoot, 'wrangler.jsonc')) ||
        fileExists(path.join(projectRoot, 'wrangler.json')),
    ],
    ['hono', deps.has('hono')],
    ['elysia', deps.has('elysia')],
    ['fastify', deps.has('fastify')],
    ['express', deps.has('express')],
  ];

  const matched = candidates
    .filter(([, present]) => present)
    .map(([name]) => name);
  if (matched.length === 0) return { framework: null, warnings };
  if (matched.length > 1) {
    warnings.push(
      `Multiple frameworks detected (${matched.join(', ')}); scanning as ${matched[0]}. Use --framework to override.`,
    );
  }
  return { framework: matched[0] ?? null, warnings };
}
