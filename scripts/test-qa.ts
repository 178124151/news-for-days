import assert from 'node:assert/strict';
import { qaCheck } from './lib/qa.ts';

const base = {
  titleZh: '英伟达发布新一代 AI 芯片',
  summary: '英伟达发布面向数据中心的新 AI 芯片，性能较上一代提升 30%。原文信息有限，建议阅读原文。',
  keyPoints: ['性能提升 30%', '面向数据中心', '功耗更低'],
  provider: 'nvidia' as const,
};
const issuesOf = (summary: string, sourceText: string) =>
  qaCheck({ ...base, summary, sourceText }).issues;

// 单位换算：10M → 1000 万美元，不是数字不一致
assert.ok(
  !issuesOf(
    'Physicl 获得 1000 万美元融资，用于机器人仿真到现实的迁移研究。原文信息有限，建议阅读原文。',
    'Physicl raises $10M to make the digital world real enough for robots.',
  ).includes('number-mismatch'),
);
// 原文没有的大额数字仍要拦下
assert.ok(
  issuesOf(
    'Physicl 本轮融资规模达 5000 万美元，用于机器人仿真。原文信息有限，建议阅读原文。',
    'Physicl raises $10M to make the digital world real enough for robots.',
  ).includes('number-mismatch'),
);
// 月份/日期由原文推导：November 18 → 11月18日
assert.ok(
  !issuesOf(
    '英伟达 CEO 将于 11 月 18 日出席国会闭门简报。原文信息有限，建议阅读原文。',
    'Jensen Huang will brief Congress on November 18.',
  ).includes('number-mismatch'),
);
// 公司名较长的中文摘要不应判为中文占比不足
assert.ok(
  !issuesOf(
    'OpenAI将收购Pierre Computer Company，扩展Codex代码构建、理解和审阅工具。原文信息有限，建议阅读原文。',
    'OpenAI to acquire Pierre Computer Company, Inc.',
  ).includes('cjk-ratio'),
);
// 整段英文摘要要拦下
assert.ok(
  issuesOf(
    'OpenAI acquires Pierre Computer Company to extend Codex tooling for code review and shipping, the company said today.',
    'OpenAI to acquire Pierre Computer Company, Inc.',
  ).includes('cjk-ratio'),
);

console.log('AI 摘要质检自检通过');
