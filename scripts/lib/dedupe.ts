import { createHash } from 'node:crypto';

export function sha16(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

const TRACKING = /^(utm_|ref$|ref_|fbclid$|gclid$|spm$|from$|source$|mc_cid$|mc_eid$|__twitter_impression$|share$)/i;

/** URL 归一化：去追踪参数、协议、尾斜杠、锚点，用于去重键。 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.host.toLowerCase().replace(/^www\./, '');
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
    const path = u.pathname.replace(/\/+$/, '');
    return `https://${host}${path}${search}`;
  } catch {
    return raw.trim();
  }
}

const CJK = /[\u3400-\u9fff]/;

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  if (CJK.test(lower)) {
    const chars = [...lower.replace(/[^\u3400-\u9fffa-z0-9]+/g, '#' )];
    const grams: string[] = [];
    for (let i = 0; i < chars.length - 1; i++) grams.push(chars[i] + chars[i + 1]);
    return grams.length ? grams : chars;
  }
  return lower
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

function hash64(token: string): bigint {
  return BigInt('0x' + createHash('sha256').update(token).digest('hex').slice(0, 16));
}

/** 64 位 SimHash，用于标题近似去重。 */
export function simhash64(tokens: string[]): bigint {
  if (tokens.length === 0) return 0n;
  const votes = new Array<number>(64).fill(0);
  for (const token of new Set(tokens)) {
    const h = hash64(token);
    for (let bit = 0; bit < 64; bit++) {
      votes[bit] += (h >> BigInt(bit)) & 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit++) if (votes[bit] > 0) out |= 1n << BigInt(bit);
  return out;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const KNOWN_ENTITIES = [
  'OpenAI', 'Anthropic', 'DeepMind', 'Google', 'NVIDIA', 'Microsoft', 'Apple', 'Meta',
  'Amazon', 'Tesla', 'SpaceX', 'TSMC', 'Samsung', 'ByteDance', 'Alibaba', 'Tencent',
  'Baidu', 'xAI', 'Mistral', 'Hugging Face', 'GitHub', 'Linux', 'Android', 'Windows',
  'ChatGPT', 'GPT', 'Gemini', 'Claude', 'Llama', 'Qwen', 'DeepSeek', 'Sora',
  'Federal Reserve', 'SEC', 'EU', 'FTC', 'DOJ', 'IMF', 'OPEC', 'Nvidia',
  '英伟达', '微软', '苹果', '亚马逊', '特斯拉', '台积电', '字节跳动', '阿里巴巴',
  '腾讯', '百度', '华为', '小米', '比亚迪', '美联储', '央行', '中国人民银行',
  '欧盟', '英伟达', 'DeepSeek', '月之暗面', '智谱',
];

const STOPWORDS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'New', 'Why', 'How', 'What',
  'When', 'Where', 'Who', 'After', 'Before', 'In', 'On', 'For', 'With', 'It', 'Its',
  'Is', 'Are', 'Was', 'Will', 'Can', 'Could', 'Should', 'From', 'To', 'Of', 'And',
  'But', 'Not', 'Now', 'Here', 'There', 'We', 'You', 'They', 'I', 'My', 'Our',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);

/** 规则化实体抽取：已知机构表 + 英文大写词组；无需模型。 */
export function extractEntities(title: string): string[] {
  const found = new Set<string>();
  for (const name of KNOWN_ENTITIES) {
    const re = name.length <= 3 ? new RegExp(`\\b${name}\\b`) : new RegExp(name, 'i');
    if (re.test(title)) found.add(name);
  }
  for (const m of title.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[ -][A-Z][A-Za-z0-9]*)*\b/g)) {
    const word = m[0].trim();
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    found.add(word.split(/[ -]/).slice(0, 3).join(' '));
  }
  return [...found].slice(0, 8);
}

export interface Candidate {
  url: string;
  title: string;
  publishedAt: string;
  weight: number;
  entities: string[];
}

export interface DedupeDrop {
  url: string;
  rule: 'url' | 'title-simhash';
  duplicateOf: string;
}

export function dedupeCandidates(items: Candidate[]): { kept: Candidate[]; dropped: DedupeDrop[] } {
  const seenUrls = new Set<string>();
  const seenTitles: { hash: bigint; url: string; title: string }[] = [];
  const kept: Candidate[] = [];
  const dropped: DedupeDrop[] = [];

  for (const item of items) {
    const urlKey = normalizeUrl(item.url);
    if (seenUrls.has(urlKey)) {
      dropped.push({ url: item.url, rule: 'url', duplicateOf: urlKey });
      continue;
    }
    const hash = simhash64(tokenize(item.title));
    const twin = seenTitles.find((t) => hamming(t.hash, hash) <= 3);
    if (twin) {
      dropped.push({ url: item.url, rule: 'title-simhash', duplicateOf: twin.url });
      continue;
    }
    seenUrls.add(urlKey);
    seenTitles.push({ hash, url: urlKey, title: item.title });
    kept.push(item);
  }
  return { kept, dropped };
}

export interface ClusterInfo {
  clusterId: string;
  representativeUrl: string;
  members: { title: string; url: string }[];
}

/** 同事件聚类：24 小时内、实体重合 ≥ 2 且标题相似度 ≥ 0.6。 */
export function assignClusters(items: Candidate[]): Map<string, ClusterInfo> {
  const sorted = [...items].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  const clusters: { anchor: Candidate; members: Candidate[]; tokens: string[] }[] = [];

  for (const item of sorted) {
    const tokens = tokenize(item.title);
    const t = +new Date(item.publishedAt);
    const hit = clusters.find((c) => {
      const dt = Math.abs(t - +new Date(c.anchor.publishedAt));
      if (dt > 24 * 3600_000) return false;
      const overlap = item.entities.filter((e) => c.anchor.entities.includes(e)).length;
      return overlap >= 2 && jaccard(tokens, c.tokens) >= 0.6;
    });
    if (hit) hit.members.push(item);
    else clusters.push({ anchor: item, members: [item], tokens });
  }

  const result = new Map<string, ClusterInfo>();
  for (const c of clusters) {
    if (c.members.length < 2) continue;
    const rep = [...c.members].sort((a, b) => b.weight - a.weight)[0];
    const clusterId = 'c' + sha16(normalizeUrl(rep.url));
    const info: ClusterInfo = {
      clusterId,
      representativeUrl: rep.url,
      members: c.members.map((m) => ({ title: m.title, url: m.url })),
    };
    for (const m of c.members) result.set(m.url, info);
  }
  return result;
}
