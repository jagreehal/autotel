import type { APIRoute } from 'astro';

/**
 * RFC 9309 robots.txt, plus Content-Signal preferences (contentsignals.org).
 *
 * These are public open-source docs: search, AI training and AI inference are
 * all welcome. Flip the `Content-Signal` values and swap `Allow` for `Disallow`
 * in the AI block if that policy ever changes.
 */
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL(
    `${import.meta.env.BASE_URL}/sitemap.xml`.replace(/\/{2,}/g, '/'),
    site,
  );

  const rules = [
    'Content-Signal: ai-train=yes, search=yes, ai-input=yes',
    'Allow: /',
    'Disallow: /_astro/',
    'Disallow: /pagefind/',
  ];

  const aiCrawlers = [
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-Web',
    'Claude-SearchBot',
    'Google-Extended',
    'PerplexityBot',
    'Applebot-Extended',
    'meta-externalagent',
    'CCBot',
  ];

  const body = [
    '# autotel documentation — https://github.com/jagreehal/autotel',
    '',
    'User-agent: *',
    ...rules,
    '',
    '# AI crawlers, named explicitly so the policy is unambiguous.',
    ...aiCrawlers.map((agent) => `User-agent: ${agent}`),
    ...rules,
    '',
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
