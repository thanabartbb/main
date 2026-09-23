# Isuper agent - SDK (web)

Cloudflare Worker + static assets. The Worker only answers `/api/feed`;
everything else is served from `public/`.

| URL      | File                | Source                                  |
| -------- | ------------------- | --------------------------------------- |
| `/`      | `public/index.html` | `loading-news-community.html` |
| `/login` | `public/login.html` | `login-13.html`               |
| `/logo.svg` | `public/logo.svg` | the official logo (also the favicon) |

Changes from the source files, and nothing else:
- Logo replaced with `logo.svg` on both pages. On `/login` only the white mark
  goes inside the existing `.logo-wrap` tile, so the tile is not doubled.
- `<link rel="icon" href="/logo.svg">` added to both pages.
- "เริ่มใช้งานทันที" goes to `/login`.
- The News & Community cards were replaced by a live, tabbed feed (below).

## Live News & Community

`GET /api/feed?source=all|openai|anthropic|claude|grok|ai|community`
(`src/worker.js`, `src/feeds.js`). The page refreshes the open tab every 60 s
and remembers the last tab.

| Tab       | Upstream                                                        |
| --------- | --------------------------------------------------------------- |
| OpenAI    | `openai.com/news/rss.xml` (official RSS)                        |
| Anthropic | Hacker News stories with "Anthropic" in the title (no official Anthropic feed) |
| Claude    | `github.com/anthropics/claude-code/releases.atom`               |
| Grok      | Hacker News stories with "Grok" in the title (no official xAI feed) |
| AI News   | Hacker News stories with "AI" in the title, > 20 points         |
| Community | GitHub repos tagged `ai-agents`, created in the last 30 days, by stars |
| All       | OpenAI + Anthropic + Claude + Grok + AI News, newest 15         |

Upstream responses are cached at Cloudflare's edge for 5 minutes, so traffic
does not multiply upstream requests. If one source fails, the others still show.

GitHub's unauthenticated search limit is low. For a reliable Community tab, add
a read-only token: `npx wrangler secret put GITHUB_TOKEN`.

Tests: `npm test` (parsers run against real samples saved in `test/fixtures/`).

**Design rule:** these two files are the design. Change them only when the
change is asked for, and keep each change as small as the request.

## Deploy to production (Cloudflare Git integration)

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → `thanabartbb/main`.
2. Root directory: `web` · Build command: *(empty)* · Deploy command: `npx wrangler deploy`.
   Optional: add `GITHUB_TOKEN` under Settings → Variables and Secrets.
3. Production branch: the branch you merge into. Every push there deploys.
4. Optional: Settings → Domains & Routes → add your custom domain.

Manual deploy from a machine with a Cloudflare login: `cd web && npx wrangler deploy`.

## Not wired yet

"View all →" links to `/news`, which does not exist yet (404). Sign-in buttons (Email, GitHub, Google, ChatGPT, SAML SSO, Passkey, Sign Up,
Show other options) are still the original `alert()` placeholders, and
"ติดต่อฝ่ายขาย" has no target. Real sign-in needs a backend and an OAuth app
per provider.
