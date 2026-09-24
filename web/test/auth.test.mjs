import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuth, sign, verify } from '../src/auth.js';
import worker from '../src/worker.js';

const ENV = {
  SESSION_SECRET: 'test-secret-that-is-long-enough',
  GITHUB_CLIENT_ID: 'gh-id',
  GITHUB_CLIENT_SECRET: 'gh-secret',
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  RESEND_API_KEY: 're_key',
  EMAIL_FROM: 'Isuper <login@example.com>',
};
const ORIGIN = 'https://site.example';

const req = (path, init = {}) => new Request(ORIGIN + path, init);
const cookiesOf = (res) => res.headers.getSetCookie();
const cookieValue = (res, name) =>
  cookiesOf(res).find((c) => c.startsWith(name + '='))?.split(';')[0].slice(name.length + 1);

test('sign/verify: rejects tampering, wrong purpose, expiry and wrong secret', async () => {
  const exp = Date.now() / 1000 + 60;
  const t = await sign({ purpose: 'session', user: { id: 'x' }, exp }, 's1');
  assert.equal((await verify(t, 's1', 'session')).user.id, 'x');
  assert.equal(await verify(t, 's2', 'session'), null);
  assert.equal(await verify(t, 's1', 'email'), null);
  const [body, sig] = t.split('.');
  assert.equal(await verify(`${body}x.${sig}`, 's1', 'session'), null);
  assert.equal(await verify(await sign({ purpose: 'session', exp: 1 }, 's1'), 's1', 'session'), null);
  assert.equal(await verify('garbage', 's1', 'session'), null);
});

test('non-auth paths are not handled', async () => {
  assert.equal(await handleAuth(req('/api/feed'), ENV), null);
});

async function githubRoundTrip(fetchImpl) {
  const start = await handleAuth(req('/api/auth/login/github'), ENV);
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loc.searchParams.get('client_id'), 'gh-id');
  assert.equal(loc.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/callback/github`);
  const nonce = cookieValue(start, 'oauth_state');
  assert.ok(nonce);
  const state = loc.searchParams.get('state');
  return { state, nonce, fetchImpl };
}

test('GitHub OAuth: full round trip sets a session, /me returns the user', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    if (url.includes('access_token')) {
      assert.equal(new URLSearchParams(init.body).get('code'), 'the-code');
      return Response.json({ access_token: 'gho_abc' });
    }
    if (url.endsWith('/user')) return Response.json({ id: 42, login: 'octo', name: null, email: null, avatar_url: 'https://a/x.png' });
    if (url.endsWith('/user/emails')) return Response.json([{ email: 'o@x.dev', primary: true, verified: true }]);
    return new Response('nope', { status: 500 });
  };
  const { state, nonce } = await githubRoundTrip(fetchImpl);
  const cb = await handleAuth(
    req(`/api/auth/callback/github?code=the-code&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: `oauth_state=${nonce}` },
    }),
    ENV,
    fetchImpl,
  );
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('Location'), '/login?signed_in=1');
  const session = cookieValue(cb, 'session');
  assert.ok(session);
  assert.ok(cookiesOf(cb).some((c) => /session=.*HttpOnly; Secure; SameSite=Lax/.test(c)));

  const me = await handleAuth(req('/api/auth/me', { headers: { Cookie: `session=${session}` } }), ENV);
  assert.equal(me.status, 200);
  assert.deepEqual((await me.json()).user, {
    id: 'github:42', name: 'octo', email: 'o@x.dev', avatar: 'https://a/x.png', provider: 'github',
  });
  assert.equal(calls.length, 3);
});

