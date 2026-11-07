// Analytics numbers, billing, settings (password, delete workspace), operator panel and its
// metadata-only wall, suspension.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { ensureOperator } = require('../src/auth');

async function operator(app) {
  await ensureOperator(app.db, 'op@platform.ir', 'operator-pass-1');
  const call = app.client();
  const login = await call('POST', '/api/auth/login', { email: 'op@platform.ir', password: 'operator-pass-1' });
  assert.equal(login.status, 200);
  assert.equal(login.body.operator, true);
  return call;
}

test('analytics: per-store numbers come from rows; a rate with no replies is null', async (t) => {
  const app = await startApp(t);
  const { call, storeId } = await app.register('an-shop');
  const { db } = app;
  db.prepare("INSERT INTO orders (store_id, customer_name, phone, address, items_json, total, status) VALUES (?, 'a', '', '', '[]', 1000, 'confirmed'), (?, 'b', '', '', '[]', 500, 'new')").run(storeId, storeId);
  db.prepare("INSERT INTO conversations (id, store_id) VALUES ('c1', ?)").run(storeId);
  db.prepare("INSERT INTO messages (conversation_id, role, content, source) VALUES ('c1', 'assistant', 'x', 'ai'), ('c1', 'assistant', 'y', 'offline'), ('c1', 'assistant', 'z', 'offline'), ('c1', 'assistant', 'w', 'offline')").run();
  db.prepare("INSERT INTO events (workspace_id, store_id, type, ref_id) SELECT workspace_id, id, 'conversation.takeover', 'c1' FROM stores WHERE id = ?").run(storeId);

  const res = await call('GET', '/api/app/analytics?range=7d');
  assert.equal(res.status, 200);
  const [row] = res.body.stores;
  assert.deepEqual({ orders: row.orders, revenue: row.revenue, conversations: row.conversations, takeovers: row.takeovers }, { orders: 2, revenue: 1000, conversations: 1, takeovers: 1 });
  assert.equal(row.aiRate, 0.25);
  assert.equal(row.offlineRate, 0.75);
  assert.equal(res.body.days.length, 7);
  assert.equal(res.body.series.orders.reduce((a, b) => a + b, 0), 2);

  db.prepare('DELETE FROM messages').run();
  assert.equal((await call('GET', '/api/app/analytics?range=7d')).body.stores[0].aiRate, null);
  assert.equal((await call('GET', '/api/app/analytics?range=nope')).status, 400);
});

test('billing shows the real plan, expiry and recorded payments', async (t) => {
  const app = await startApp(t);
  const { call, workspaceId } = await app.register('bill-shop');
  app.db.prepare("UPDATE workspaces SET plan = 'pro', paid_until = datetime('now', '-1 day') WHERE id = ?").run(workspaceId);
  app.db.prepare("INSERT INTO payments (workspace_id, amount, period_end) VALUES (?, 990000, datetime('now', '-1 day'))").run(workspaceId);
  const res = await call('GET', '/api/app/billing');
  assert.equal(res.body.plan, 'pro');
  assert.equal(res.body.effectivePlan, 'free');
  assert.equal(res.body.expired, true);
  assert.equal(res.body.usage.limit, 100);
  assert.equal(res.body.payments[0].amount, 990000);
});

test('password change needs the current password and signs out other sessions', async (t) => {
  const app = await startApp(t);
  const { call } = await app.register('pw-shop');
  const other = app.client();
  await other('POST', '/api/auth/login', { email: 'pw-shop@t.ir', password: 'password123' });
  assert.equal((await call('PUT', '/api/app/settings/password', { current: 'wrong-pass', next: 'new-password-1' })).status, 400);
  assert.equal((await call('PUT', '/api/app/settings/password', { current: 'password123', next: 'short' })).status, 400);
  assert.equal((await call('PUT', '/api/app/settings/password', { current: 'password123', next: 'new-password-1' })).status, 200);
  assert.equal((await call('GET', '/api/app/me')).status, 200, 'this browser stays signed in');
  assert.equal((await other('GET', '/api/app/me')).status, 401, 'the other session is gone');
  const fresh = app.client();
  assert.equal((await fresh('POST', '/api/auth/login', { email: 'pw-shop@t.ir', password: 'new-password-1' })).status, 200);
});

