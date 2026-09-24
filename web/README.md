# Isuper agent - SDK (web)

Cloudflare Worker + static assets. The Worker only answers `/api/feed` and `/api/auth/*`;
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

## Sign-in (`/login`)

`src/auth.js`. There's no database: the session is a signed cookie
(HMAC-SHA256, `HttpOnly; Secure; SameSite=Lax`, 30 days).

| Button              | Works when these secrets are set                                  |
| ------------------- | ----------------------------------------------------------------- |
| Continue with GitHub | `SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`     |
| Continue with Google | `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     |
| Continue with Email  | `SESSION_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM` (15-minute magic link) |

If a method isn't set up, the page says so instead of sending people to a broken
provider. ChatGPT, SAML SSO and Passkey show "not available yet". Sign Up
explains that the account is created the first time someone signs in.

Setup (replace `<your-domain>` with the deployed host, e.g. `basaawclaude.thanabartbb.workers.dev`):

1. `SESSION_SECRET`: `openssl rand -base64 32`, then `npx wrangler secret put SESSION_SECRET`.
   Changing it signs everyone out.
2. GitHub: github.com → Settings → Developer settings → OAuth Apps → New.
   Callback URL: `https://<your-domain>/api/auth/callback/github`.
3. Google: console.cloud.google.com → APIs & Services → Credentials → OAuth client ID
   (Web application). Authorized redirect URI:
   `https://<your-domain>/api/auth/callback/google`.
4. Email (optional): a resend.com API key, plus a sender on a domain verified in
   Resend, e.g. `EMAIL_FROM="Isuper <login@yourdomain.com>"`.

Put each value in with `npx wrangler secret put NAME`, or in the dashboard under
Settings → Variables and Secrets (type: Secret). For `npx wrangler dev`, put them
in `web/.dev.vars` (git-ignored).

API: `GET /api/auth/me` returns `{user}`, or 401 when signed out.
`POST /api/auth/logout` signs out.

## Not wired yet

"View all →" links to `/news`, which does not exist yet (404). ChatGPT, SAML SSO
and Passkey sign-in aren't built. "ติดต่อฝ่ายขาย" has no target.
