import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_LABEL, type Category } from '../../src/lib/schema.ts';
import { cjkRatio, extractiveSummary, qaCheck, shorten } from './qa.ts';
import { requestJson, sleep } from './http.ts';

export interface EnrichInput {
  url: string;
  title: string;
  text: string;
  lang: 'en' | 'zh';
  sourceName: string;
  category: Category;
  weight: number;
  publishedAt: string;
  entities: string[];
  importance: number;
  contentHash: string;
}

export type Provider = 'cloudflare' | 'openrouter' | 'pollinations' | 'translate' | 'extractive';

export interface EnrichResult {
  titleZh: string;
  summary: string;
  keyPoints: string[];
  tags: string[];
  importance: number;
  provider: Provider;
  model: string;
}

const MODEL_CF = '@cf/qwen/qwen3-30b-a3b-fp8';
const MODEL_OR = 'qwen/qwen3-30b-a3b:free';

const PROMPT = `你是科技金融媒体的资深编辑。基于给定材料，输出严格 JSON 数组，不要输出任何解释。
每条输出字段：i（输入序号）, titleZh（中文标题≤30字，保留公司名）, summary（中文 80-200 字，只陈述材料事实）, keyPoints（3 条中文要点，每条≤40字）, tags（5 个中文标签）, importance（0-100 整数）。
规则：不补充外部信息、不推测、不编造数字；不用「重磅」「独家」「必将」「暴涨」等词；不给投资建议；材料信息不足时 summary 写「原文信息有限」。`;

const KEYWORD_TAGS: [RegExp, string][] = [
  [/发布|推出|launch|unveil|release|introduc/i, '产品发布'],
  [/融资|funding|raise[sd]?\b|series [a-e]/i, '融资'],
  [/收购|并购|acquire|acquisition|merger/i, '并购'],
  [/监管|regulat|lawsuit|antitrust|ban\b|probe/i, '监管'],
  [/芯片|chip|gpu|semiconductor|wafer|算力/i, '芯片'],
  [/模型|model|llm|大模型/i, '模型'],
  [/财报|earnings|revenue|profit/i, '财报'],
  [/研究|paper|research|study|benchmark/i, '研究'],
  [/关税|tariff|制裁|sanction|出口管制/i, '贸易政策'],
];

export function buildTags(item: EnrichInput): string[] {
  const tags: string[] = item.entities.slice(0, 2);
  for (const [re, label] of KEYWORD_TAGS) {
    if (re.test(item.title)) {
      tags.push(label);
      break;
    }
  }
  tags.push(CATEGORY_LABEL[item.category]);
  const unique = [...new Set(tags.filter(Boolean))];
  for (const pad of ['行业动态', '每日速览', '全球市场']) {
    if (unique.length >= 5) break;
    unique.push(pad);
  }
  return unique.slice(0, 5);
}

export function importanceOf(item: Pick<EnrichInput, 'weight' | 'publishedAt' | 'title' | 'importance'>): number {
  const hoursOld = Math.max(0, (Date.now() - +new Date(item.publishedAt)) / 3600_000);
  const recency = Math.max(0, 30 - hoursOld) ;
  const signal = /发布|推出|融资|收购|监管|突破|首次|launch|unveil|fund|acquire|ban|record/i.test(item.title) ? 12 : 0;
  return Math.min(100, Math.round(item.weight * 50 + recency + signal));
}

async function translateText(text: string): Promise<string> {
  const q = text.replace(/\s+/g, ' ').slice(0, 900);
  if (!q) return '';
  // 免费机翻：MyMemory 无需 Key；Google 端点在本机网络下被限流。
  const url =
    'https://api.mymemory.translated.net/get?langpair=en|zh-CN&de=signal-daily@example.com&q=' +
    encodeURIComponent(q);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await requestJson(url, { timeoutMs: 25000 });
      if (res.status >= 400) throw new Error(`translate ${res.status}`);
      const data = JSON.parse(res.text) as any;
      if (data?.quotaFinished) throw new Error('translate quota finished');
      if (Number(data?.responseStatus) !== 200) throw new Error(`translate ${data?.responseStatus}`);
      const out = decodeEntities(String(data?.responseData?.translatedText ?? '')).trim();
      if (out) return out;
      throw new Error('translate empty');
    } catch (err) {
      if (attempt === 1) throw err;
      await sleep(1500);
    }
  }
  return '';
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

interface ModelItem {
  i: number;
  titleZh?: string;
  summary?: string;
  keyPoints?: string[];
  tags?: string[];
  importance?: number;
}

