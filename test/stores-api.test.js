// Stores: plan limits, disconnect/reconnect, delete, isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

test('free plan allows one store, pro allows five', async (t) => {
  const { db, register } = await startApp(t);
  const { call, workspaceId } = await register('lim-shop');
  const second = await call('POST', '/api/app/stores', { name: 'Second', slug: 'lim-two' });
  assert.equal(second.status, 403);
  assert.match(second.body.error, /سقف/);
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(workspaceId);
  for (let i = 2; i <= 5; i++) assert.equal((await call('POST', '/api/app/stores', { name: `S${i}`, slug: `lim-${i}` })).status, 201);
  assert.equal((await call('POST', '/api/app/stores', { name: 'S6', slug: 'lim-6' })).status, 403);
  const list = (await call('GET', '/api/app/stores')).body;
  assert.equal(list.used, 5);
  assert.equal(list.limit, 5);
});

test('new store gets an assistant config and a normalized domain', async (t) => {
  const { db, register } = await startApp(t);
  const { call, workspaceId } = await register('dom-shop');
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(workspaceId);
  const res = await call('POST', '/api/app/stores', { name: 'Domain Shop', slug: 'dom-two', domain: 'https://WWW.Shop.ir/path?x=1' });
  assert.equal(res.status, 201);
  const store = db.prepare('SELECT id, domain FROM stores WHERE slug = ?').get('dom-two');
  assert.equal(store.domain, 'www.shop.ir');
  assert.ok(db.prepare('SELECT 1 FROM assistant_configs WHERE store_id = ?').get(store.id));
});

test('taken slug is 409, bad slug is 400', async (t) => {
  const { db, register } = await startApp(t);
  const a = await register('taken-a');
  await register('taken-b');
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(a.workspaceId);
  assert.equal((await a.call('POST', '/api/app/stores', { name: 'X shop', slug: 'taken-b' })).status, 409);
  assert.equal((await a.call('POST', '/api/app/stores', { name: 'X shop', slug: 'Bad Slug!' })).status, 400);
});

test('disconnect hides the store and stops its chat; reconnect restores it', async (t) => {
  const { db, base, register } = await startApp(t);
  const { call, storeId, workspaceId } = await register('dc-shop');
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(workspaceId);
  await call('POST', '/api/app/stores', { name: 'Other', slug: 'dc-other' });
  assert.equal((await call('POST', `/api/app/stores/${storeId}/disconnect`)).status, 200);
  assert.deepEqual((await call('GET', '/api/app/me')).body.stores.map((s) => s.slug), ['dc-other']);
  assert.equal((await fetch(`${base}/api/chat/dc-shop`)).status, 404);
  const all = (await call('GET', '/api/app/stores')).body;
  assert.ok(all.items.find((s) => s.slug === 'dc-shop').disconnectedAt);
  assert.equal(all.used, 1);
  assert.equal((await call('POST', `/api/app/stores/${storeId}/reconnect`)).status, 200);
  assert.equal((await fetch(`${base}/api/chat/dc-shop`)).status, 200);
});

test('the last connected store cannot be disconnected or deleted', async (t) => {
  const { register } = await startApp(t);
  const { call, storeId } = await register('last-shop');
  assert.equal((await call('POST', `/api/app/stores/${storeId}/disconnect`)).status, 409);
  assert.equal((await call('DELETE', `/api/app/stores/${storeId}`, { confirm: 'Shop last-shop' })).status, 409);
});

test('delete needs the exact store name and removes its data', async (t) => {
  const { db, register } = await startApp(t);
  const { call, workspaceId } = await register('del-shop');
  db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(workspaceId);
  const { body: { id } } = await call('POST', '/api/app/stores', { name: 'Temp Store', slug: 'del-temp' });
  db.prepare("INSERT INTO products (store_id, name, price) VALUES (?, 'p', 1)").run(id);
  assert.equal((await call('DELETE', `/api/app/stores/${id}`, { confirm: 'temp store' })).status, 400);
  assert.equal((await call('DELETE', `/api/app/stores/${id}`, { confirm: 'Temp Store' })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products WHERE store_id = ?').get(id).n, 0);
});

test('another workspace\'s store is 404 for every store action', async (t) => {
  const { register } = await startApp(t);
  const a = await register('iso-a');
  const b = await register('iso-b');
  for (const [method, path, body] of [['PUT', '', { name: 'Hacked', domain: '' }], ['POST', '/disconnect'], ['POST', '/reconnect'], ['DELETE', '', { confirm: 'Shop iso-a' }]]) {
    assert.equal((await b.call(method, `/api/app/stores/${a.storeId}${path}`, body)).status, 404, `${method} ${path}`);
  }
});
