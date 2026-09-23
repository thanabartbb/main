import { getFeed, SOURCES } from './feeds.js';

// Everything except /api/* is served straight from ./public (see wrangler.jsonc).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/feed') {
      const source = url.searchParams.get('source') || 'all';
      if (source !== 'all' && !SOURCES[source]) {
        return Response.json({ error: `unknown source: ${source}` }, { status: 400 });
      }
      try {
        const feed = await getFeed(source, { githubToken: env.GITHUB_TOKEN });
        const status = feed.items.length || !feed.errors.length ? 200 : 502;
        return Response.json(feed, {
          status,
          headers: { 'Cache-Control': 'public, max-age=60' },
        });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 502 });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
