import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://jagreehal.github.io',
  base: '/autotel',
  integrations: [
    starlight({
      title: 'autotel',
      favicon: '/favicon.svg',
      components: {
        PageTitle: './src/components/PageTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      logo: {
        dark: './src/assets/logo-dark.svg',
        light: './src/assets/logo-light.svg',
        replacesTitle: false,
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
            { label: 'NestJS', slug: 'frameworks/nestjs' },
            { label: 'Hono', slug: 'frameworks/hono' },
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
