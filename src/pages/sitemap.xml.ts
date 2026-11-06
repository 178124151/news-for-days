import type { APIRoute } from 'astro';
import { articles, digests, href, sources } from '../lib/content.ts';
import { CATEGORIES } from '../lib/schema.ts';

const SITE = import.meta.env.SITE ?? 'https://178124151.github.io';

const url = (path: string) => new URL(href(path), SITE).toString();

export const GET: APIRoute = () => {
  const arts = articles();
  const entries: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: url(''), priority: '1.0' },
    { loc: url('daily/'), priority: '0.7' },
    { loc: url('sources/'), priority: '0.5' },
    { loc: url('search/'), priority: '0.4' },
    { loc: url('about/'), priority: '0.3' },
    { loc: url('privacy/'), priority: '0.2' },
    { loc: url('disclaimer/'), priority: '0.2' },
    ...CATEGORIES.map((c) => ({ loc: url(`${c}/`), priority: '0.8' })),
    ...digests().map((d) => ({ loc: url(`daily/${d.date}/`), lastmod: d.date, priority: '0.7' })),
    ...arts.map((a) => ({
      loc: url(`a/${a.slug}/`),
      lastmod: a.fetchedAt.slice(0, 10),
      priority: '0.6',
    })),
    ...sources().map((s) => ({ loc: url(`sources/${s.id}/`), priority: '0.4' })),
    ...[...new Set(arts.flatMap((a) => a.tags))].map((t) => ({
      loc: url(`tags/${encodeURIComponent(t)}/`),
      priority: '0.3',
    })),
  ];

  const body = entries
    .map(
      (e) =>
        `  <url><loc>${e.loc.replace(/&/g, '&amp;')}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}<priority>${e.priority}</priority></url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
