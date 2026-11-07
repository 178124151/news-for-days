import { z } from 'zod';

export const CATEGORIES = ['ai', 'tech', 'finance', 'policy'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  ai: 'AI',
  tech: '科技',
  finance: '金融',
  policy: '政策',
};

export const SourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['rss', 'api', 'html']),
  url: z.string().url(),
  category: z.enum(CATEGORIES),
  lang: z.enum(['en', 'zh']),
  weight: z.number().min(0).max(1),
  enabled: z.boolean(),
});
export type Source = z.infer<typeof SourceSchema>;

export const ArticleSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{16}$/),
  slug: z.string().min(1),
  titleZh: z.string().min(1).max(80),
  titleOriginal: z.string().min(1),
  summary: z.string().min(20),
  keyPoints: z.array(z.string().min(4)).length(3),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string().min(1)).min(1).max(8),
  entities: z.array(z.string()).max(20),
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  sourceUrl: z.string().url(),
  publishedAt: z.string().min(10),
  fetchedAt: z.string().min(10),
  importance: z.number().int().min(0).max(100),
  clusterId: z.string().optional(),
  alsoCoveredBy: z
    .array(z.object({ sourceName: z.string(), url: z.string().url() }))
    .optional(),
  readMinutes: z.number().int().min(1),
  aiProvider: z.enum(['nvidia', 'cloudflare', 'openrouter', 'pollinations', 'translate', 'extractive']),
  aiModel: z.string().min(1),
  contentHash: z.string().min(8),
  status: z.enum(['published', 'hidden']),
});
export type Article = z.infer<typeof ArticleSchema>;

export const DigestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headlineIds: z.array(z.string()),
  sections: z.record(z.enum(CATEGORIES), z.array(z.string())),
  stats: z.object({
    fetched: z.number().int().min(0),
    published: z.number().int().min(0),
    sources: z.number().int().min(0),
    aiFallbacks: z.number().int().min(0),
    durationMs: z.number().int().min(0),
  }),
});
export type Digest = z.infer<typeof DigestSchema>;

export const HealthSchema = z.object({
  date: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number().int().min(0),
  fetched: z.number().int().min(0),
  published: z.number().int().min(0),
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      ok: z.boolean(),
      count: z.number().int().min(0),
      ms: z.number().int().min(0),
      error: z.string().optional(),
    }),
  ),
  ai: z.record(z.string(), z.number().int().min(0)),
});
export type Health = z.infer<typeof HealthSchema>;
