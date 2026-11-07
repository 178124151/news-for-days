const BANNED = ['投资建议', '必将', '暴涨', '独家', '重磅', '稳赚', '翻倍', '抄底'];

const CJK_RE = /[\u3400-\u9fff]/g;

export function cjkRatio(text: string): number {
  const visible = text.replace(/\s/g, '');
  if (!visible) return 0;
  return (visible.match(CJK_RE)?.length ?? 0) / visible.length;
}

export function cleanText(text: string): string {
  let out = text;
  for (const word of BANNED) out = out.replaceAll(word, '');
  return out.replace(/\s+/g, ' ').replace(/^[，。；、\s]+/, '').trim();
}

const SHORT_PAD = '原文信息有限，建议阅读原文。';

export function shorten(text: string, max = 40): string {
  const s = text.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const stop = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('、'));
  if (stop >= 12) return cut.slice(0, stop);
  return cut + '…';
}

export function clampSummary(summary: string): string {
  let s = cleanText(summary).replace(/(原文信息有限，建议阅读原文。)+$/g, '').trim();
  if (s.length > 200) {
    const cut = s.slice(0, 200);
    const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
    s = stop >= 80 ? cut.slice(0, stop + 1) : cut.slice(0, 198) + '…';
  }
  if (s.length < 80) s = (s.replace(/[。！？…]+$/, '') + '。' + SHORT_PAD).trim();
  return s;
}

export function numbersIn(text: string): Set<string> {
  return new Set(
    (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, '')),
  );
}

/** 单位换算（10M → 1000万）会改变数量级，但差值是 10 的整数次幂，不算数字不一致。 */
function isUnitScale(a: number, b: number): boolean {
  if (!a || !b) return false;
  const exp = Math.log10(a > b ? a / b : b / a);
  return Math.abs(exp - Math.round(exp)) < 1e-6;
}

export interface QaInput {
  titleZh: string;
  summary: string;
  keyPoints: string[];
  provider: 'nvidia' | 'cloudflare' | 'openrouter' | 'pollinations' | 'translate' | 'extractive';
  sourceText: string;
}

export interface QaResult {
  ok: boolean;
  titleZh: string;
  summary: string;
  keyPoints: string[];
  issues: string[];
}

export function padPoints(points: string[], title: string): string[] {
  const out = [...new Set(points.map((p) => shorten(cleanText(p), 40)).filter(Boolean))];
  if (out.length < 3 && title) out.push(shorten(cleanText(title), 40));
  while (out.length < 3) out.push('详见原文');
  return out.slice(0, 3);
}

/** 自动质检：中文占比、长度、禁用词、数字一致性。不通过 → 交由抽取式兜底。 */
export function qaCheck(input: QaInput): QaResult {
  const issues: string[] = [];
  const titleZh = cleanText(input.titleZh).slice(0, 80);
  let summary = clampSummary(input.summary);
  const keyPoints = padPoints(input.keyPoints, titleZh);

  if (!titleZh) issues.push('title-empty');
  if (keyPoints.length < 3) issues.push('keypoints-short');

  // 公司名/英文术语会拉低占比，阈值放宽到 0.4 仍能拦住整段英文摘要
  if (input.provider !== 'extractive' && cjkRatio(summary) < 0.4) {
    issues.push('cjk-ratio');
  }

  // 数字一致性只用于生成式模型：机翻会做单位换算（57 billion → 570 亿）
  if (input.provider === 'nvidia' || input.provider === 'cloudflare' || input.provider === 'openrouter') {
    const src = numbersIn(input.sourceText);
    // 只比对 3 位以上数字：月份/日期/件数常由原文推导（November 18 → 11月18日）
    const srcNums = [...src];
    const missing = [...numbersIn(summary)].filter(
      (n) => n.length >= 3 && !src.has(n) && !srcNums.some((s) => isUnitScale(Number(n), Number(s))),
    );
    if (missing.length > 0) issues.push('number-mismatch');
  }

  if (summary.length < 80 || summary.length > 200) {
    summary = clampSummary(summary);
  }

  return {
    ok: issues.length === 0,
    titleZh,
    summary,
    keyPoints: keyPoints.slice(0, 3),
    issues,
  };
}

/** 抽取式兜底：只从原文取句子，不生成新事实。 */
export function extractiveSummary(text: string, title: string): { summary: string; keyPoints: string[] } {
  const boilerplate = /^(作者|编辑|图源|本文|原标题|校对|责编|来源[:：]|图片来源|视觉中国|记者)/;
  const sentences = text
    .split(/(?<=[。！？!?])\s*|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8 && !boilerplate.test(s));
  const picked = sentences.slice(0, 4);
  const summary = picked.join('') || text.slice(0, 200) || title;
  const keyPoints = padPoints(picked.slice(0, 3), title);
  return { summary: clampSummary(summary), keyPoints };
}
