import assert from 'node:assert/strict';
import { assignClusters, dedupeCandidates, hamming, normalizeUrl, simhash64, tokenize } from './lib/dedupe.ts';

assert.equal(
  normalizeUrl('http://www.example.com/a/b/?utm_source=x&ref=hn#top'),
  'https://example.com/a/b',
);
assert.equal(normalizeUrl('https://example.com/a/b'), 'https://example.com/a/b');
assert.notEqual(normalizeUrl('https://example.com/a?page=2'), normalizeUrl('https://example.com/a'));

const a = simhash64(tokenize('OpenAI launches GPT-6 with better reasoning'));
const b = simhash64(tokenize('OpenAI launches GPT-6 with better reasoning'));
const c = simhash64(tokenize('Nvidia earnings beat expectations'));
assert.equal(hamming(a, b), 0);
assert.ok(hamming(a, c) > 3);

const base = {
  publishedAt: new Date().toISOString(),
  weight: 0.8,
  entities: ['OpenAI'],
};
const { kept, dropped } = dedupeCandidates([
  { ...base, url: 'https://a.com/x?utm_source=rss', title: 'OpenAI launches new model' },
  { ...base, url: 'https://a.com/x', title: 'OpenAI launches new model' },
  { ...base, url: 'https://b.com/y', title: 'Something completely different about chips' },
]);
assert.equal(kept.length, 2);
assert.equal(dropped.length, 1);
assert.equal(dropped[0].rule, 'url');

const clusterMap = assignClusters([
  {
    url: 'https://a.com/1',
    title: 'OpenAI releases GPT-6 model for developers',
    publishedAt: new Date().toISOString(),
    weight: 0.9,
    entities: ['OpenAI', 'GPT'],
  },
  {
    url: 'https://b.com/2',
    title: 'OpenAI releases GPT-6 model for all developers',
    publishedAt: new Date().toISOString(),
    weight: 0.7,
    entities: ['OpenAI', 'GPT'],
  },
]);
assert.equal(clusterMap.size, 2, '同事件应聚为同一个 cluster');
assert.equal(new Set([...clusterMap.values()].map((c) => c.clusterId)).size, 1);
assert.equal(clusterMap.get('https://a.com/1')!.representativeUrl, 'https://a.com/1');

console.log('去重与聚类自检通过');