function parseModelJson(text: string): ModelItem[] {
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function cloudflareBatch(batch: EnrichInput[]): Promise<Map<string, ModelItem>> {
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token) return new Map();
  const payload = batch.map((b, i) => ({
    i,
    title: b.title,
    source: b.sourceName,
    text: b.text.slice(0, 1500),
    category: b.category,
  }));
  const res = await requestJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODEL_CF}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
      timeoutMs: 60000,
    },
  );
  if (res.status >= 400) throw new Error(`cloudflare ${res.status}`);
  const data = JSON.parse(res.text) as any;
  const content = data?.result?.response ?? data?.result?.choices?.[0]?.message?.content ?? '';
  const parsed = parseModelJson(String(content));
  const map = new Map<string, ModelItem>();
  for (const item of parsed) if (batch[item.i]) map.set(batch[item.i].url, item);
  return map;
}

async function openrouterBatch(batch: EnrichInput[]): Promise<Map<string, ModelItem>> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return new Map();
  const payload = batch.map((b, i) => ({
    i,
    title: b.title,
    source: b.sourceName,
    text: b.text.slice(0, 1500),
    category: b.category,
  }));
  const res = await requestJson('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL_OR,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      temperature: 0.2,
      max_tokens: 2048,
    }),
    timeoutMs: 60000,
  });
  if (res.status >= 400) throw new Error(`openrouter ${res.status}`);
  const data = JSON.parse(res.text) as any;
  const content = data?.choices?.[0]?.message?.content ?? '';
  const parsed = parseModelJson(String(content));
  const map = new Map<string, ModelItem>();
  for (const item of parsed) if (batch[item.i]) map.set(batch[item.i].url, item);
  return map;
}

function fromModel(item: EnrichInput, m: ModelItem, provider: Provider, model: string): EnrichResult {
  return {
    titleZh: String(m.titleZh ?? item.title),
    summary: String(m.summary ?? ''),
    keyPoints: Array.isArray(m.keyPoints) ? m.keyPoints.map(String).slice(0, 3) : [],
    tags: Array.isArray(m.tags) && m.tags.length ? m.tags.map(String).slice(0, 5) : buildTags(item),
    importance:
      typeof m.importance === 'number' && Number.isFinite(m.importance)
        ? Math.min(100, Math.max(0, Math.round(m.importance)))
        : item.importance,
    provider,
    model,
  };
}

function fromTranslation(
  item: EnrichInput,
  tr: { titleZh: string; bodyZh: string },
  provider: Provider,
  model: string,
): EnrichResult {
  const boilerplate = /^(作者|编辑|图源|本文|原标题|校对|责编|来源[:：]|图片来源|视觉中国|记者)/;
  const sentences = tr.bodyZh
    .split(/(?<=[。！？!?])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6 && !boilerplate.test(s));
  const summary = sentences.slice(0, 3).join('').slice(0, 200);
  const keyPoints = [...sentences.slice(3), ...sentences]
    .map((s) => shorten(s, 40))
    .filter((s, i, arr) => s && arr.indexOf(s) === i)
    .slice(0, 3);
  const titleZh = shorten(tr.titleZh || item.title, 40);
  return {
    titleZh,
    summary: summary || titleZh,
    keyPoints: keyPoints.length === 3 ? keyPoints : [titleZh, ...keyPoints, '详见原文'].slice(0, 3),
    tags: buildTags(item),
    importance: item.importance,
    provider,
    model,
  };
}

async function pollinationsTranslateBatch(
  batch: EnrichInput[],
): Promise<Map<string, { titleZh: string; bodyZh: string }>> {
  const payload = batch.map((b, i) => ({
    i,
    title: b.title,
    text: (b.text || b.title).slice(0, 700),
  }));
  const res = await requestJson('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai',
      messages: [
        {
          role: 'system',
          content:
            '你是专业新闻翻译。把每条材料的标题和正文完整翻译成简体中文：保留事实、数字、单位与专有名词，不总结、不增删、不评论、不编造。只输出 JSON 数组，字段为 i, titleZh, bodyZh。',
        },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      temperature: 0.1,
    }),
    timeoutMs: 120000,
  });
  if (res.status >= 400) throw new Error(`pollinations ${res.status}`);
  const data = JSON.parse(res.text) as any;
  const content = String(data?.choices?.[0]?.message?.content ?? '');
  const parsed = parseModelJson(content) as unknown as { i: number; titleZh?: string; bodyZh?: string }[];
  const map = new Map<string, { titleZh: string; bodyZh: string }>();
  for (const row of parsed) {
    const item = batch[Number(row.i)];
    if (item && row.bodyZh) map.set(item.url, { titleZh: String(row.titleZh ?? ''), bodyZh: String(row.bodyZh) });
  }
  return map;
}