test('OAuth callback: rejects missing/mismatched state cookie (CSRF)', async () => {
  const { state } = await githubRoundTrip();
  for (const cookie of ['', 'oauth_state=someone-elses-nonce']) {
    const res = await handleAuth(
      req(`/api/auth/callback/github?code=c&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } }),
      ENV,
      async () => { throw new Error('must not call provider'); },
    );
    assert.equal(res.headers.get('Location'), '/login?error=bad_state');
  }
});

test('OAuth callback: a GitHub state is not accepted by the Google callback', async () => {
  const { state, nonce } = await githubRoundTrip();
  const res = await handleAuth(
    req(`/api/auth/callback/google?code=c&state=${encodeURIComponent(state)}`, { headers: { Cookie: `oauth_state=${nonce}` } }),
    ENV,
  );
  assert.equal(res.headers.get('Location'), '/login?error=bad_state');
});

test('OAuth: provider failure and user cancel redirect with an error', async () => {
  const { state, nonce } = await githubRoundTrip();
  const failing = await handleAuth(
    req(`/api/auth/callback/github?code=c&state=${encodeURIComponent(state)}`, { headers: { Cookie: `oauth_state=${nonce}` } }),
    ENV,
    async () => Response.json({ error: 'bad_verification_code' }),
  );
  assert.equal(failing.headers.get('Location'), '/login?error=failed');
  const cancel = await handleAuth(req('/api/auth/callback/github?error=access_denied'), ENV);
  assert.equal(cancel.headers.get('Location'), '/login?error=cancelled');
});

test('Google OAuth: unverified email is dropped', async () => {
  const start = await handleAuth(req('/api/auth/login/google'), ENV);
  const loc = new URL(start.headers.get('Location'));
  assert.equal(loc.searchParams.get('scope'), 'openid email profile');
  const fetchImpl = async (url) =>
    url.includes('oauth2.googleapis.com/token')
      ? Response.json({ access_token: 'ya29' })
      : Response.json({ sub: '7', name: 'G', email: 'g@x.dev', email_verified: false, picture: null });
  const cb = await handleAuth(
    req(`/api/auth/callback/google?code=c&state=${encodeURIComponent(loc.searchParams.get('state'))}`, {
      headers: { Cookie: `oauth_state=${cookieValue(start, 'oauth_state')}` },
    }),
    ENV,
    fetchImpl,
  );
  const me = await handleAuth(req('/api/auth/me', { headers: { Cookie: `session=${cookieValue(cb, 'session')}` } }), ENV);
  const { user } = await me.json();
  assert.equal(user.id, 'google:7');
  assert.equal(user.email, null);
});

test('not configured: redirects instead of sending users to a broken provider', async () => {
  const res = await handleAuth(req('/api/auth/login/github'), { SESSION_SECRET: 'x' });
  assert.equal(res.headers.get('Location'), '/login?error=not_configured');
  const providers = await (await handleAuth(req('/api/auth/providers'), { SESSION_SECRET: 'x', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' })).json();
  assert.deepEqual(providers, { github: false, google: true, email: false });
  const unknown = await handleAuth(req('/api/auth/login/myspace'), ENV);
  assert.equal(unknown.status, 404);
});

test('email magic link: sends a link that signs the user in', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    sent = JSON.parse(init.body);
    return Response.json({ id: 'e1' });
  };
  const res = await handleAuth(
    req('/api/auth/email', { method: 'POST', body: JSON.stringify({ email: ' Me@Example.com ' }) }),
    ENV,
    fetchImpl,
  );
  assert.equal(res.status, 200);
  assert.equal(sent.to, 'me@example.com');
  const link = sent.text.match(/https:\/\/\S+/)[0];
  assert.ok(link.startsWith(`${ORIGIN}/api/auth/email/verify?token=`));

  const verifyRes = await handleAuth(new Request(link), ENV);
  assert.equal(verifyRes.headers.get('Location'), '/login?signed_in=1');
  const me = await handleAuth(req('/api/auth/me', { headers: { Cookie: `session=${cookieValue(verifyRes, 'session')}` } }), ENV);
  assert.equal((await me.json()).user.email, 'me@example.com');

  const bad = await handleAuth(req('/api/auth/email/verify?token=nope'), ENV);
  assert.equal(bad.headers.get('Location'), '/login?error=link_expired');
});

test('email: invalid address and missing config', async () => {
  const bad = await handleAuth(req('/api/auth/email', { method: 'POST', body: '{"email":"nope"}' }), ENV, async () => {
    throw new Error('must not send');
  });
  assert.equal(bad.status, 400);
  const off = await handleAuth(req('/api/auth/email', { method: 'POST', body: '{"email":"a@b.co"}' }), { SESSION_SECRET: 'x' });
  assert.equal(off.status, 501);
});

test('session cookie cannot be used as an email link, /me without cookie is 401, logout clears', async () => {
  const session = await sign({ purpose: 'session', user: { id: 'u' }, exp: Date.now() / 1000 + 60 }, ENV.SESSION_SECRET);
  const asLink = await handleAuth(req(`/api/auth/email/verify?token=${encodeURIComponent(session)}`), ENV);
  assert.equal(asLink.headers.get('Location'), '/login?error=link_expired');
  assert.equal((await handleAuth(req('/api/auth/me'), ENV)).status, 401);
  const out = await handleAuth(req('/api/auth/logout', { method: 'POST' }), ENV);
  assert.equal(out.status, 204);
  assert.match(out.headers.get('Set-Cookie'), /^session=; .*Max-Age=0/);
});

test('worker routes /api/auth/* before assets', async () => {
  const env = { ...ENV, ASSETS: { fetch: async () => new Response('asset') } };
  assert.equal((await worker.fetch(req('/api/auth/me'), env)).status, 401);
  assert.equal(await (await worker.fetch(req('/login'), env)).text(), 'asset');
});
