// Live AI news & community feeds for the home page.
// Each source is fetched from its public feed/API and normalised to:
//   { source, title, url, time (ms), meta, repo?, stars?, description? }

const HN = 'https://hn.algolia.com/api/v1/search_by_date';
const HN_FIELDS = 'title,url,author,points,num_comments,created_at_i,objectID';

function hnUrl(query, extra = '') {
  return `${HN}?query=${encodeURIComponent(query)}&tags=story&restrictSearchableAttributes=title&hitsPerPage=20&attributesToRetrieve=${HN_FIELDS}${extra}`;
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

export const SOURCES = {
  openai: { label: 'OpenAI', kind: 'rss', url: () => 'https://openai.com/news/rss.xml' },
  anthropic: { label: 'Anthropic', kind: 'hn', url: () => hnUrl('Anthropic') },
  claude: { label: 'Claude', kind: 'atom', url: () => 'https://github.com/anthropics/claude-code/releases.atom' },
  grok: { label: 'Grok', kind: 'hn', url: () => hnUrl('Grok') },
  ai: { label: 'AI News', kind: 'hn', url: () => hnUrl('AI', '&numericFilters=points%3E20') },
  community: {
    label: 'Community',
    kind: 'github',
    url: () => `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:ai-agents created:>${daysAgo(30)}`)}&sort=stars&order=desc&per_page=12`,
  },
};

// "All" merges every news source; Community stays in its own tab.
export const ALL = ['openai', 'anthropic', 'claude', 'grok', 'ai'];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function decode(s = '') {
  return s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

// Only http(s) links ever reach the page.
function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function stripHtml(s) {
  return decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function parseRss(xml, source) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, it]) => ({
    source,
    title: tag(it, 'title'),
    url: safeUrl(tag(it, 'link')),
    time: Date.parse(tag(it, 'pubDate')) || 0,
    meta: tag(it, 'category'),
  }));
}

export function parseAtom(xml, source) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(([, e]) => {
    const link = e.match(/<link[^>]*href="([^"]+)"/i);
    const summary = stripHtml(tag(e, 'content')).slice(0, 160);
    return {
      source,
      title: `Claude Code ${tag(e, 'title')}`,
      url: safeUrl(link ? decode(link[1]) : ''),
      time: Date.parse(tag(e, 'updated')) || 0,
      meta: 'Release',
      description: summary,
    };
  });
}

export function parseHn(json, source) {
  return (json.hits || []).map((h) => ({
    source,
    title: h.title || '',
    url: safeUrl(h.url) || `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}`,
    time: (h.created_at_i || 0) * 1000,
    meta: `HN · ${h.points ?? 0} points · ${h.num_comments ?? 0} comments`,
  }));
}

export function parseGithub(json, source) {
  return (json.items || []).map((r) => ({
    source,
    title: r.name || r.full_name,
    repo: r.full_name,
    url: safeUrl(r.html_url),
    time: Date.parse(r.pushed_at) || 0,
    stars: r.stargazers_count ?? 0,
    meta: r.language || '',
    description: r.description || '',
  }));
}

const PARSERS = { rss: parseRss, atom: parseAtom, hn: parseHn, github: parseGithub };

export async function fetchSource(id, { fetchImpl = fetch, githubToken } = {}) {
  const src = SOURCES[id];
  const headers = { 'User-Agent': 'isuper-agent-sdk-news/1.0 (+https://github.com/thanabartbb/main)' };
  if (src.kind === 'github') {
    headers.Accept = 'application/vnd.github+json';
    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  }
  // cf.cacheTtl: Cloudflare caches the upstream response at the edge, so every
  // visitor shares one upstream request per source per 5 minutes.
  const res = await fetchImpl(src.url(), { headers, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`${src.label}: upstream ${res.status}`);
  const body = src.kind === 'rss' || src.kind === 'atom' ? await res.text() : await res.json();
  return PARSERS[src.kind](body, id).filter((i) => i.title && i.url);
}

export async function getFeed(id, opts) {
  const ids = id === 'all' ? ALL : [id];
  const results = await Promise.allSettled(ids.map((s) => fetchSource(s, opts)));
  const items = [];
  const errors = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? items.push(...r.value) : errors.push({ source: ids[i], error: r.reason.message })));
  if (id !== 'community') items.sort((a, b) => b.time - a.time);
  return { source: id, items: items.slice(0, id === 'all' ? 15 : 20), errors, fetchedAt: Date.now() };
}