async function translateOne(item: EnrichInput): Promise<EnrichResult> {
  if (item.lang === 'zh' || cjkRatio(item.title) > 0.5) {
    const { summary, keyPoints } = extractiveSummary(item.text, item.title);
    return {
      titleZh: item.title,
      summary,
      keyPoints,
      tags: buildTags(item),
      importance: item.importance,
      provider: 'extractive',
      model: 'extractive-v1',
    };
  }
  const titleZh = await translateText(item.title);
  const body = item.text.length > 40 ? await translateText(item.text.slice(0, 700)) : '';
  return fromTranslation(item, { titleZh, bodyZh: body }, 'translate', 'mymemory-free');
}

function extractiveOne(item: EnrichInput): EnrichResult {
  const { summary, keyPoints } = extractiveSummary(item.text, item.title);
  return {
    titleZh: shorten(item.title, 80),
    summary,
    keyPoints,
    tags: buildTags(item),
    importance: item.importance,
    provider: 'extractive',
    model: 'extractive-v1',
  };
}

function readCache(cacheDir: string, hash: string): EnrichResult | null {
  try {
    const file = path.join(cacheDir, `${hash}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as EnrichResult;
  } catch {
    return null;
  }
}

function writeCache(cacheDir: string, hash: string, result: EnrichResult) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${hash}.json`);
  fs.writeFileSync(file + '.tmp', JSON.stringify(result, null, 2));
  fs.renameSync(file + '.tmp', file);
}

function finalize(item: EnrichInput, raw: EnrichResult): EnrichResult {
  const qa = qaCheck({
    titleZh: raw.titleZh,
    summary: raw.summary,
    keyPoints: raw.keyPoints,
    provider: raw.provider,
    sourceText: item.text + ' ' + item.title,
  });
  if (!qa.ok) return extractiveOne(item);
  return {
    ...raw,
    titleZh: qa.titleZh,
    summary: qa.summary,
    keyPoints: qa.keyPoints.length === 3 ? qa.keyPoints : extractiveOne(item).keyPoints,
  };
}

/** 按 Provider 链降级：Cloudflare → OpenRouter → 免费机翻 → 抽取式。 */
export async function enrichAll(
  items: EnrichInput[],
  opts: { cacheDir: string; log: (msg: string) => void },
): Promise<Map<string, EnrichResult>> {
  const results = new Map<string, EnrichResult>();
  const pending: EnrichInput[] = [];

  for (const item of items) {
    const cached = readCache(opts.cacheDir, item.contentHash);
    if (cached) results.set(item.url, cached);
    else pending.push(item);
  }
  opts.log(`AI 缓存命中 ${results.size}/${items.length}`);

  const runBatchProvider = async (
    name: string,
    fn: (batch: EnrichInput[]) => Promise<Map<string, ModelItem>>,
    model: string,
  ) => {
    const queue = pending.filter((p) => !results.has(p.url));
    for (let i = 0; i < queue.length; i += 5) {
      const batch = queue.slice(i, i + 5);
      try {
        const map = await fn(batch);
        for (const item of batch) {
          const m = map.get(item.url);
          if (!m) continue;
          const result = finalize(item, fromModel(item, m, name === 'cloudflare' ? 'cloudflare' : 'openrouter', model));
          results.set(item.url, result);
          writeCache(opts.cacheDir, item.contentHash, result);
        }
      } catch (err) {
        opts.log(`${name} 批量失败，切换到下一 Provider：${(err as Error).message}`);
        return;
      }
    }
  };

  if (process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN && pending.length) {
    await runBatchProvider('cloudflare', cloudflareBatch, MODEL_CF);
  }
  if (process.env.OPENROUTER_API_KEY && pending.some((p) => !results.has(p.url))) {
    await runBatchProvider('openrouter', openrouterBatch, MODEL_OR);
  }

  // 无密钥场景：免费 AI 翻译（Pollinations，无 Key）逐批翻译，faithful 不总结
  const english = pending.filter((p) => !results.has(p.url) && p.lang === 'en');
  for (let i = 0; i < english.length; i += 4) {
    const batch = english.slice(i, i + 4);
    try {
      const map = await pollinationsTranslateBatch(batch);
      for (const item of batch) {
        const tr = map.get(item.url);
        if (!tr) continue;
        const result = finalize(item, fromTranslation(item, tr, 'pollinations', 'gpt-oss-20b（翻译）'));
        results.set(item.url, result);
        writeCache(opts.cacheDir, item.contentHash, result);
      }
      await sleep(800);
    } catch (err) {
      opts.log(`pollinations 翻译失败，切换到 MyMemory：${(err as Error).message}`);
      break;
    }
  }

  for (const item of pending) {
    if (results.has(item.url)) continue;
    let result: EnrichResult;
    try {
      result = finalize(item, await translateOne(item));
      await sleep(700);
    } catch {
      result = finalize(item, extractiveOne(item));
    }
    results.set(item.url, result);
    writeCache(opts.cacheDir, item.contentHash, result);
  }

  return results;
}
