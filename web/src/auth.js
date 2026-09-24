// Sign-in for the Worker: GitHub OAuth, Google OAuth and email magic links.
// No database: the session is a signed cookie (HMAC-SHA256 with SESSION_SECRET).
//
// Routes (all under /api/auth):
//   GET  /login/github | /login/google    -> redirect to the provider
//   GET  /callback/github | /callback/google
//   POST /email          {email}          -> sends a sign-in link (Resend)
//   GET  /email/verify?token=...          -> signs in from that link
//   GET  /me                              -> {user} or 401
//   POST /logout
//
// Secrets (npx wrangler secret put NAME):
//   SESSION_SECRET                      required, any long random string
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   RESEND_API_KEY, EMAIL_FROM           for "Continue with Email"

export const SESSION_COOKIE = 'session';
const STATE_COOKIE = 'oauth_state';
const SESSION_TTL = 30 * 24 * 3600; // seconds
const STATE_TTL = 10 * 60;
const EMAIL_LINK_TTL = 15 * 60;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export const PROVIDERS = {
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    configured: (env) => env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
    clientId: (env) => env.GITHUB_CLIENT_ID,
    clientSecret: (env) => env.GITHUB_CLIENT_SECRET,
    async profile(accessToken, fetchImpl) {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'isuper-agent-sdk',
      };
      const res = await fetchImpl('https://api.github.com/user', { headers });
      if (!res.ok) throw new Error(`github user ${res.status}`);
      const u = await res.json();
      let email = u.email;
      if (!email) {
        const er = await fetchImpl('https://api.github.com/user/emails', { headers });
        if (er.ok) {
          const list = await er.json();
          email = (list.find((e) => e.primary && e.verified) || list.find((e) => e.verified))?.email || null;
        }
      }
      return { id: `github:${u.id}`, name: u.name || u.login, email, avatar: u.avatar_url || null };
    },
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    configured: (env) => env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    clientSecret: (env) => env.GOOGLE_CLIENT_SECRET,
    async profile(accessToken, fetchImpl) {
      const res = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`google userinfo ${res.status}`);
      const u = await res.json();
      return {
        id: `google:${u.sub}`,
        name: u.name || u.email,
        email: u.email_verified ? u.email : null,
        avatar: u.picture || null,
      };
    },
  },
};

// --- signed tokens -----------------------------------------------------------

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

// Returns the payload, or null if the signature, purpose or expiry is wrong.
export async function verify(token, secret, purpose) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (payload.purpose !== purpose || !(payload.exp > Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- cookies & responses -----------------------------------------------------

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

const loginError = (code, cookies) => redirect(`/login?error=${code}`, cookies);

async function startSession(user, env, cookies = []) {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign({ purpose: 'session', user, exp: now + SESSION_TTL }, env.SESSION_SECRET);
  return redirect('/login?signed_in=1', [...cookies, cookie(SESSION_COOKIE, token, SESSION_TTL)]);
}

export async function getUser(request, env) {
  if (!env.SESSION_SECRET) return null;
  const payload = await verify(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET, 'session');
  return payload?.user || null;
}

// --- OAuth -------------------------------------------------------------------

async function oauthStart(name, url, env) {
  const p = PROVIDERS[name];
  if (!env.SESSION_SECRET || !p.configured(env)) return loginError('not_configured');
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const state = await sign(
    { purpose: 'state', provider: name, nonce, exp: Math.floor(Date.now() / 1000) + STATE_TTL },
    env.SESSION_SECRET,
  );
  const q = new URLSearchParams({
    client_id: p.clientId(env),
    redirect_uri: `${url.origin}/api/auth/callback/${name}`,
    scope: p.scope,
    state,
    response_type: 'code',
  });
  return redirect(`${p.authorize}?${q}`, [cookie(STATE_COOKIE, nonce, STATE_TTL)]);
}

async function oauthCallback(name, url, request, env, fetchImpl) {
  const p = PROVIDERS[name];
  const clearState = cookie(STATE_COOKIE, '', 0);
  if (!env.SESSION_SECRET || !p.configured(env)) return loginError('not_configured', [clearState]);
  if (url.searchParams.get('error')) return loginError('cancelled', [clearState]);

  // CSRF: the signed state must match the nonce cookie set on this browser.
  const state = await verify(url.searchParams.get('state'), env.SESSION_SECRET, 'state');
  const nonce = getCookie(request, STATE_COOKIE);
  if (!state || state.provider !== name || !nonce || state.nonce !== nonce) {
    return loginError('bad_state', [clearState]);
  }

  const code = url.searchParams.get('code');
  if (!code) return loginError('failed', [clearState]);
  try {
    const tokenRes = await fetchImpl(p.token, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: p.clientId(env),
        client_secret: p.clientSecret(env),
        code,
        redirect_uri: `${url.origin}/api/auth/callback/${name}`,
        grant_type: 'authorization_code',
      }),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok || !tok.access_token) throw new Error(`token: ${tok.error || tokenRes.status}`);
    const user = await p.profile(tok.access_token, fetchImpl);
    return startSession({ ...user, provider: name }, env, [clearState]);
  } catch (err) {
    console.error(`oauth ${name} failed:`, err.message);
    return loginError('failed', [clearState]);
  }
}

