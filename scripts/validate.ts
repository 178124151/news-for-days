import fs from 'node:fs';
import path from 'node:path';
import { ArticleSchema, DigestSchema, SourceSchema } from '../src/lib/schema.ts';

const ROOT = process.cwd();
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const walk = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(dir, f))
    : [];

const errors: string[] = [];
const sources = SourceSchema.array().parse(read(path.join(ROOT, 'content/sources.json')));
const sourceIds = new Set(sources.map((s) => s.id));

const articles = walk(path.join(ROOT, 'content/articles')).map((file) => {
  const parsed = ArticleSchema.safeParse(read(file));
  if (!parsed.success) {
    errors.push(`${file}: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    return null;
  }
  return parsed.data;
}).filter(Boolean) as ReturnType<typeof ArticleSchema.parse>[];

const ids = new Set<string>();
const slugs = new Set<string>();
for (const a of articles) {
  if (ids.has(a.id)) errors.push(`重复 id: ${a.id}`);
  if (slugs.has(a.slug)) errors.push(`重复 slug: ${a.slug}`);
  if (!sourceIds.has(a.sourceId)) errors.push(`未知来源: ${a.sourceId}`);
  ids.add(a.id);
  slugs.add(a.slug);
}

const digests = walk(path.join(ROOT, 'content/digests')).map((file) => {
  const parsed = DigestSchema.safeParse(read(file));
  if (!parsed.success) {
    errors.push(`${file}: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    return null;
  }
  return parsed.data;
}).filter(Boolean) as ReturnType<typeof DigestSchema.parse>[];

for (const d of digests) {
  for (const id of [...d.headlineIds, ...Object.values(d.sections).flat()]) {
    if (!ids.has(id)) errors.push(`日报 ${d.date} 引用了不存在的文章 ${id}`);
  }
}

if (errors.length) {
  console.error('校验失败：');
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`校验通过：${articles.length} 篇文章 / ${digests.length} 份日报 / ${sources.length} 个源`);
