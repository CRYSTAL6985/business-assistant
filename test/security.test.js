// Hardening: CSRF guard, CSP and other headers, per-IP rate limits, production config checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, configFromEnv } = require('../src/server');
const { startApp } = require('./helpers');

async function rawApp(t, options = {}) {
  const db = openDb(':memory:');
  const server = createApp({ db, ask: null, ...options }).listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  return { db, base: `http://127.0.0.1:${server.address().port}` };
}

test('writes from another website or as a form post are refused; our own pages pass', async (t) => {
  const app = await startApp(t);
  const { call } = await app.register('csrf-shop');
  const cookie = await (async () => {
    const res = await fetch(`${app.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'csrf-shop@t.ir', password: 'password123' }) });
    return res.headers.get('set-cookie').split(';')[0];
  })();
  const post = (headers, body) => fetch(`${app.base}/api/app/settings/workspace`, { method: 'PUT', headers: { cookie, ...headers }, body }).then((r) => r.status);

  assert.equal(await post({ 'Content-Type': 'application/json', Origin: 'https://evil.example' }, JSON.stringify({ name: 'hacked' })), 403);
  assert.equal(await post({ 'Content-Type': 'application/x-www-form-urlencoded' }, 'name=hacked'), 415);
  assert.equal(await post({ 'Content-Type': 'application/json', Origin: app.base }, JSON.stringify({ name: 'Renamed' })), 200);
  assert.equal(app.db.prepare('SELECT name FROM workspaces').get().name, 'Renamed');
  assert.equal((await call('GET', '/api/app/me')).status, 200, 'reads are unaffected');
});

test('pages get a strict CSP; the chat page may be framed only by the store site', async (t) => {
  const app = await startApp(t);
  const { call, storeId } = await app.register('csp-shop');
  await call('PUT', `/api/app/stores/${storeId}`, { name: 'CSP Shop', domain: 'cspshop.ir' });
  const appPage = await fetch(`${app.base}/app`);
  const policy = appPage.headers.get('content-security-policy');
  assert.match(policy, /script-src 'self'(;|$)/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
  assert.match(policy, /frame-ancestors 'self'$/);
  assert.equal(appPage.headers.get('x-content-type-options'), 'nosniff');
  const chat = await fetch(`${app.base}/chat/csp-shop`);
  assert.match(chat.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/cspshop\.ir/);
  assert.match(chat.headers.get('content-security-policy'), /script-src 'self'/);
  for (const page of ['/app', '/admin', '/panel', '/chat/csp-shop', '/']) {
    const html = await fetch(app.base + page).then((r) => r.text());
    assert.doesNotMatch(html, /<script>|<script\s+(?![^>]*\bsrc=)[^>]*>/, `${page} has an inline script the CSP would block`);
  }
});

test('login, sign-up and chat are rate limited per IP', async (t) => {
  const { base } = await rawApp(t);
  const json = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  const logins = [];
  for (let i = 0; i < 12; i++) logins.push(await json('/api/auth/login', { email: `nobody${i}@t.ir`, password: 'wrong-password' }));
  assert.ok(logins.slice(0, 10).every((s) => s === 401));
  assert.equal(logins.at(-1), 429, 'the 11th try in a minute is refused even for a different email');
  const signups = [];
  for (let i = 0; i < 6; i++) signups.push(await json('/api/auth/register', { name: `S ${i}`, slug: `rl-shop-${i}`, email: `rl${i}@t.ir`, password: 'password123' }));
  assert.equal(signups.at(-1), 429);
  const chats = [];
  for (let i = 0; i < 21; i++) chats.push(await json('/api/chat/rl-shop-0', { message: 'سلام' }));
  assert.equal(chats[0], 200);
  assert.equal(chats.at(-1), 429);
});

test('production refuses to start without SECRET_KEY and PUBLIC_BASE_URL', () => {
  assert.throws(() => configFromEnv({ NODE_ENV: 'production' }), /SECRET_KEY and PUBLIC_BASE_URL/);
  const config = configFromEnv({ NODE_ENV: 'production', SECRET_KEY: 'x'.repeat(40), PUBLIC_BASE_URL: 'https://app.ir' });
  assert.equal(config.allowPrivateUrls, false);
  assert.equal(config.production, true);
  assert.equal(configFromEnv({}).allowPrivateUrls, true, 'development may call local test shops');
});

test('production sends HSTS', async (t) => {
  const { base } = await rawApp(t, { production: true });
  assert.match((await fetch(`${base}/app`)).headers.get('strict-transport-security'), /max-age=/);
});
