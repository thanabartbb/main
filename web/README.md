# Isuper agent - SDK (web)

Static site on Cloudflare Workers (static assets, no Worker script).

| URL      | File                | Source                                  |
| -------- | ------------------- | --------------------------------------- |
| `/`      | `public/index.html` | `loading.html`, verbatim except the "เริ่มใช้งานทันที" button now goes to `/login` |
| `/login` | `public/login.html` | `login.html`, byte-for-byte unchanged   |

Both pages render pixel-identical to the original files at 390×844 and 1280×800.

**Design rule:** these two files are the design. Change them only when the
change is asked for, and keep each change as small as the request.

## Deploy to production (Cloudflare Git integration)

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → `thanabartbb/main`.
2. Root directory: `web` · Build command: *(empty)* · Deploy command: `npx wrangler deploy`.
3. Production branch: the branch you merge into. Every push there deploys.
4. Optional: Settings → Domains & Routes → add your custom domain.

Manual deploy from a machine with a Cloudflare login: `cd web && npx wrangler deploy`.

## Not wired yet

Sign-in buttons (Email, GitHub, Google, ChatGPT, SAML SSO, Passkey, Sign Up,
Show other options) are still the original `alert()` placeholders, and
"ติดต่อฝ่ายขาย" has no target. Real sign-in needs a backend and an OAuth app
per provider.