test('deleting a workspace needs its exact name and removes the stores and the lone owner', async (t) => {
  const app = await startApp(t);
  const { call, workspaceId } = await app.register('del-shop');
  assert.equal((await call('DELETE', '/api/app/settings/workspace', { confirm: 'nope' })).status, 400);
  assert.equal((await call('DELETE', '/api/app/settings/workspace', { confirm: 'Shop del-shop' })).status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM stores WHERE workspace_id = ?').get(workspaceId).n, 0);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'del-shop@t.ir'").get().n, 0);
  assert.equal((await call('GET', '/api/app/me')).status, 401);
});

test('operator: own panel only, owners locked out of it, and no customer data ever crosses the wall', async (t) => {
  const app = await startApp(t);
  const owner = await app.register('wall-shop');
  const chat = await fetch(`${app.base}/api/chat/wall-shop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'my very private message' }) }).then((r) => r.json());
  app.db.prepare("UPDATE conversations SET customer_name = 'Zahra Secret' WHERE id = ?").run(chat.conversationId);
  app.db.prepare("INSERT INTO orders (store_id, customer_name, phone, address, items_json, total) VALUES (?, 'Zahra Secret', '09990001111', 'Secret Street 12', '[{\"name\":\"Hidden Item\",\"qty\":1,\"price\":5}]', 5)").run(owner.storeId);
  app.db.prepare("INSERT INTO conversation_notes (conversation_id, body) VALUES (?, 'internal note text')").run(chat.conversationId);

  const op = await operator(app);
  assert.equal((await op('GET', '/api/app/me')).status, 403, 'the operator has no shop panel');
  assert.equal((await op('GET', '/api/app/conversations')).status, 403);
  assert.equal((await owner.call('GET', '/api/admin/workspaces')).status, 403, 'owners cannot open the admin API');

  const list = await op('GET', '/api/admin/workspaces');
  assert.equal(list.status, 200);
  const ws = list.body.find((w) => w.id === owner.workspaceId);
  assert.equal(ws.ownerEmail, 'wall-shop@t.ir');
  assert.equal(ws.stores, 1);
  const detail = await op('GET', `/api/admin/workspaces/${owner.workspaceId}`);
  assert.equal(detail.body.counts.conversations, 1);
  assert.equal(detail.body.counts.orders, 1);
  const stores = await op('GET', '/api/admin/stores');

  const everything = JSON.stringify([list.body, detail.body, stores.body]);
  for (const secret of ['Zahra Secret', '09990001111', 'Secret Street', 'Hidden Item', 'my very private message', 'internal note text']) {
    assert.ok(!everything.includes(secret), `admin API leaked: ${secret}`);
  }
});

test('operator records a payment, changes plan, suspends: chat answers "unavailable" for free', async (t) => {
  const app = await startApp(t);
  const owner = await app.register('susp-shop');
  const op = await operator(app);
  const paid = await op('POST', `/api/admin/workspaces/${owner.workspaceId}/payments`, { amount: 1500000, periodEnd: '2099-01-31', note: 'کارت به کارت' });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.paidUntil, '2099-01-31 20:30:00', 'midnight after 31 Jan in Tehran, written in UTC');
  let me = (await owner.call('GET', '/api/app/me')).body;
  assert.equal(me.usage.plan, 'pro');
  assert.equal((await op('POST', `/api/admin/workspaces/${owner.workspaceId}/payments`, { amount: 0, periodEnd: '2099-01-31' })).status, 400);
  assert.equal((await op('PUT', `/api/admin/workspaces/${owner.workspaceId}/plan`, { plan: 'free' })).status, 200);
  assert.equal((await owner.call('GET', '/api/app/me')).body.usage.plan, 'free');

  assert.equal((await op('POST', `/api/admin/workspaces/${owner.workspaceId}/suspend`)).status, 200);
  me = (await owner.call('GET', '/api/app/me')).body;
  assert.equal(me.workspace.status, 'suspended');
  const reply = await fetch(`${app.base}/api/chat/susp-shop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'سلام' }) }).then((r) => r.json());
  assert.equal(reply.source, 'unavailable');
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role = 'user'").get().n, 1, 'the message is kept for the owner');
  await op('POST', `/api/admin/workspaces/${owner.workspaceId}/reactivate`);
  const back = await fetch(`${app.base}/api/chat/susp-shop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'سلام' }) }).then((r) => r.json());
  assert.equal(back.source, 'offline');
});
