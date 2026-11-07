// Shared test setup: a real app on a random port with an in-memory database.
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

async function startApp(t, { ask = null, fetch: doFetch } = {}) {
  const db = openDb(':memory:');
  const app = createApp({ db, ask, allowPrivateUrls: true, retryDelays: [0, 0], ...(doFetch ? { fetch: doFetch } : {}) });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  const register = async (slug) => {
    const call = client();
    const res = await call('POST', '/api/auth/register', { name: `Shop ${slug}`, slug, email: `${slug}@t.ir`, password: 'password123' });
    assert.equal(res.status, 201);
    const store = db.prepare('SELECT id, workspace_id FROM stores WHERE slug = ?').get(slug);
    return { call, storeId: store.id, workspaceId: store.workspace_id };
  };
  return { db, base, client, register, services: app.locals.services };
}

module.exports = { startApp };
