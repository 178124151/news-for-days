import type { APIRoute } from 'astro';
import { articles } from '../lib/content.ts';

const SITE = import.meta.env.SITE ?? 'https://178124151.github.io';
const BASE = import.meta.env.BASE_URL;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = () => {
  const items = [...articles()]
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
    .slice(0, 50);

  const entries = items
    .map(
      (a) => `    <item>
      <title>${esc(a.titleZh)}</title>
      <link>${SITE}${BASE}a/${a.slug}/</link>
      <guid isPermaLink="true">${SITE}${BASE}a/${a.slug}/</guid>
      <pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>
      <category>${esc(a.category)}</category>
      <description>${esc(a.summary)}</description>
      <source url="${esc(a.sourceUrl)}">${esc(a.sourceName)}</source>
    </item>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Signal Daily · 信号日报</title>
    <link>${SITE}${BASE}</link>
    <description>科技、金融、AI 每日资讯精选，AI 生成中文摘要。</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE}${BASE}rss.xml" rel="self" type="application/rss+xml" />
${entries}
  </channel>
</rss>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