// --- email magic link --------------------------------------------------------

async function emailStart(request, url, env, fetchImpl) {
  if (!env.SESSION_SECRET || !env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return Response.json({ error: 'not_configured' }, { status: 501 });
  }
  let email;
  try {
    email = String((await request.json()).email || '').trim().toLowerCase();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return Response.json({ error: 'invalid_email' }, { status: 400 });
  }
  const token = await sign(
    { purpose: 'email', email, exp: Math.floor(Date.now() / 1000) + EMAIL_LINK_TTL },
    env.SESSION_SECRET,
  );
  const link = `${url.origin}/api/auth/email/verify?token=${encodeURIComponent(token)}`;
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: email,
      subject: 'Sign in to Isuper agent - sdk',
      text: `Sign in to Isuper agent - sdk:\n\n${link}\n\nThis link expires in 15 minutes. If you did not ask for it, ignore this email.`,
    }),
  });
  if (!res.ok) {
    console.error('resend failed:', res.status, await res.text());
    return Response.json({ error: 'send_failed' }, { status: 502 });
  }
  return Response.json({ ok: true });
}

async function emailVerify(url, env) {
  if (!env.SESSION_SECRET) return loginError('not_configured');
  const payload = await verify(url.searchParams.get('token'), env.SESSION_SECRET, 'email');
  if (!payload) return loginError('link_expired');
  return startSession({ id: `email:${payload.email}`, name: payload.email, email: payload.email, avatar: null, provider: 'email' }, env);
}

// --- router ------------------------------------------------------------------

// Returns a Response for /api/auth/* paths, or null for anything else.
export async function handleAuth(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/auth/')) return null;
  const method = request.method;

  const m = path.match(/^\/api\/auth\/(login|callback)\/([a-z]+)$/);
  if (m && method === 'GET') {
    if (!PROVIDERS[m[2]]) return Response.json({ error: 'unknown provider' }, { status: 404 });
    return m[1] === 'login' ? oauthStart(m[2], url, env) : oauthCallback(m[2], url, request, env, fetchImpl);
  }
  if (path === '/api/auth/email' && method === 'POST') return emailStart(request, url, env, fetchImpl);
  if (path === '/api/auth/email/verify' && method === 'GET') return emailVerify(url, env);
  if (path === '/api/auth/me' && method === 'GET') {
    const user = await getUser(request, env);
    return Response.json(user ? { user } : { user: null }, {
      status: user ? 200 : 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0), 'Cache-Control': 'no-store' },
    });
  }
  // Tell the page which sign-in methods are live, so it can say so honestly.
  if (path === '/api/auth/providers' && method === 'GET') {
    const on = !!env.SESSION_SECRET;
    return Response.json({
      github: on && !!PROVIDERS.github.configured(env),
      google: on && !!PROVIDERS.google.configured(env),
      email: on && !!(env.RESEND_API_KEY && env.EMAIL_FROM),
    });
  }
  return Response.json({ error: 'not found' }, { status: 404 });
}
