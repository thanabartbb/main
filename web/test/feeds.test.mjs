import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRss, parseAtom, parseHn, parseGithub, getFeed, SOURCES } from '../src/feeds.js';
import worker from '../src/worker.js';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('OpenAI RSS (real sample)', () => {
  const items = parseRss(fx('openai.rss.xml'), 'openai');
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Better prompt caching for GPT-6');
  assert.equal(items[0].url, 'https://openai.com/index/better-prompt-caching-for-gpt-6');
  assert.equal(items[0].time, Date.parse('Tue, 22 Sep 2026 21:00:00 GMT'));
  assert.equal(items[0].meta, 'Product');
});

test('Claude Code releases Atom (real sample)', () => {
  const items = parseAtom(fx('claude.atom.xml'), 'claude');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Claude Code v2.1.280');
  assert.equal(items[0].url, 'https://github.com/anthropics/claude-code/releases/tag/v2.1.280');
  assert.ok(items[0].description.length > 0 && !items[0].description.includes('<'));
});

test('Hacker News: falls back to HN link when story has no url', () => {
  const items = parseHn(JSON.parse(fx('hn.json')), 'anthropic');
  assert.equal(items[0].url.startsWith('https://www.theverge.com/'), true);
  assert.equal(items[1].url, 'https://news.ycombinator.com/item?id=49809846');
  assert.match(items[0].meta, /2 points/);
});

test('GitHub: repo fields, unsafe links dropped', () => {
  const items = parseGithub(JSON.parse(fx('github.json')), 'community');
  assert.equal(items[0].repo, 'affaan-m/ECC');
  assert.equal(items[0].stars, 265506);
  assert.equal(items[1].url, null);
});

function mockFetch(map) {
  return async (url) => {
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) return new Response('nope', { status: 500 });
    return new Response(map[key]);
  };
}

test('getFeed("all") merges sources newest first and reports failures', async () => {
  const fetchImpl = mockFetch({
    'openai.com': fx('openai.rss.xml'),
    'releases.atom': fx('claude.atom.xml'),
    'query=Anthropic': fx('hn.json'),
  });
  const feed = await getFeed('all', { fetchImpl });
  assert.ok(feed.items.length >= 6);
  for (let i = 1; i < feed.items.length; i++) assert.ok(feed.items[i - 1].time >= feed.items[i].time);
  assert.deepEqual(feed.errors.map((e) => e.source).sort(), ['ai', 'grok']);
});

test('worker: /api/feed validates source; other paths go to assets', async () => {
  const env = { ASSETS: { fetch: async () => new Response('asset') } };
  const bad = await worker.fetch(new Request('https://x/api/feed?source=nope'), env);
  assert.equal(bad.status, 400);
  const page = await worker.fetch(new Request('https://x/login'), env);
  assert.equal(await page.text(), 'asset');
  assert.deepEqual(Object.keys(SOURCES), ['openai', 'anthropic', 'claude', 'grok', 'ai', 'community']);
});
