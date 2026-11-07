// Database migrations: the runner (order, idempotence, rollback) and the v1 -> v2 data move.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');
const { migrate, MIGRATIONS } = require('../src/migrations');

const latest = Math.max(...MIGRATIONS.map((m) => m.version));
const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

test('fresh database reaches the latest version', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, latest);
});

test('re-running migrate is a no-op', () => {
  const db = openDb(':memory:');
  const before = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
  assert.equal(migrate(db), latest);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, before);
});

test('a failing migration rolls back and leaves earlier ones applied', () => {
  const db = new DatabaseSync(':memory:');
  const ok = { version: 1, name: 'ok', up: (d) => d.exec('CREATE TABLE a (x)') };
  const bad = { version: 2, name: 'bad', up: (d) => { d.exec('CREATE TABLE b (x)'); throw new Error('boom'); } };
  assert.throws(() => migrate(db, { migrations: [ok, bad] }), /boom/);
  assert.ok(tableExists(db, 'a'));
  assert.ok(!tableExists(db, 'b'));
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version), [1]);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

/** A version-1 database with one business and (optionally) one row in every child table. */
function v1Database({ withChildren = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, { to: 1 });
  db.prepare(`INSERT INTO businesses (id, slug, name, description, tone, email, password_hash, plan)
              VALUES (7, 'old-shop', 'Old Shop', 'D', 'T', 'old@shop.ir', 'salt:hash', 'pro')`).run();
  if (withChildren) {
    db.prepare("INSERT INTO products (business_id, name, price) VALUES (7, 'Scarf', 1000)").run();
    db.prepare("INSERT INTO faqs (business_id, question, answer) VALUES (7, 'Q?', 'A')").run();
    db.prepare("INSERT INTO conversations (id, business_id) VALUES ('c1', 7)").run();
    db.prepare("INSERT INTO messages (conversation_id, role, content, source) VALUES ('c1', 'assistant', 'hi', 'ai')").run();
    db.prepare(`INSERT INTO orders (business_id, conversation_id, customer_name, phone, address, items_json, total)
                VALUES (7, 'c1', 'Sara', '09120000000', 'Tehran street 1', '[]', 1000)`).run();
  }
  db.prepare("INSERT INTO sessions (token, business_id, expires_at) VALUES ('tok', 7, 9999999999999)").run();
  return db;
}

test('v1 database migrates with ids, slug and data preserved', () => {
  const db = v1Database();
  migrate(db);
  assert.equal(db.prepare('SELECT email FROM users WHERE id = 7').get().email, 'old@shop.ir');
  assert.equal(db.prepare('SELECT plan FROM workspaces WHERE id = 7').get().plan, 'pro');
  assert.deepEqual({ ...db.prepare('SELECT workspace_id, user_id, role FROM workspace_members').get() }, { workspace_id: 7, user_id: 7, role: 'owner' });
  const store = db.prepare('SELECT id, workspace_id, slug, name FROM stores').get();
  assert.deepEqual({ ...store }, { id: 7, workspace_id: 7, slug: 'old-shop', name: 'Old Shop' });
  for (const table of ['products', 'faqs', 'conversations', 'orders']) {
    assert.equal(db.prepare(`SELECT store_id FROM ${table}`).get().store_id, 7, table);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'c1'").get().n, 1);
  const config = db.prepare('SELECT draft_json, published_json FROM assistant_configs WHERE store_id = 7').get();
  assert.deepEqual(JSON.parse(config.published_json), { description: 'D', tone: 'T' });
  assert.deepEqual(JSON.parse(config.draft_json), { description: 'D', tone: 'T' });
  assert.ok(!tableExists(db, 'businesses'));
});

test('empty business migrates', () => {
  const db = v1Database({ withChildren: false });
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stores').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 0);
});

test('old sessions are dropped', () => {
  const db = v1Database();
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('rollback works even where db.isTransaction is unavailable (Node < 22.16)', () => {
  const real = new DatabaseSync(':memory:');
  const db = new Proxy(real, { get: (target, key) => (key === 'isTransaction' ? undefined : target[key].bind?.(target) ?? target[key]) });
  const bad = { version: 1, name: 'bad', up: (d) => { d.exec('CREATE TABLE b (x)'); throw new Error('boom'); } };
  assert.throws(() => migrate(db, { migrations: [bad] }), /boom/);
  assert.ok(!tableExists(real, 'b'));
  assert.equal(real.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

test('migration keeps id counters so old order numbers are never reused', () => {
  const db = v1Database();
  db.prepare(`INSERT INTO orders (id, business_id, customer_name, phone, address, items_json, total)
              VALUES (5, 7, 'Ali', '09120000001', 'Tehran 2', '[]', 1)`).run();
  db.prepare('DELETE FROM orders WHERE id = 5').run(); // counter stays at 5, highest remaining id is 1
  migrate(db);
  const { lastInsertRowid } = db.prepare(`INSERT INTO orders (store_id, customer_name, phone, address, items_json, total)
                                         VALUES (7, 'New', '09120000002', 'Tehran 3', '[]', 1)`).run();
  assert.equal(Number(lastInsertRowid), 6);
  const store = db.prepare(`INSERT INTO stores (workspace_id, slug, name) VALUES (7, 'second', 'S')`).run();
  assert.ok(Number(store.lastInsertRowid) > 7);
});
