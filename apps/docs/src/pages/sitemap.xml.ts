import type { APIRoute } from 'astro';

/**
 * `/sitemap.xml` alias for the sitemap index Starlight already emits as
 * `sitemap-index.xml`, because crawlers and agent-readiness checks look for
 * the canonical filename.
 */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${new URL(`${base}/sitemap-0.xml`, site)}</loc></sitemap></sitemapindex>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
