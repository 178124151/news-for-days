import fs from 'node:fs';
import path from 'node:path';
import {
  CATEGORIES,
  DigestSchema,
  HealthSchema,
  SourceSchema,
  type Article,
  type Category,
  type Digest,
  type Source,
} from '../src/lib/schema.ts';
import { fetchText } from './lib/http.ts';
import { parseFeed } from './lib/feed.ts';
import {
  assignClusters,
  dedupeCandidates,
  extractEntities,
  normalizeUrl,
  sha16,
  type Candidate,
} from './lib/dedupe.ts';
import { buildTags, enrichAll, importanceOf, type EnrichInput } from './lib/ai.ts';

const ROOT = process.cwd();
const CONTENT = path.join(ROOT, 'content');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(DATA, 'cache');

const args = process.argv.slice(2);
const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : undefined;
const DATE = dateArg ?? new Date().toLocaleDateString('sv-SE');

const TARGET: Record<Category, number> = { ai: 9, tech: 9, finance: 7, policy: 3 };
const MAX_PER_SOURCE = 4;

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`);

function atomicWriteJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function walkJson(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function main() {
  const startedAt = new Date();
  const sources = SourceSchema.array().parse(
    JSON.parse(fs.readFileSync(path.join(CONTENT, 'sources.json'), 'utf8')),
  ).filter((s) => s.enabled);

  const existing: Article[] = walkJson(path.join(CONTENT, 'articles'))
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
    .filter((a) => a?.status === 'published');
  const existingUrls = new Set(existing.map((a) => normalizeUrl(a.sourceUrl)));
  const existingSlugs = new Set(existing.map((a) => a.slug));

  const httpCacheFile = path.join(CACHE, 'http.json');
  const httpCache: Record<string, { etag?: string; lastModified?: string }> = fs.existsSync(httpCacheFile)
    ? JSON.parse(fs.readFileSync(httpCacheFile, 'utf8'))
    : {};

  const rawDir = path.join(DATA, 'raw', DATE);
  fs.mkdirSync(rawDir, { recursive: true });

  interface Fetched {
    source: Source;
    items: { url: string; title: string; publishedAt: string; contentText: string; author?: string }[];
    ok: boolean;
    ms: number;
    error?: string;
  }

  log(`开始采集 ${sources.length} 个源（${DATE}）`);
  const fetched = await pool(sources, 6, async (source): Promise<Fetched> => {
    const t0 = Date.now();
    const cached = httpCache[source.id];
    try {
      let res = await fetchText(source.url, { etag: cached?.etag, lastModified: cached?.lastModified });
      let items: Fetched['items'] = [];
      if (res.status === 304) {
        const previous = walkJson(path.join(DATA, 'raw'))
          .filter((f) => path.basename(f) === `${source.id}.json`)
          .sort()
          .pop();
        if (previous) {
          items = JSON.parse(fs.readFileSync(previous, 'utf8'));
          log(`  ${source.name}: 304 未变更，复用 ${items.length} 条`);
          return { source, items, ok: true, ms: Date.now() - t0 };
        }
        res = await fetchText(source.url);
      }
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      items = parseFeed(res.body).filter((i) => {
        const t = +new Date(i.publishedAt);
        return i.title.length >= 6 && Number.isFinite(t) && Date.now() - t < 10 * 86400_000;
      }).slice(0, 60);
      atomicWriteJson(path.join(rawDir, `${source.id}.json`), items);
      httpCache[source.id] = { etag: res.etag, lastModified: res.lastModified };
      log(`  ${source.name}: ${items.length} 条`);
      return { source, items, ok: true, ms: Date.now() - t0 };
    } catch (err) {
      const message = (err as Error).message.slice(0, 120);
      log(`  ${source.name}: 失败 ${message}`);
      return { source, items: [], ok: false, ms: Date.now() - t0, error: message };
    }
  });

  atomicWriteJson(httpCacheFile, httpCache);
  const rawCount = fetched.reduce((n, f) => n + f.items.length, 0);
  log(`采集完成：${rawCount} 条原始条目，成功源 ${fetched.filter((f) => f.ok).length}/${sources.length}`);

  // 候选池：源权重 + 实体抽取 + 去重 + 聚类
  const bySource = new Map(fetched.map((f) => [f.source.id, f.source]));
  const IRRELEVANT = /\bIRA\b|Roth|retirement|401\(k\)|should I\b|my wife|my husband|lottery|Porsche|horoscope|crossword|obituary/i;
  const candidates: (Candidate & { sourceId: string; text: string })[] = [];
  for (const f of fetched) {
    for (const item of f.items) {
      if (existingUrls.has(normalizeUrl(item.url))) continue;
      if (IRRELEVANT.test(item.title)) continue;
      candidates.push({
        url: item.url,
        title: item.title,
        publishedAt: item.publishedAt,
        weight: f.source.weight,
        entities: extractEntities(item.title),
        sourceId: f.source.id,
        text: item.contentText,
      });
    }
  }
  const { kept, dropped } = dedupeCandidates(candidates);
  log(`去重：保留 ${kept.length} 条，丢弃 ${dropped.length} 条（URL ${dropped.filter((d) => d.rule === 'url').length} / 标题近似 ${dropped.filter((d) => d.rule === 'title-simhash').length}）`);

  const clusters = assignClusters(kept);
  const repUrls = new Set([...clusters.values()].map((c) => c.representativeUrl));
  const scored = kept
    .filter((c) => !clusters.has(c.url) || repUrls.has(c.url))
    .map((c) => {
      const cluster = clusters.get(c.url);
      const bonus = cluster ? Math.min(10, (cluster.members.length - 1) * 5) : 0;
      return { ...c, cluster, importance: Math.min(100, importanceOf(c) + bonus) };
    })
    .sort((a, b) => b.importance - a.importance);

  // 配额选择：每类目标条数 + 单源上限
  const picked: typeof scored = [];
  const perSource = new Map<string, number>();
  const perCategory: Record<string, number> = { ai: 0, tech: 0, finance: 0, policy: 0 };
  const take = (item: (typeof scored)[number]) => {
    picked.push(item);
    perSource.set(item.sourceId, (perSource.get(item.sourceId) ?? 0) + 1);
    perCategory[bySource.get(item.sourceId)!.category]++;
  };
  for (const item of scored) {
    const source = bySource.get(item.sourceId)!;
    if (perCategory[source.category] >= TARGET[source.category]) continue;
    if ((perSource.get(item.sourceId) ?? 0) >= MAX_PER_SOURCE) continue;
    take(item);
  }
  if (picked.length < 20) {
    for (const item of scored) {
      if (picked.includes(item)) continue;
      if ((perSource.get(item.sourceId) ?? 0) >= MAX_PER_SOURCE) continue;
      take(item);
      if (picked.length >= 20) break;
    }
  }
  log(`选择：${picked.length} 条待加工（AI ${perCategory.ai} / 科技 ${perCategory.tech} / 金融 ${perCategory.finance} / 政策 ${perCategory.policy}）`);

  // AI 加工（无密钥时自动降级为免费机翻 / 抽取式）
  const enrichInputs: EnrichInput[] = picked.map((item) => {
    const source = bySource.get(item.sourceId)!;
    return {
      url: item.url,
      title: item.title,
      text: item.text || item.title,
      lang: source.lang,
      sourceName: source.name,
      category: source.category,
      weight: source.weight,
      publishedAt: item.publishedAt,
      entities: item.entities,
      importance: item.importance,
      contentHash: sha16(normalizeUrl(item.url) + '::' + item.title),
    };
  });
  const enriched = await enrichAll(enrichInputs, { cacheDir: path.join(CACHE, 'ai'), log });

  const now = new Date().toISOString();
  const sourceNameByUrl = new Map<string, string>();
  for (const c of candidates) sourceNameByUrl.set(c.url, bySource.get(c.sourceId)!.name);

  const written: Article[] = [];
  for (const item of picked) {
    const source = bySource.get(item.sourceId)!;
    const result = enriched.get(item.url);
    if (!result) continue;
    const id = sha16(normalizeUrl(item.url));
    let slug = slugify(item.title) || id;
    if (existingSlugs.has(slug)) slug = `${slug}-${id.slice(0, 6)}`;
    existingSlugs.add(slug);

    const cluster = item.cluster;
    const article: Article = {
      id,
      slug,
      titleZh: result.titleZh,
      titleOriginal: item.title,
      summary: result.summary,
      keyPoints: result.keyPoints,
      category: source.category,
      tags: result.tags.length ? result.tags : buildTags(enrichInputs.find((e) => e.url === item.url)!),
      entities: item.entities,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: item.url,
      publishedAt: item.publishedAt,
      fetchedAt: now,
      importance: result.importance,
      clusterId: cluster?.clusterId,
      alsoCoveredBy: cluster
        ? cluster.members
            .filter((m) => m.url !== item.url)
            .map((m) => ({ sourceName: sourceNameByUrl.get(m.url) ?? '其他来源', url: m.url }))
        : undefined,
      readMinutes: Math.max(1, Math.ceil((item.text.length || 800) / 700)),
      aiProvider: result.provider,
      aiModel: result.model,
      contentHash: sha16(normalizeUrl(item.url) + '::' + item.title),
      status: 'published',
    };
    const published = new Date(article.publishedAt);
    const file = path.join(
      CONTENT,
      'articles',
      String(published.getUTCFullYear()),
      String(published.getUTCMonth() + 1).padStart(2, '0'),
      `${id}.json`,
    );
    atomicWriteJson(file, article);
    written.push(article);
  }

  const all = [...existing, ...written];
  const today = all
    .filter((a) => a.fetchedAt.startsWith(DATE))
    .sort((a, b) => b.importance - a.importance);

  // 头条：跨领域、importance ≥ 40、最多 6 条，同分类不超过 3 条
  const headlines: Article[] = [];
  for (const a of today) {
    if (a.importance < 40) continue;
    if (headlines.filter((h) => h.category === a.category).length >= 3) continue;
    headlines.push(a);
    if (headlines.length === 6) break;
  }
  const headlineIds = new Set(headlines.map((a) => a.id));
  const sections = Object.fromEntries(
    CATEGORIES.map((cat) => [
      cat,
      today.filter((a) => a.category === cat && !headlineIds.has(a.id)).slice(0, 12).map((a) => a.id),
    ]),
  ) as Digest['sections'];

  const aiFallbacks = today.filter((a) => a.aiProvider === 'translate' || a.aiProvider === 'extractive').length;
  const digest: Digest = {
    date: DATE,
    headlineIds: headlines.map((a) => a.id),
    sections,
    stats: {
      fetched: rawCount,
      published: today.length,
      sources: fetched.filter((f) => f.ok).length,
      aiFallbacks,
      durationMs: Date.now() - startedAt.getTime(),
    },
  };
  DigestSchema.parse(digest);
  atomicWriteJson(path.join(CONTENT, 'digests', `${DATE}.json`), digest);

  const aiCounts: Record<string, number> = {};
  for (const a of today) aiCounts[a.aiProvider] = (aiCounts[a.aiProvider] ?? 0) + 1;

  const health = HealthSchema.parse({
    date: DATE,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    fetched: rawCount,
    published: today.length,
    sources: fetched.map((f) => ({
      id: f.source.id,
      name: f.source.name,
      ok: f.ok,
      count: f.items.length,
      ms: f.ms,
      ...(f.error ? { error: f.error } : {}),
    })),
    ai: aiCounts,
  });
  atomicWriteJson(path.join(DATA, 'health', `${DATE}.json`), health);

  // 原始数据只保留 7 天
  const rawRoot = path.join(DATA, 'raw');
  const cutoff = Date.now() - 7 * 86400_000;
  for (const dir of fs.readdirSync(rawRoot)) {
    const full = path.join(rawRoot, dir);
    if (fs.statSync(full).isDirectory() && +new Date(dir) < cutoff) fs.rmSync(full, { recursive: true, force: true });
  }

  log(`完成：发布 ${today.length} 条，头条 ${headlines.length} 条，降级 ${aiFallbacks} 条，耗时 ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s`);
  log(`Provider：${Object.entries(aiCounts).map(([k, v]) => `${k} ${v}`).join(' / ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
