import fs from 'node:fs';
import path from 'node:path';
import {
  ArticleSchema,
  CATEGORY_LABEL,
  DigestSchema,
  HealthSchema,
  SourceSchema,
  type Article,
  type Category,
  type Digest,
  type Health,
  type Source,
} from './schema.ts';

const CONTENT = path.resolve(process.cwd(), 'content');
const DATA = path.resolve(process.cwd(), 'data');

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

let articleCache: Article[] | null = null;

export function articles(): Article[] {
  if (articleCache) return articleCache;
  articleCache = walk(path.join(CONTENT, 'articles'))
    .map((f) => ArticleSchema.parse(JSON.parse(fs.readFileSync(f, 'utf8'))))
    .filter((a) => a.status === 'published')
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  return articleCache;
}

export function articlesByImportance(): Article[] {
  return [...articles()].sort((a, b) => b.importance - a.importance || +new Date(b.publishedAt) - +new Date(a.publishedAt));
}

export function articleMap(): Map<string, Article> {
  return new Map(articles().map((a) => [a.id, a]));
}

export function digests(): Digest[] {
  return walk(path.join(CONTENT, 'digests'))
    .map((f) => DigestSchema.parse(JSON.parse(fs.readFileSync(f, 'utf8'))))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function latestDigest(): Digest | undefined {
  return digests()[0];
}

export function sources(): Source[] {
  return SourceSchema.array().parse(JSON.parse(fs.readFileSync(path.join(CONTENT, 'sources.json'), 'utf8')));
}

export function health(): Health[] {
  return walk(path.join(DATA, 'health'))
    .map((f) => HealthSchema.parse(JSON.parse(fs.readFileSync(f, 'utf8'))))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function latestHealth(): Health | undefined {
  return health()[0];
}

export function tagsOf(list: Article[]): { tag: string; count: number }[] {
  const map = new Map<string, number>();
  for (const a of list) for (const t of a.tags) map.set(t, (map.get(t) ?? 0) + 1);
  return [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

export function categoryArticles(cat: Category): Article[] {
  return articlesByImportance().filter((a) => a.category === cat);
}

export const BASE = import.meta.env.BASE_URL;

export function href(pathname = ''): string {
  return BASE + pathname.replace(/^\/+/, '');
}

export function articleHref(a: Article): string {
  return href(`a/${a.slug}/`);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(dt);
}

export function providerLabel(a: Article): string {
  if (a.aiProvider === 'nvidia' || a.aiProvider === 'cloudflare' || a.aiProvider === 'openrouter' || a.aiProvider === 'pollinations') {
    return 'AI 摘要 · 自动生成，可能有误';
  }
  if (a.aiProvider === 'translate') return '机翻摘要 · 自动生成，可能有误';
  return '原文摘要 · 自动生成，可能有误';
}

export { CATEGORY_LABEL };
