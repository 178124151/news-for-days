import type { APIRoute } from 'astro';
import { articles } from '../../lib/content.ts';
import { CATEGORY_LABEL, type Category } from '../../lib/schema.ts';

export function getStaticPaths() {
  return articles().map((article) => ({ params: { slug: article.slug }, props: { article } }));
}

const COLORS: Record<Category, string> = {
  ai: '#8b5cf6',
  tech: '#0ea5e9',
  finance: '#10b981',
  policy: '#f59e0b',
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text: string, max = 20): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    line += ch;
    if (line.length >= max && /[\s，。、；：,.]/.test(ch)) {
      lines.push(line.trim());
      line = '';
    }
  }
  if (line) lines.push(line.trim());
  return lines.slice(0, 4);
}

export const GET: APIRoute = ({ props }) => {
  const article = (props as any).article;
  const color = COLORS[article.category as Category];
  const lines = wrap(article.titleZh, 19);
  const titleSvg = lines
    .map((l, i) => `<text x="80" y="${228 + i * 78}" font-size="56" font-weight="700" fill="#f4f4f2">${esc(l)}</text>`)
    .join('\n  ');
  const date = new Date(article.publishedAt).toISOString().slice(0, 10);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b0d10"/>
  <rect x="0" y="0" width="12" height="630" fill="${color}"/>
  <circle cx="1090" cy="120" r="190" fill="${color}" opacity="0.12"/>
  <text x="80" y="92" font-family="PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif" font-size="22" letter-spacing="6" fill="#8b9099">SIGNAL DAILY · 信号日报</text>
  <rect x="80" y="132" width="${CATEGORY_LABEL[article.category as Category].length * 28 + 40}" height="44" rx="22" fill="${color}" opacity="0.18"/>
  <text x="100" y="162" font-family="PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif" font-size="22" fill="${color}">${esc(CATEGORY_LABEL[article.category as Category])}</text>
  <g font-family="PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif">
  ${titleSvg}
  </g>
  <text x="80" y="566" font-family="PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif" font-size="24" fill="#9aa1ab">${esc(article.sourceName)} · ${date}</text>
</svg>`;

  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } });
};
