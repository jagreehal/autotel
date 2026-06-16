import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://jagreehal.github.io',
  base: '/autotel',
  markdown: {
    // GFM is enabled by default; keep it explicit so tables/strikethrough render.
    gfm: true,
  },
  integrations: [
    preact({ devtools: false }),
    starlight({
      title: 'autotel',
      /**
       * Use the `404.mdx` docs entry as the only `/404` route (via `[...slug]`).
       * Avoids a duplicate prerender attempt and the Astro “route conflict” warning.
       */
      disable404Route: true,
      favicon: '/favicon.svg',
      components: {
        PageTitle: './src/components/PageTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        Hero: './src/components/SplashHero.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/jagreehal/autotel',
        },
      ],
      customCss: [
        '@fontsource-variable/inter',
        '@fontsource/jetbrains-mono',
        './src/styles/custom.css',
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'introduction' },
            { label: 'Quick Start', slug: 'quick-start' },
            { label: 'Configuration', slug: 'configuration' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'Architecture', slug: 'architecture' },
            { label: 'Agent Guide', slug: 'agent-guide' },
            { label: 'Advanced', slug: 'advanced' },
          ],
        },
        {
          label: 'Frameworks',
          items: [
            { label: 'Express', slug: 'frameworks/express' },
            { label: 'Fastify', slug: 'frameworks/fastify' },
            { label: 'Hono', slug: 'frameworks/hono' },
            { label: 'NestJS', slug: 'frameworks/nestjs' },
            { label: 'Next.js', slug: 'frameworks/next' },
            { label: 'Nitro / Nuxt', slug: 'frameworks/nitro' },
            { label: 'TanStack Start', slug: 'frameworks/tanstack' },
            { label: 'Cloudflare Workers', slug: 'frameworks/cloudflare' },
            { label: 'Edge Runtimes', slug: 'frameworks/edge' },
            { label: 'Adapters', slug: 'frameworks/adapters' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            {
              label: 'Auto-Instrumentation',
              slug: 'integrations/auto-instrumentation',
            },
            { label: 'Logging', slug: 'integrations/logging' },
            { label: 'Audit Logging', slug: 'integrations/audit' },
            { label: 'Security Observability', slug: 'integrations/security' },
            { label: 'Validation Telemetry', slug: 'integrations/validation' },
            { label: 'AWS', slug: 'integrations/aws' },
            { label: 'Prisma', slug: 'integrations/prisma' },
            { label: 'Drizzle ORM', slug: 'integrations/drizzle' },
            { label: 'Mongoose', slug: 'integrations/mongoose' },
            { label: 'MCP', slug: 'integrations/mcp' },
            { label: 'Sentry', slug: 'integrations/sentry' },
            { label: 'Plugins', slug: 'integrations/plugins' },
            { label: 'Backends', slug: 'integrations/backends' },
            { label: 'Datadog', slug: 'integrations/datadog' },
            { label: 'Event Subscribers', slug: 'integrations/subscribers' },
            { label: 'EventCatalog', slug: 'integrations/eventcatalog' },
          ],
        },
        {
          label: 'Contracts',
          items: [
            { label: 'Telemetry Schema', slug: 'contracts/schema' },
            { label: 'Pact Evidence', slug: 'contracts/pact' },
            { label: 'Message Contracts', slug: 'contracts/message-contract' },
          ],
        },
        {
          label: 'Testing',
          items: [
            { label: 'Vitest', slug: 'testing/vitest' },
            { label: 'Playwright', slug: 'testing/playwright' },
          ],
        },
        {
          label: 'Tools',
          items: [
            { label: 'CLI', slug: 'tools/cli' },
            { label: 'Devtools', slug: 'tools/devtools' },
            { label: 'VS Code Extension', slug: 'tools/vscode' },
            { label: 'Terminal Viewer', slug: 'tools/terminal' },
            { label: 'Web SDK', slug: 'tools/web' },
            { label: 'Claude Code Skill', slug: 'tools/claude-code-skill' },
          ],
        },
        {
          label: 'Workflows',
          items: [
            { label: 'AI / LLM Workflows', slug: 'ai-workflows' },
            { label: 'AI-Assisted Observability', slug: 'ai-observability' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Migration from OpenTelemetry', slug: 'migration' },
            { label: 'Development', slug: 'development' },
          ],
        },
      ],
    }),
  ],
});
