// Overview numbers, date ranges (Tehran days), the attention center and the activity feed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { resolveRange } = require('../src/time');
const overview = require('../src/overview');
const attention = require('../src/attention');

const NOW = new Date('2026-11-07T09:00:00Z'); // 12:30 Tehran

function seed() {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO workspaces (id, name, plan) VALUES (1, 'W', 'free');
    INSERT INTO stores (id, workspace_id, slug, name) VALUES (1, 1, 'one', 'One'), (2, 1, 'two', 'Two');`);
  return db;
}
const order = (db, store, total, status, at) => db.prepare(`INSERT INTO orders (store_id, customer_name, phone, address, items_json, total, status, created_at)
  VALUES (?, 'C', '09120000000', 'Tehran 1', '[]', ?, ?, ?)`).run(store, total, status, at);
const convo = (db, id, store, at) => db.prepare('INSERT INTO conversations (id, store_id, created_at) VALUES (?, ?, ?)').run(id, store, at);
const msg = (db, c, role, source, at) => db.prepare('INSERT INTO messages (conversation_id, role, content, source, created_at) VALUES (?, ?, ?, ?, ?)').run(c, role, 'x', source, at);

test('7d range covers the last 7 Tehran days including today', () => {
  const r = resolveRange({ range: '7d' }, NOW);
  assert.deepEqual(r.days, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.equal(r.start, '2026-10-31 20:30:00'); // 2026-11-01 00:00 Tehran
  assert.equal(r.prevStart, '2026-10-24 20:30:00');
  assert.equal(r.prevEnd, r.start);
});

test('bad custom ranges are errors, not exceptions', () => {
  assert.ok(resolveRange({ range: 'custom', from: '2026-11-05', to: '2026-11-01' }, NOW).error);
  assert.ok(resolveRange({ range: 'custom', from: 'nope', to: '2026-11-01' }, NOW).error);
  assert.ok(resolveRange({ range: 'custom', from: '2025-01-01', to: '2026-11-01' }, NOW).error);
  assert.ok(resolveRange({ range: 'year' }, NOW).error);
});

test('empty workspace gives zeros and null aiRate', () => {
  const db = seed();
  const m = overview.metrics(db, [1, 2], resolveRange({ range: '7d' }, NOW));
  assert.equal(m.revenue.value, 0);
  assert.equal(m.orders.value, 0);
  assert.equal(m.conversations.value, 0);
  assert.equal(m.aiRate.value, null);
  assert.equal(m.orders.series.length, 7);
});

test('revenue counts only confirmed and sent orders', () => {
  const db = seed();
  for (const status of ['new', 'confirmed', 'sent', 'cancelled']) order(db, 1, 100, status, '2026-11-05 10:00:00');
  const m = overview.metrics(db, [1], resolveRange({ range: '7d' }, NOW));
  assert.equal(m.revenue.value, 200);
  assert.equal(m.orders.value, 4);
});

test('previous period is the same length right before', () => {
  const db = seed();
  order(db, 1, 50, 'sent', '2026-10-28 10:00:00'); // inside the previous 7 days
  order(db, 1, 70, 'sent', '2026-10-20 10:00:00'); // before both
  const m = overview.metrics(db, [1], resolveRange({ range: '7d' }, NOW));
  assert.equal(m.revenue.value, 0);
  assert.equal(m.revenue.previous, 50);
});

test('orders land on their Tehran day', () => {
  const db = seed();
  order(db, 1, 1, 'new', '2026-11-05 20:00:00'); // 23:30 Tehran, 5 Nov
  order(db, 1, 1, 'new', '2026-11-05 21:00:00'); // 00:30 Tehran, 6 Nov
  const r = resolveRange({ range: '7d' }, NOW);
  const m = overview.metrics(db, [1], r);
  assert.equal(m.orders.series[r.days.indexOf('2026-11-05')], 1);
  assert.equal(m.orders.series[r.days.indexOf('2026-11-06')], 1);
});

test('aiRate is AI replies over all assistant replies, user messages ignored', () => {
  const db = seed();
  convo(db, 'c', 1, '2026-11-06 10:00:00');
  msg(db, 'c', 'user', null, '2026-11-06 10:00:00');
  msg(db, 'c', 'assistant', 'ai', '2026-11-06 10:00:01');
  msg(db, 'c', 'assistant', 'ai', '2026-11-06 10:00:02');
  msg(db, 'c', 'assistant', 'ai', '2026-11-06 10:00:03');
  msg(db, 'c', 'assistant', 'offline', '2026-11-06 10:00:04');
  const m = overview.metrics(db, [1], resolveRange({ range: '7d' }, NOW));
  assert.equal(m.aiRate.value, 0.75);
  assert.equal(m.conversations.value, 1);
});

test('store summaries are per store', () => {
  const db = seed();
  order(db, 2, 300, 'confirmed', '2026-11-06 10:00:00');
  const stores = db.prepare('SELECT id, name, slug, domain, platform FROM stores ORDER BY id').all();
  const s = overview.storeSummaries(db, stores, resolveRange({ range: '7d' }, NOW));
  assert.deepEqual(s.map((x) => [x.id, x.orders, x.revenue]), [[1, 0, 0], [2, 1, 300]]);
});

test('attention: nothing wrong gives an empty list', () => {
  const db = seed();
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = 1').get();
  assert.deepEqual(attention.items(db, ws, [{ id: 1 }, { id: 2 }], NOW), []);
});

test('attention: usage at 85% is medium, 100% is high', () => {
  const db = seed();
  convo(db, 'c', 1, '2026-11-06 10:00:00');
  for (let i = 0; i < 85; i++) msg(db, 'c', 'assistant', 'ai', '2026-11-06 10:00:00');
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = 1').get();
  const nowInMonth = new Date('2026-11-07T09:00:00Z');
  const usage85 = attention.items(db, ws, [{ id: 1 }], nowInMonth).find((i) => i.id === 'usage');
  assert.equal(usage85.severity, 'medium');
  for (let i = 0; i < 15; i++) msg(db, 'c', 'assistant', 'ai', '2026-11-06 10:00:00');
  assert.equal(attention.items(db, ws, [{ id: 1 }], nowInMonth).find((i) => i.id === 'usage').severity, 'high');
});

test('attention: expired pro, old new orders and waiting customers are listed', () => {
  const db = seed();
  db.exec("UPDATE workspaces SET plan = 'pro', paid_until = '2026-11-01 00:00:00' WHERE id = 1");
  order(db, 1, 10, 'new', '2026-11-05 08:00:00');            // waiting > 24 h
  convo(db, 'w', 2, '2026-11-07 08:00:00');
  msg(db, 'w', 'user', null, '2026-11-07 08:30:00');          // 30 min unanswered
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = 1').get();
  const ids = attention.items(db, ws, [{ id: 1 }, { id: 2 }], NOW).map((i) => i.id).sort();
  assert.deepEqual(ids, ['orders-waiting', 'plan-expired', 'unanswered']);
});

test('activity filters by type and pages by before', () => {
  const db = seed();
  const add = db.prepare("INSERT INTO events (workspace_id, store_id, type, ref_id, summary) VALUES (1, 1, ?, ?, '')");
  for (let i = 0; i < 5; i++) add.run('order.created', String(i));
  add.run('conversation.started', 'c');
  const page1 = overview.activity(db, [1], { type: 'order', limit: 3 });
  assert.equal(page1.items.length, 3);
  assert.ok(page1.items.every((e) => e.type.startsWith('order')));
  const page2 = overview.activity(db, [1], { type: 'order', limit: 3, before: page1.nextBefore });
  assert.equal(page2.items.length, 2);
  assert.equal(page2.nextBefore, null);
});
