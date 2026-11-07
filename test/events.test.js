// Activity events: backfill on migration and recording from chat and panel actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/migrations');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

test('backfill creates one event per existing order and conversation', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, { to: 2 });
  db.exec(`INSERT INTO workspaces (id, name) VALUES (1, 'W');
    INSERT INTO stores (id, workspace_id, slug, name) VALUES (3, 1, 'w-shop', 'W');
    INSERT INTO conversations (id, store_id, created_at) VALUES ('c1', 3, '2026-11-01 10:00:00');
    INSERT INTO orders (id, store_id, customer_name, phone, address, items_json, total, created_at)
      VALUES (9, 3, 'Sara', '09120000000', 'Tehran 1', '[]', 5, '2026-11-02 10:00:00');`);
  migrate(db);
  const rows = db.prepare('SELECT workspace_id, store_id, type, ref_id, created_at FROM events ORDER BY created_at').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { workspace_id: 1, store_id: 3, type: 'conversation.started', ref_id: 'c1', created_at: '2026-11-01 10:00:00' },
    { workspace_id: 1, store_id: 3, type: 'order.created', ref_id: '9', created_at: '2026-11-02 10:00:00' },
  ]);
});

async function app(t, ask) {
  const db = openDb(':memory:');
  const server = createApp({ db, ask }).listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/auth/register', { name: 'Ev Shop', slug: 'ev-shop', email: 'ev@t.ir', password: 'password123' });
  return { db, call, base };
}

test('new conversation records conversation.started once', async (t) => {
  const { db, base } = await app(t, null);
  const send = (conversationId) => fetch(`${base}/api/chat/ev-shop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'سلام', conversationId }) }).then((r) => r.json());
  const first = await send();
  await send(first.conversationId);
  const events = db.prepare("SELECT ref_id FROM events WHERE type = 'conversation.started'").all();
  assert.deepEqual(events.map((e) => e.ref_id), [first.conversationId]);
});

test('a chat order records order.created with the store\'s workspace', async (t) => {
  const ai = async (prompt) => {
    const id = Number(prompt.match(/#(\d+) \| Rug/)[1]);
    return `ok <order>{"items":[{"id":${id},"qty":1}],"name":"Sara","phone":"09121234567","address":"Tehran, Azadi 10"}</order>`;
  };
  const { db, call, base } = await app(t, ai);
  await call('POST', '/api/panel/products', { name: 'Rug', price: 100 });
  const res = await fetch(`${base}/api/chat/ev-shop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'بله' }) }).then((r) => r.json());
  const event = db.prepare("SELECT workspace_id, ref_id, summary FROM events WHERE type = 'order.created'").get();
  const workspaceId = db.prepare("SELECT workspace_id FROM stores WHERE slug = 'ev-shop'").get().workspace_id;
  assert.equal(event.workspace_id, workspaceId);
  assert.equal(event.ref_id, String(res.orderId));
  assert.match(event.summary, /Sara/);
});

test('order status change records order.status', async (t) => {
  const { db, call } = await app(t, null);
  const storeId = db.prepare("SELECT id FROM stores WHERE slug = 'ev-shop'").get().id;
  const { lastInsertRowid } = db.prepare(`INSERT INTO orders (store_id, customer_name, phone, address, items_json, total) VALUES (?, 'Ali', '09120000000', 'Tehran 1', '[]', 5)`).run(storeId);
  assert.equal((await call('PUT', `/api/panel/orders/${lastInsertRowid}`, { status: 'sent' })).status, 200);
  const event = db.prepare("SELECT ref_id, summary FROM events WHERE type = 'order.status'").get();
  assert.equal(event.ref_id, String(lastInsertRowid));
  assert.match(event.summary, /sent|ارسال/);
});
