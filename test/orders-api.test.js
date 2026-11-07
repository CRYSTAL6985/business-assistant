// Orders through /api/app: filters, search, detail, status changes, isolation, synced read-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

function addOrder(db, storeId, fields = {}) {
  const o = { name: 'Sara', phone: '09121111111', total: 100, status: 'new', source: 'assistant', created: '2026-11-05 10:00:00', ...fields };
  return Number(db.prepare(`INSERT INTO orders (store_id, customer_name, phone, address, items_json, total, status, source, external_id, created_at)
    VALUES (?, ?, ?, 'Tehran, Azadi 1', ?, ?, ?, ?, ?, ?)`).run(storeId, o.name, o.phone, JSON.stringify([{ id: 1, name: 'Rug', price: o.total, qty: 1 }]), o.total, o.status, o.source, o.external ?? null, o.created).lastInsertRowid);
}

test('orders: filters, search and sort', async (t) => {
  const { db, register } = await startApp(t);
  const { call, storeId } = await register('ord-shop');
  addOrder(db, storeId, { name: 'Sara', total: 100, status: 'new' });
  const sentId = addOrder(db, storeId, { name: 'Ali', phone: '09122222222', total: 300, status: 'sent', created: '2026-11-06 10:00:00' });
  addOrder(db, storeId, { name: 'Woo Buyer', total: 200, status: 'confirmed', source: 'woocommerce', external: 'w9' });

  assert.equal((await call('GET', '/api/app/orders')).body.total, 3);
  assert.deepEqual((await call('GET', '/api/app/orders?status=sent')).body.items.map((o) => o.customerName), ['Ali']);
  assert.deepEqual((await call('GET', '/api/app/orders?source=woocommerce')).body.items.map((o) => o.customerName), ['Woo Buyer']);
  assert.deepEqual((await call('GET', '/api/app/orders?q=0912222')).body.items.map((o) => o.customerName), ['Ali']);
  assert.deepEqual((await call('GET', `/api/app/orders?q=%23${sentId}`)).body.items.map((o) => o.id), [sentId]);
  assert.deepEqual((await call('GET', '/api/app/orders?sort=-total')).body.items.map((o) => o.total), [300, 200, 100]);
  assert.deepEqual((await call('GET', '/api/app/orders?from=2026-11-06&to=2026-11-06')).body.items.map((o) => o.customerName), ['Ali']);
  const first = (await call('GET', '/api/app/orders')).body.items[0];
  assert.equal(first.itemCount, 1);
  assert.equal(first.storeName, 'Shop ord-shop');
});

test('orders: detail includes items; status change records an event', async (t) => {
  const { db, register } = await startApp(t);
  const { call, storeId } = await register('det-shop');
  const id = addOrder(db, storeId);
  const detail = (await call('GET', `/api/app/orders/${id}`)).body;
  assert.equal(detail.items[0].name, 'Rug');
  assert.equal(detail.address, 'Tehran, Azadi 1');
  assert.equal((await call('PUT', `/api/app/orders/${id}/status`, { status: 'confirmed' })).status, 200);
  assert.equal((await call('PUT', `/api/app/orders/${id}/status`, { status: 'shipped-to-mars' })).status, 400);
  assert.equal(db.prepare("SELECT summary FROM events WHERE type = 'order.status'").get().summary, 'confirmed');
  assert.ok(db.prepare('SELECT updated_at FROM orders WHERE id = ?').get(id).updated_at);
});

test('orders: synced orders are read-only and other workspaces get 404', async (t) => {
  const { db, register } = await startApp(t);
  const a = await register('ord-a');
  const b = await register('ord-b');
  const woo = addOrder(db, a.storeId, { source: 'woocommerce', external: 'w1' });
  const local = addOrder(db, a.storeId);
  assert.equal((await a.call('PUT', `/api/app/orders/${woo}/status`, { status: 'sent' })).status, 409);
  assert.equal((await b.call('GET', `/api/app/orders/${local}`)).status, 404);
  assert.equal((await b.call('PUT', `/api/app/orders/${local}/status`, { status: 'sent' })).status, 404);
  assert.equal((await b.call('GET', '/api/app/orders')).body.total, 0);
  assert.equal((await a.call('GET', '/api/app/orders?from=bad&to=2026-11-01')).status, 400);
});
