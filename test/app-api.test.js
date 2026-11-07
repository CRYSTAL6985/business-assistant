// /api/app — the new owner panel API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

async function setup(t) {
  const db = openDb(':memory:');
  const server = createApp({ db, ask: null }).listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  const register = async (slug) => {
    const call = client();
    await call('POST', '/api/auth/register', { name: `Shop ${slug}`, slug, email: `${slug}@t.ir`, password: 'password123' });
    return call;
  };
  return { db, client, register };
}

test('app API needs a session', async (t) => {
  const { client } = await setup(t);
  for (const path of ['/api/app/me', '/api/app/overview', '/api/app/activity']) {
    assert.equal((await client()('GET', path)).status, 401, path);
  }
});

test('me lists only own stores and the plan usage', async (t) => {
  const { register } = await setup(t);
  const a = await register('me-a');
  await register('me-b');
  const me = (await a('GET', '/api/app/me')).body;
  assert.deepEqual(me.stores.map((s) => s.slug), ['me-a']);
  assert.equal(me.user.email, 'me-a@t.ir');
  assert.equal(me.usage.limit, 100);
  assert.equal(me.workspace.plan, 'free');
});

test('overview with another workspace\'s store id is 404', async (t) => {
  const { db, register } = await setup(t);
  await register('ov-a');
  const b = await register('ov-b');
  const storeA = db.prepare("SELECT id FROM stores WHERE slug = 'ov-a'").get().id;
  assert.equal((await b('GET', `/api/app/overview?store=${storeA}`)).status, 404);
  assert.equal((await b('GET', `/api/app/activity?store=${storeA}`)).status, 404);
});

test('bad custom range is 400', async (t) => {
  const { register } = await setup(t);
  const a = await register('rg-a');
  for (const q of ['range=custom&from=2026-11-05&to=2026-11-01', 'range=custom&from=bad&to=2026-11-01', 'range=custom&from=2025-01-01&to=2026-11-01', 'range=forever']) {
    const res = await a('GET', `/api/app/overview?${q}`);
    assert.equal(res.status, 400, q);
    assert.ok(res.body.error);
  }
});

test('overview numbers match seeded rows', async (t) => {
  const { db, register } = await setup(t);
  const a = await register('num-a');
  const store = db.prepare("SELECT id FROM stores WHERE slug = 'num-a'").get().id;
  db.prepare(`INSERT INTO orders (store_id, customer_name, phone, address, items_json, total, status)
    VALUES (?, 'C', '09120000000', 'Tehran 1', '[]', 250, 'confirmed')`).run(store);
  const res = await a('GET', '/api/app/overview?range=today');
  assert.equal(res.status, 200);
  assert.equal(res.body.metrics.orders.value, 1);
  assert.equal(res.body.metrics.revenue.value, 250);
  assert.equal(res.body.stores[0].orders, 1);
  assert.deepEqual(res.body.attention, []);
  assert.equal(res.body.scope.storeId, null);
});
