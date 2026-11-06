import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

export interface FeedItem {
  url: string;
  title: string;
  author?: string;
  publishedAt: string;
  contentText: string;
}

type Node = unknown;

const asArray = (v: Node): Node[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function text(v: Node): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, Node>;
    if (typeof o['#text'] === 'string') return o['#text'];
    if (typeof o['@_href'] === 'string') return o['@_href'];
  }
  return '';
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

function linkOf(item: Record<string, Node>): string {
  const raw = item.link;
  if (typeof raw === 'string') return raw;
  const links = asArray(raw).map((l) => l as Record<string, Node>);
  const alternate = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate');
  const href = text(alternate ?? links[0]);
  if (href) return href;
  const id = text(item.id);
  return /^https?:/.test(id) ? id : '';
}

function bodyOf(item: Record<string, Node>): string {
  for (const key of ['content:encoded', 'content', 'description', 'summary', 'media:description']) {
    const raw = text(item[key]);
    const clean = stripHtml(raw);
    if (clean.length > 0) return clean;
  }
  return '';
}

function dateOf(item: Record<string, Node>, fallback: string): string {
  for (const key of ['pubDate', 'published', 'updated', 'dc:date', 'date']) {
    const raw = text(item[key]);
    if (raw) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return fallback;
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const now = new Date().toISOString();
  const rssItems = asArray(doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item);
  const atomItems = asArray(doc?.feed?.entry);
  const items = [...rssItems, ...atomItems].map((i) => i as Record<string, Node>);

  const out: FeedItem[] = [];
  for (const item of items) {
    const url = linkOf(item);
    const title = stripHtml(text(item.title));
    if (!url || !/^https?:\/\//.test(url) || !title) continue;
    const author = text(item['dc:creator']) || text(item.author) || undefined;
    out.push({
      url,
      title,
      author: author && author.length < 80 ? author : undefined,
      publishedAt: dateOf(item, now),
      contentText: bodyOf(item).slice(0, 6000),
    });
  }
  return out;
}
